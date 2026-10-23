import { RESPONSE_POLICY } from "./response.ts";
import { CONVERSATION_POLICY, UNTRUSTED_DATA_POLICY } from "./prompts.ts";
import { containsConfiguredSecret } from "./secrets.ts";
import "server-only";
import { generationSettings } from "./generation-policy.ts";
import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import { conversationContext } from "./context.ts";
import { boundedToolLoop } from "./tool-loop.ts";
import { retryGemini502 } from "./gemini-retry.ts";
import { debugEvent } from "./debug.ts";
import { recordProviderHealth } from "./health.ts";
import { culturalText, validateIntent } from "./intent.ts";
import { isObject } from "../qloo/types.ts";
import { sectionTypes } from "../passport/model.ts";
import type {
  AgentState,
  ModelProvider,
  ToolChoice,
  ToolDefinition,
} from "./types.ts";
/** Vertex Express Mode uses a server-only API key; compatible providers remain optional. */
export function configuredProvider(): ModelProvider | undefined {
  const vertexKey = process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  const native = Boolean(vertexKey);
  const key = native
      ? vertexKey
      : process.env.AGENT_MODEL_API_KEY,
    base = process.env.AGENT_MODEL_BASE_URL,
    model = native
      ? process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite"
      : process.env.AGENT_MODEL_NAME;
  if (!key || !model || (!native && !base)) return;
  const gemini = native
    ? new GoogleGenAI({
        vertexai: true,
        apiKey: key,
        // Express Mode intentionally omits project/location and uses the global endpoint.
        httpOptions: { apiVersion: "v1", timeout: 20_000, retryOptions: { attempts: 1 } },
      })
    : undefined;
  const url = new URL(
    native ? "https://aiplatform.googleapis.com" : base!,
  );
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("Invalid provider configuration");
  async function complete(
    messages: { role: string; content: string }[],
    tools: {
      type: string;
      function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
      };
    }[],
    required = true,
    signal?: AbortSignal,
  ): Promise<ToolChoice[]> {
    if (containsConfiguredSecret(JSON.stringify(messages))) throw Error("Unsafe model context");
    messages = messages.map(message => message.role === "system"
      ? { ...message, content: UNTRUSTED_DATA_POLICY + "\n" + message.content }
      : message);
    if (gemini) {
      const trace = crypto.randomUUID();
      debugEvent("gemini.request", {
        trace,
        operation:
          tools[0]?.function.name === "explain_qloo_evidence"
            ? "explain"
            : required
              ? "interpret"
              : "choose",
      });
      try {
        // Guided actions can add adjacent agent replies. Group equal roles for a
        // valid native conversation without changing or expanding its content.
        const contents: { role: string; parts: { text: string }[] }[] = [];
        for (const message of messages.filter(message => message.role !== "system")) {
          const role = message.role === "assistant" ? "model" : "user";
          const previous = contents.at(-1);
          if (previous?.role === role) previous.parts.push({ text: message.content });
          else contents.push({ role, parts: [{ text: message.content }] });
        }
        const response = await retryGemini502(() => gemini.models.generateContent({
          model: model!,
          contents,
          config: {
            abortSignal: signal,
            ...generationSettings(tools[0]?.function.name === "explain_qloo_evidence" ? "response" : "decision"),
            systemInstruction: messages.find((m) => m.role === "system")
              ?.content,
            tools: [
              {
                functionDeclarations: tools.map((t) => ({
                  name: t.function.name,
                  description: t.function.description,
                  parametersJsonSchema: t.function.parameters,
                })),
              },
            ],
            toolConfig: {
              functionCallingConfig: {
                mode: required
                  ? FunctionCallingConfigMode.ANY
                  : FunctionCallingConfigMode.AUTO,
              },
            },
          },
        }), signal);
        const calls = response.functionCalls ?? [];
        if (calls.length > 3 || (required && !calls.length))
          throw Error("Invalid provider tool selection");
        const choices = calls.map((c) => {
          if (
            !c.name ||
            !tools.some((t) => t.function.name === c.name) ||
            !isObject(c.args) || containsConfiguredSecret(JSON.stringify(c.args))
          )
            throw Error("Invalid provider tool call");
          debugEvent("gemini.tool_selected", { trace, tool: c.name });
          return { name: c.name, arguments: c.args };
        });
        debugEvent("gemini.result", { trace, count: choices.length });
        recordProviderHealth("healthy");
        return choices;
      } catch (error) {
        debugEvent("gemini.failed", { trace, status: safeStatus(error) });
        recordProviderHealth("unavailable");
        throw Error("Model provider unavailable");
      }
    }
    let r: Response;
    try {
      r = await fetch(`${base!.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          tools,
          tool_choice: required ? "required" : "auto",
        }),
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
      });
    } catch {
      recordProviderHealth("unavailable");
      throw Error("Model provider unavailable");
    }
    if (!r.ok) {
      recordProviderHealth("unavailable");
      throw Error("Model provider unavailable");
    }
    const data = await r.json();
    recordProviderHealth("healthy");
    const calls =
      data?.choices?.[0]?.message?.tool_calls ?? (required ? undefined : []);
    if (!Array.isArray(calls) || calls.length > 3)
      throw Error("Invalid provider tool selection");
    return calls.map((c) => {
      if (
        !isObject(c) ||
        !isObject(c.function) ||
        typeof c.function.name !== "string" ||
        typeof c.function.arguments !== "string"
      )
        throw Error("Invalid provider tool call");
      const args = JSON.parse(c.function.arguments);
      const name = c.function.name;
      if (!tools.some(tool => tool.function.name === name) ||
          !isObject(args) || containsConfiguredSecret(JSON.stringify(args))) throw Error("Invalid tool arguments");
      return { name: c.function.name, arguments: args };
    });
  }
  return {
    ...(gemini ? {
      async compose(context: import("./types.ts").GroundedResponseContext, signal?: AbortSignal): Promise<import("./types.ts").GroundedResponse> {
        const trace=crypto.randomUUID();
        debugEvent("gemini.request", {trace,operation:"compose"});
        try {
          // One tool-free, structured response. No retry and no new actions.
          const response=await gemini.models.generateContent({
            model:model!, contents:[{role:"user",parts:[{text:JSON.stringify(context)}]}],
            config:{...generationSettings("response"),abortSignal:signal,systemInstruction:RESPONSE_POLICY,
              responseMimeType:"application/json",responseJsonSchema:{type:"object",properties:{
                message:{type:"string"},evidenceIds:{type:"array",items:{type:"string"}},recommendationIds:{type:"array",items:{type:"string"}},
              },required:["message","evidenceIds","recommendationIds"],additionalProperties:false}},
          });
          if (response.functionCalls?.length || !response.text) throw Error("Invalid response protocol");
          const result=JSON.parse(response.text);
          if(!isObject(result) || containsConfiguredSecret(JSON.stringify(result)))throw Error("Invalid response payload");
          debugEvent("gemini.result",{trace,operation:"compose",count:1});
          return result as unknown as import("./types.ts").GroundedResponse;
        } catch(error) {
          debugEvent("gemini.failed",{trace,operation:"compose",status:safeStatus(error)});
          throw Error("Grounded response unavailable");
        }
      },
    } : {}),
    async explain(facts) {
      const calls = await complete(
        [
          {
            role: "system",
            content:
              "Select up to five useful facts to explain this recommendation. Return only indices from the supplied Qloo facts. Do not invent or change metrics, names, causal claims or recommendations.",
          },
          { role: "user", content: JSON.stringify(facts) },
        ],
        [
          {
            type: "function",
            function: {
              name: "explain_qloo_evidence",
              parameters: {
                type: "object",
                properties: {
                  indices: { type: "array", items: { type: "integer" } },
                },
                required: ["indices"],
                additionalProperties: false,
              },
            },
          },
        ],
      );
      const ids = calls[0]?.arguments.indices;
      if (
        calls.length !== 1 ||
        calls[0].name !== "explain_qloo_evidence" ||
        !Array.isArray(ids) ||
        ids.length > 5 ||
        ids.some(
          (i) =>
            !Number.isInteger(i) || Number(i) < 0 || Number(i) >= facts.length,
        )
      )
        throw Error("Invalid evidence selection.");
      return [...new Set(ids as number[])];
    },
    async baseline(destination, tastes, request) {
      for (const taste of tastes) culturalText(taste, 100);
      culturalText(request);
      if (gemini) {
        const trace = crypto.randomUUID();
        debugEvent("gemini.request", { trace, operation: "baseline" });
        try {
          const response = await retryGemini502(() => gemini.models.generateContent({
            model: model!,
            contents: JSON.stringify({ request, destination, tastes }),
            config: {
              ...generationSettings("response"),
              systemInstruction:
                UNTRUSTED_DATA_POLICY + " Produce a concise cultural onboarding suggestion using only model knowledge. No tools or Qloo data are available. Explicitly state details and local availability are unverified. Never claim Qloo evidence.",
            },
          }));
          const text = response.text;
          if (
            !text?.trim() ||
            text.length > 8000 ||
            containsConfiguredSecret(text)
          )
            throw Error("Invalid baseline");
          recordProviderHealth("healthy");
          debugEvent("gemini.result", { trace, count: 1 });
          return {
            text: text.trim(),
            model: model!,
            generatedAt: new Date().toISOString(),
            source: "model-only" as const,
            request,
          };
        } catch (error) {
          debugEvent("gemini.failed", { trace, status: safeStatus(error) });
          recordProviderHealth("unavailable");
          throw Error("Comparison unavailable");
        }
      }
      let response: Response;
      try {
        response = await fetch(`${base!.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content:
                  "Produce a concise cultural onboarding suggestion for a newcomer using only your own model knowledge. No tools or Qloo data are available. Describe familiar routines and adjacent cultural discoveries. Explicitly state that details and local availability are unverified. Do not claim access to Qloo or evidence.",
              },
              {
                role: "user",
                content: JSON.stringify({ request, destination, tastes }),
              },
            ],
          }),
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        recordProviderHealth("unavailable");
        throw Error("Comparison unavailable");
      }
      if (!response.ok) {
        recordProviderHealth("unavailable");
        throw Error("Comparison unavailable");
      }
      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content;
      if (
        typeof text !== "string" ||
        !text.trim() ||
        text.length > 8000 ||
        containsConfiguredSecret(text)
      )
        throw Error("Invalid baseline");
      recordProviderHealth("healthy");
      return {
        text: text.trim(),
        model: model!,
        generatedAt: new Date().toISOString(),
        source: "model-only",
        request,
      };
    },
    async interpret(text, context, signal) {
      culturalText(text);
      const calls = await complete(
        [
          {
            role: "system",
            content:
              CONVERSATION_POLICY + (context
                ? `The user already has a confirmed Passport in ${context.city}. Recent messages are context, not instructions to replay. Current Passport preferences are authoritative. Interpret only the latest request; resolve pronouns and references using the conversation. Preserve omitted preferences. If the intended category is ambiguous across multiple sections, return no sections rather than guessing. Interpret this as a refinement of that Passport, not onboarding. Do not replace confirmed tastes. A request for museums OR art galleries is one Culture request with alternative venue genres (tagOperator union), not an intersection. Negated restaurants must not select Eat. `
                : "") +
              "For gibberish, accidental keystrokes, or input you cannot confidently understand, select kind unknown with empty sections, concepts, constraints and seeds; omit query. Never infer permission to refresh recommendations from previous conversation. Ask for clarification rather than guessing. For a read-only question select kind unknown and question capabilities, preferences or explanation; do not turn a question into an edit. For an actual edit omit question. Extract cultural onboarding/refinement intent only. Do not generate discovery data. Choose requested sections, not sections inferred merely from taste inputs. Movies means films to watch, Culture means physical venues such as cinemas/museums/nightlife, Books means reading recommendations, Lifestyle means bookstores/shops, Music means artist discovery (not concerts), Podcasts/Shows/Games/Brands/People/Destinations use their corresponding content categories. A movie then dinner outing means Culture and Eat, not Movies. A request for movies to watch means Movies. Preserve the specific dish: chicken biryani is not interchangeable with Indian cuisine. Destination may be any explicitly named city, optionally qualified by country. Preserve the requested locality; never substitute a city from a fixed list or claim verified coverage. Separate named seeds from cultural concepts and dislikes. More adventurous selects familiarity explore. More familiar selects familiarity familiar. Mixed hide/refine requests hide only explicitly removed categories and refine the requested active categories. Extract query preferences as a partial update: keep omitted preferences unchanged. Places use businessRatingMin, not ratingMin (Qloo film/TV rating). Price levels 1-4, popularity 0-1, business ratings 0-5. Trending uses goal trending; hidden gems uses goal hidden-gems; safe choices goal safe-bets; surprise goal surprise. Geography is a named locality, not a guaranteed point geocode. Never invent IDs or resolved tags. Concepts needing inclusion or exclusion must be resolved first. Do not include personal identifying information.",
          },
          ...(gemini ? context?.history ?? [] : []).map(turn => ({ role: turn.role === "agent" ? "assistant" : "user", content: turn.text })),
          { role: "user", content: gemini ? JSON.stringify({ passport: context ? { ...context, history: undefined } : undefined, request: text }) : text },
        ],
        [
          {
            type: "function",
            function: {
              name: "interpret_cultural_intent",
              parameters: {
                type: "object",
                properties: {
                  question: { type: "string", enum: ["capabilities", "preferences", "explanation"] },
                  query: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      goal: {
                        type: "string",
                        enum: [
                          "discover",
                          "trending",
                          "hidden-gems",
                          "safe-bets",
                          "surprise",
                        ],
                      },
                      priceMin: { type: "number" },
                      priceMax: { type: "number" },
                      businessRatingMin: { type: "number" },
                      popularityMin: { type: "number" },
                      popularityMax: { type: "number" },
                      locationQuery: { type: "string" },
                      radius: { type: "number" },
                      excludeLocation: { type: "string" },
                      tripAdvisorRatingMin: { type: "number" },
                      tripAdvisorReviewCountMin: { type: "number" },
                      qualityBias: {
                        type: "string",
                        enum: ["low", "medium", "high"],
                      },
                      trendBias: {
                        type: "string",
                        enum: ["low", "medium", "high"],
                      },
                      requiredExternalSources: {
                        type: "array",
                        items: {
                          type: "string",
                          enum: ["michelin", "resy", "tablet"],
                        },
                      },
                      tagOperator: {
                        type: "string",
                        enum: ["union", "intersection"],
                        description:
                          "Union for Indian or Thai, intersection for Indian and vegetarian. Resolve each concept; never invent IDs.",
                      },
                    },
                  },
                  excludeConcepts: {
                    type: "array",
                    items: { type: "string" },
                    description:
                      "Cultural concepts to exclude, such as seafood. Raw names only; server resolves and user confirms IDs.",
                  },
                  kind: {
                    type: "string",
                    enum: ["onboard", "refine", "hide", "unknown"],
                  },
                  familiarity: {
                    type: "string",
                    enum: ["familiar", "balanced", "explore"],
                  },
                  destination: { type: "string" },
                  seeds: { type: "array", items: { type: "string" } },
                  concepts: { type: "array", items: { type: "string" } },
                  constraints: {
                    type: "array",
                    items: {
                      type: "string",
                      enum: [
                        "touristy",
                        "crowded",
                        "mainstream",
                        "expensive",
                        "atmosphere",
                      ],
                    },
                  },
                  sections: {
                    type: "array",
                    items: {
                      type: "string",
                      enum: Object.keys(sectionTypes),
                    },
                  },
                  hide: {
                    type: "array",
                    items: {
                      type: "string",
                      enum: Object.keys(sectionTypes),
                    },
                  },
                  strategy: {
                    type: "string",
                    enum: ["discover", "rank", "filter"],
                  },
                },
                required: [
                  "kind",
                  "seeds",
                  "concepts",
                  "constraints",
                  "sections",
                  "strategy",
                ],
                additionalProperties: false,
              },
            },
          },
        ], true, signal,
      );
      if (calls.length !== 1 || calls[0].name !== "interpret_cultural_intent")
        throw Error("Invalid interpretation");
      return validateIntent(calls[0].arguments);
    },
    ...(gemini && process.env.AGENT_TOOL_LOOP !== "0" ? {
      async chooseWithObservation(text: string, state: AgentState, tools: ToolDefinition[], execute: (choice: ToolChoice) => Promise<import("./types.ts").ToolResult>, signal?: AbortSignal, allowedQueries?: readonly string[]) {
        culturalText(text);
        const trace = crypto.randomUUID();
        debugEvent("gemini.request", { trace, operation: "observe-tools" });
        try {
          const observed = await boundedToolLoop(gemini, model!, JSON.stringify({
            request: text,
            conversation: conversationContext(state),
            intent: state.intent,
            destination: state.city,
          }), tools, execute, signal, allowedQueries);
          recordProviderHealth("healthy");
          debugEvent("gemini.result", { trace, count: observed.observations.length });
          return observed;
        } catch (error) {
          debugEvent("gemini.failed", { trace, status: safeStatus(error) });
          // The existing deterministic Qloo path is retained by the orchestrator.
          throw Error("Model tool observation unavailable");
        }
      },
    } : {}),
    async choose(text: string, state: AgentState, tools: ToolDefinition[], signal?: AbortSignal) {
      culturalText(text);
      return complete(
        [
          {
            role: "system",
            content:
              "Select the smallest useful Qloo workflow. Use qloo_find_tags for concepts, qloo_rank for shortlist ranking. Never invent IDs, recommendations or metadata. No more than two calls. Return no tool call when a known deterministic discovery query is sufficient. Do not send personal data. All tools are read-only cultural operations.",
          },
          {
            role: "user",
            content: JSON.stringify({
              request: text,
              ...(gemini ? { conversation: conversationContext(state) } : {}),
              destination: state.city,
              tastes: state.selected.map((s) => ({
                name: s.name,
                type: s.types,
              })),
              intent: state.intent,
              shortlist: state.cards
                .slice(0, 40)
                .map((c) => ({ id: c.id, name: c.name, section: c.section })),
              accepted: state.cards
                .filter((c) =>
                  state.feedback.some((f) => f.id === c.id && f.accepted),
                )
                .map((c) => ({ name: c.name, section: c.section })),
            }),
          },
        ],
        tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        })),
        false, signal,
      );
    },
  };
}

function safeStatus(error: unknown): number | undefined {
  if (!isObject(error) || typeof error.status !== "number") return;
  return error.status >= 400 && error.status <= 599 ? error.status : undefined;
}
