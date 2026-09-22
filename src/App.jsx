import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import logo from "@/assets/logo.png";

const idleStep = { status: "idle", startedAt: null, ms: null };
const idleSteps = { firecrawl: idleStep, jev: idleStep };

function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function StepTimers({ steps, now, firecrawlLabel }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <StepTimer label={firecrawlLabel} step={steps.firecrawl} now={now} />
      <StepTimer label="Jev" step={steps.jev} now={now} />
    </div>
  );
}

function StepTimer({ label, step, now }) {
  const elapsed = step.status === "running" ? now - step.startedAt : step.ms;
  return (
    <div className="pixel-timer">
      <span>{label}</span>
      <span>{elapsed == null ? "—" : formatDuration(elapsed)}</span>
    </div>
  );
}

export default function App() {
  const [url, setUrl] = useState("");
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [steps, setSteps] = useState(idleSteps);
  const [now, setNow] = useState(() => Date.now());
  const resultRef = useRef(null);
  const running = steps.firecrawl.status === "running" || steps.jev.status === "running";

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    setResult(null);
    setSteps(idleSteps);

    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, question }),
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("ndjson")) {
        const body = await response.json().catch(() => null);
        setError(body?.error || "Extraction failed.");
        return;
      }
      await readExtractStream(response, {
        onStep: (event) => {
          setNow(Date.now());
          setSteps((current) => ({
            ...current,
            [event.step]: {
              status: event.status === "start" ? "running" : event.status,
              startedAt: event.status === "start" ? Date.now() : null,
              ms: event.ms ?? null,
            },
          }));
        },
        onResult: setResult,
        onError: setError,
      });
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  const yesPercent = result ? Math.round(result.probability * 100) : 0;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col items-center gap-4 text-center">
        <h1>
          <img
            src={logo}
            alt="firejev"
            className="mx-auto h-auto w-full max-w-xs [image-rendering:pixelated]"
          />
        </h1>
        <p className="max-w-md text-sm leading-6">
          Ask a yes or no question in English. Add a URL to scrape that page, or leave it
          empty to search the web.
        </p>
      </header>

      <form className="pixel-frame flex flex-col gap-5" onSubmit={onSubmit}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="question" className="pixel">
            Question
          </Label>
          <Input
            id="question"
            required
            placeholder="Is the euro the currency of France?"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="url" className="pixel">
            URL (optional)
          </Label>
          <Input
            id="url"
            type="url"
            placeholder="A page to scrape"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>

        {error ? <p className="pixel-error">{error}</p> : null}

        <button type="submit" className="pixel-ask self-start" disabled={loading}>
          {loading ? "Asking…" : "Ask"}
        </button>
        {steps.firecrawl.status !== "idle" || steps.jev.status !== "idle" ? (
          <StepTimers
            steps={steps}
            now={now}
            firecrawlLabel={url.trim() ? "Scrape" : "Search"}
          />
        ) : null}
      </form>

      {result ? (
        <section ref={resultRef} className="flex flex-col gap-8">
          <div className="pixel-frame flex flex-col gap-4">
            <p className="pixel-verdict" data-answer={result.answer}>
              {result.answer === "yes" ? "Yes" : "No"}
            </p>
            <p>{result.question}</p>
            <div>
              <div
                className="pixel-meter"
                role="meter"
                aria-label={`${yesPercent}% yes`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={yesPercent}
              >
                <span style={{ width: `${yesPercent}%` }} />
              </div>
              <p className="pixel mt-3">{yesPercent}% yes</p>
            </div>
            <p className="text-sm">
              {result.source.title || result.source.url}
            </p>
            {result.source.truncated ? (
              <p className="text-sm">The page was shortened before Jev read it.</p>
            ) : null}
          </div>

          <div className="pixel-frame flex flex-col gap-3">
            <h2 className="pixel">Markdown</h2>
            <p className="text-sm">
              Main content, images removed.
              {result.usage ? ` ${result.usage.input_tokens} input tokens.` : ""}
            </p>
            <pre className="pixel-markdown">{result.markdown}</pre>
          </div>
        </section>
      ) : null}
    </main>
  );
}

async function readExtractStream(response, { onStep, onResult, onError }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim() === "") continue;
      const event = JSON.parse(line);
      if (event.type === "step") onStep(event);
      if (event.type === "result") onResult(event.result);
      if (event.type === "error") onError(event.error || "Extraction failed.");
    }

    if (done) break;
  }
}
