import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function readDotEnv() {
  const env = {};
  let text = "";
  try {
    text = fs.readFileSync(path.resolve(process.cwd(), ".env"), "utf8");
  } catch {
    return env;
  }

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return env;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function extractApi() {
  return {
    name: "extract-api",
    configureServer(server) {
      server.middlewares.use("/api/extract", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        let payload;
        try {
          payload = JSON.parse(await readBody(req));
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid JSON." }));
          return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.flushHeaders();
        const send = (event) => res.write(`${JSON.stringify(event)}\n`);

        try {
          const env = readDotEnv();
          const { extractListing } = await server.ssrLoadModule("/server/extract.js");
          const result = await extractListing(payload, {
            typesafeApiKey: env.TYPESAFE_API_KEY || process.env.TYPESAFE_API_KEY,
            firecrawlApiKey: env.FIRECRAWL_API_KEY || process.env.FIRECRAWL_API_KEY,
            onStep: (step) => send({ type: "step", ...step }),
          });
          send({ type: "result", result });
        } catch (error) {
          send({ type: "error", error: error.message || "Extraction failed." });
        }
        res.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), extractApi()],
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
    },
  },
  ssr: {
    external: ["@typesafe-ai/sdk"],
  },
});
