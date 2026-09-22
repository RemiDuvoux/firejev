import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const idleStep = { status: "idle", startedAt: null, ms: null };
const idleSteps = { firecrawl: idleStep, jev: idleStep };

function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function StepTimers({ steps, now, firecrawlLabel }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <StepTimer label={firecrawlLabel} step={steps.firecrawl} now={now} />
      <StepTimer label="Jev" step={steps.jev} now={now} />
    </div>
  );
}

function StepTimer({ label, step, now }) {
  const elapsed = step.status === "running" ? now - step.startedAt : step.ms;
  return (
    <div className="flex items-baseline justify-between rounded-lg bg-muted px-3 py-2 text-sm">
      <span>{label}</span>
      <span className="font-mono tabular-nums text-muted-foreground">
        {elapsed == null ? "—" : formatDuration(elapsed)}
      </span>
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

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Firecrawl + Jev</h1>
        <p className="text-sm text-muted-foreground">
          Firecrawl gathers markdown from a page or a web search. Jev answers one yes or no
          question.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Question</CardTitle>
          <CardDescription>
            Leave the URL empty to search the web. Add one to scrape that page. Ask in
            English.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="url">URL</Label>
              <Input
                id="url"
                type="url"
                placeholder="Optional — a page to scrape"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="question">Question</Label>
              <Input
                id="question"
                required
                placeholder="Is the euro the currency of France?"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
            </div>

            {error ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="submit" disabled={loading} className="self-start">
              {loading ? "Asking…" : "Ask"}
            </Button>
            {steps.firecrawl.status !== "idle" || steps.jev.status !== "idle" ? (
              <StepTimers
                steps={steps}
                now={now}
                firecrawlLabel={url.trim() ? "Scrape" : "Search"}
              />
            ) : null}
          </form>
        </CardContent>
      </Card>

      {result ? (
        <section ref={resultRef} className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{result.answer === "yes" ? "Yes" : "No"}</CardTitle>
              <CardDescription>
                {result.question}
                {" · "}
                {Math.round(result.probability * 100)}% yes
                {result.model ? ` · ${result.model}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {result.source.title || result.source.url}
                {result.source.truncated ? " · markdown truncated" : ""}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Markdown sent to Jev</CardTitle>
              <CardDescription>
                Main content, images removed.
                {result.usage ? ` ${result.usage.input_tokens} input tokens.` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">
                {result.markdown}
              </pre>
            </CardContent>
          </Card>
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
