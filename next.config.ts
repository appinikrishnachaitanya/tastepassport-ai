import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["@qloo/qloo-harness", "@modelcontextprotocol/sdk"],
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
      ],
    }];
  },
  logging: { incomingRequests: { ignore: [/\/auth\/callback/] } },
  allowedDevOrigins: ["127.0.0.1"],
};
export default config;
