import { noul, TypeSafeClient } from "@typesafe-ai/sdk";

const MAX_MARKDOWN_CHARS = 48_000;

export class ExtractError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function extractListing(
  { url, question },
  { typesafeApiKey, firecrawlApiKey, onStep } = {},
) {
  const pageUrl = parsePageUrl(url);
  const asked = parseQuestion(question);
  const apiKey = typesafeApiKey?.trim();
  const firecrawlKey = firecrawlApiKey?.trim();

  if (!apiKey) {
    throw new ExtractError("Add TYPESAFE_API_KEY to .env.", 500);
  }

  const firecrawl = await timeStep("firecrawl", onStep, async () => {
    const gathered = pageUrl
      ? await scrapeMarkdown(pageUrl, firecrawlKey)
      : await searchMarkdown(asked, firecrawlKey);
    return {
      mode: pageUrl ? "scrape" : "search",
      url: pageUrl,
      title: gathered.title,
      ...prepareMarkdown(gathered.markdown),
    };
  });
  const jev = await timeStep("jev", onStep, () =>
    askJev(apiKey, firecrawl.value.markdown, asked),
  );
  const probability = jev.value.answers.answer.noul;

  return {
    question: asked,
    answer: probability >= 0.5 ? "yes" : "no",
    probability,
    markdown: firecrawl.value.markdown,
    source: {
      mode: firecrawl.value.mode,
      url: firecrawl.value.url,
      title: firecrawl.value.title,
      truncated: firecrawl.value.truncated,
    },
    timings: {
      firecrawl: firecrawl.ms,
      jev: jev.ms,
    },
    model: jev.value.model,
    usage: jev.value.usage,
  };
}

async function timeStep(step, onStep, run) {
  onStep?.({ step, status: "start" });
  const started = performance.now();
  try {
    const value = await run();
    const ms = Math.round(performance.now() - started);
    onStep?.({ step, status: "done", ms });
    return { value, ms };
  } catch (error) {
    onStep?.({ step, status: "error", ms: Math.round(performance.now() - started) });
    throw error;
  }
}

async function askJev(apiKey, markdown, question) {
  try {
    const client = new TypeSafeClient({ apiKey, timeout: 60_000 });
    return await client.systemOne({
      state: markdown,
      model: "jev-latest",
      questions: {
        answer: noul(question, {
          true: "Yes. The text states this.",
          false: "No. The text states the opposite, or does not say.",
        }),
      },
    });
  } catch (error) {
    if (error instanceof ExtractError) throw error;
    const status = error.status === 401 ? 401 : 502;
    const message =
      error.status === 401
        ? "Jev rejected the API key. Check TYPESAFE_API_KEY in .env."
        : error.message || "The Jev request failed.";
    throw new ExtractError(message, status);
  }
}

function parsePageUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return null;

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ExtractError("Invalid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ExtractError("The URL must start with http:// or https://.");
  }

  return url.toString();
}

function parseQuestion(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ExtractError("Enter a yes or no question.");
  }
  return value.trim();
}

async function searchMarkdown(query, apiKey) {
  const body = await firecrawlRequest(
    "https://api.firecrawl.dev/v2/search",
    { query, sources: ["web"], limit: 5 },
    apiKey,
  );
  const results = Array.isArray(body.data) ? body.data : (body.data?.web ?? []);
  const sections = results
    .map((item) => {
      const text = item.markdown || item.description || item.snippet || "";
      if (typeof text !== "string" || text.trim() === "") return "";
      const title = item.title || item.url || "Result";
      const link = item.url ? `\n${item.url}` : "";
      return `## ${title}${link}\n\n${text.trim()}`;
    })
    .filter(Boolean);

  if (sections.length === 0) {
    throw new ExtractError("Firecrawl search returned no text.", 502);
  }

  return { markdown: sections.join("\n\n"), title: "Web search" };
}

async function scrapeMarkdown(url, apiKey) {
  const body = await firecrawlRequest(
    "https://api.firecrawl.dev/v2/scrape",
    { url, formats: ["markdown"], onlyMainContent: true },
    apiKey,
  );

  const markdown = body?.data?.markdown ?? body?.markdown;
  if (typeof markdown !== "string" || markdown.trim() === "") {
    throw new ExtractError("Firecrawl did not return markdown.", 502);
  }

  return {
    markdown,
    title: body?.data?.metadata?.title ?? body?.metadata?.title ?? null,
  };
}

async function firecrawlRequest(endpoint, payload, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
    throw new ExtractError(
      timedOut ? "Firecrawl took too long to respond." : "Could not reach Firecrawl.",
      502,
    );
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success === false) {
    const detail = body?.error || response.statusText;
    throw new ExtractError(`Firecrawl failed (${response.status}): ${detail}`, 502);
  }
  return body;
}

function prepareMarkdown(markdown) {
  const cleaned = markdown
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned === "") {
    throw new ExtractError("Firecrawl returned no text.", 502);
  }

  return {
    markdown: cleaned.slice(0, MAX_MARKDOWN_CHARS),
    truncated: cleaned.length > MAX_MARKDOWN_CHARS,
  };
}
