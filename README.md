# Firecrawl + Jev

A small proof of concept that scrapes a web page and answers one yes or no question about it.

**Demo:** https://firejev.vercel.app

[Firecrawl](https://www.firecrawl.dev/) fetches the page as markdown. [Jev](https://docs.typesafe.ai/) answers one yes or no question about that page.

## How it works

1. You ask a yes or no question. A URL is optional.
2. With a URL, Firecrawl scrapes that page. Without one, Firecrawl searches the web and returns the top results.
3. Jev returns the probability that the answer is yes. At 50% or above, the app shows Yes. Below that, it shows No.

Each step shows how long it took.

## Requirements

- Node.js 20 or newer
- A [TypeSafe](https://docs.typesafe.ai/) API key for Jev

Firecrawl works without an API key (1,000 credits per month). Add `FIRECRAWL_API_KEY` if you need a higher limit.

## Setup

```bash
npm install
cp .env.example .env
```

Put your Jev key in `.env`:

```
TYPESAFE_API_KEY=your_key
```

The dev server reads `.env` on every extraction.

```bash
npm run dev
```

Open the URL Vite prints.

Ask the question in English. That is where Jev is most accurate. The scraped page can be in another language.

## Deploy on Vercel

The [Hobby plan](https://vercel.com/docs/plans/hobby) is free. It includes the serverless function that keeps your API keys off the page. A function can run for up to 5 minutes, which covers a scrape.

The deployed site is public. Anyone who can open it can spend your Jev and Firecrawl credits.

```bash
npx vercel
```

In the Vercel project settings, add `TYPESAFE_API_KEY`. Add `FIRECRAWL_API_KEY` only if you want a higher Firecrawl limit.

## License

[MIT](LICENSE)
