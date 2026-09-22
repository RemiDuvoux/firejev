import { extractListing } from "../server/extract.js";

export const config = {
  maxDuration: 300,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      res.status(400).json({ error: "Invalid JSON." });
      return;
    }
  }
  if (payload == null || typeof payload !== "object") {
    res.status(400).json({ error: "Invalid JSON." });
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  const send = (event) => res.write(`${JSON.stringify(event)}\n`);

  try {
    const result = await extractListing(payload, {
      typesafeApiKey: process.env.TYPESAFE_API_KEY,
      firecrawlApiKey: process.env.FIRECRAWL_API_KEY,
      onStep: (step) => send({ type: "step", ...step }),
    });
    send({ type: "result", result });
  } catch (error) {
    send({ type: "error", error: error.message || "Extraction failed." });
  }
  res.end();
}
