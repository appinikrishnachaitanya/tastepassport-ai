import "server-only";
import { debugEvent } from "./debug.ts";
import { execFile } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { paced } from "../qloo/transport.ts";
import { isObject } from "../qloo/types.ts";
import type { ToolDefinition, ToolResult } from "./types.ts";
const bin = () =>
  `${process.cwd()}/node_modules/@qloo/qloo-harness/dist/bin.js`;
function environment(): Record<string, string> & {
  NODE_ENV: "development" | "production" | "test";
} {
  const env: Record<string, string> = {};
  for (const name of [
    "PATH",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "QLOO_API_KEY",
  ])
    if (process.env[name]) env[name] = process.env[name]!;
  const base =
    process.env.QLOO_API_BASE_URL ??
    process.env.QLOO_BASE_URL ??
    "https://hackathon.api.qloo.com";
  if (
    !["https://hackathon.api.qloo.com", "https://api.qloo.com"].includes(
      base.replace(/\/$/, ""),
    )
  )
    throw Error("Unsupported Qloo gateway");
  return {
    ...env,
    NODE_ENV: process.env.NODE_ENV ?? "production",
    NODE_USE_ENV_PROXY: "1",
    QLOO_HOME: "/tmp/tastepassport-agent-harness",
    QLOO_BASE_URL: base,
    QLOO_TRUSTED_BASE_URL: base,
  };
}
async function withMcp<T>(
  fn: (client: Client) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin(), "mcp"],
    env: environment(),
    stderr: "pipe",
  });
  const client = new Client({ name: "tastepassport-agent", version: "1.0" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        if (signal?.aborted) throw Error("Qloo MCP cancelled");
        await client.connect(transport);
        return fn(client);
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("Qloo MCP timeout")), 25_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}
let catalog: { until: number; tools: ToolDefinition[] } | undefined;
export async function discoverTools(): Promise<ToolDefinition[]> {
  if (catalog && catalog.until > Date.now()) return catalog.tools;
  const tools = await withMcp(async (c) =>
    (await c.listTools()).tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    })),
  );
  catalog = { until: Date.now() + 300_000, tools };
  return tools;
}
export function normalizeWorkflow(value: unknown): ToolResult {
  if (
    !isObject(value) ||
    value.schema_version !== "1.0-preview.1" ||
    !["ok", "empty", "needs_input", "partial", "degraded", "error"].includes(
      String(value.status),
    )
  )
    throw Error("Invalid Qloo workflow response");
  return value as unknown as ToolResult;
}
export async function workflow(
  mode: "exec" | "mcp",
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolResult> {
  if (
    !["qloo_find_tags", "qloo_rank"].includes(name) ||
    (await discoverTools()).every((t) => t.name !== name)
  )
    throw Error("Qloo workflow unavailable");
  const trace = crypto.randomUUID();
  debugEvent("qloo.invoked", { trace, tool: name, transport: mode });
  try {
    const result = await paced(
      `workflow:${process.env.QLOO_API_KEY}:${mode}:${name}:${JSON.stringify(args)}`,
      async () => {
        if (signal?.aborted) throw Error("Workflow cancelled");
        if (mode === "mcp")
          return withMcp(async (client) => {
            const response = await client.callTool(
              { name, arguments: args },
              undefined,
              { timeout: 24_000, signal },
            );
            const value =
              response.structuredContent ??
              JSON.parse(
                (response.content as { type: string; text?: string }[]).find(
                  (c) => c.type === "text",
                )?.text ?? "null",
              );
            const result = normalizeWorkflow(value);
            if (response.isError || result.status === "error")
              throw Error(
                "Qloo MCP workflow failed; existing passport preserved",
              );
            return result;
          }, signal);
        return new Promise<ToolResult>((resolve, reject) => {
          const child = execFile(
            process.execPath,
            [bin(), "exec", name.slice(5)],
            {
              env: environment(),
              timeout: 25_000,
              signal,
              maxBuffer: 1024 * 1024,
              encoding: "utf8",
            },
            (error, stdout) => {
              if (error) {
                reject(
                  Error(
                    "Qloo workflow failed or rate limited; please retry later",
                  ),
                );
                return;
              }
              try {
                resolve(normalizeWorkflow(JSON.parse(stdout)));
              } catch {
                reject(Error("Unexpected Qloo workflow response"));
              }
            },
          );
          child.stdin?.end(JSON.stringify(args));
        });
      },
    );
    debugEvent("qloo.result", {
      trace,
      tool: name,
      transport: mode,
      count: Array.isArray(result.results) ? result.results.length : 0,
    });
    return result;
  } catch (error) {
    debugEvent("qloo.failed", { trace, tool: name, transport: mode });
    throw error;
  }
}
