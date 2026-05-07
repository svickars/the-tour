# Elsewhere

Elsewhere is a small browser experiment: pick a place, choose a narrator, and listen to a lightweight **audio walking tour**. Saved tours and favourites live in your browser (**IndexedDB**); there are no accounts and no marketing cookies for the app itself.

## Development

```bash
pnpm install
pnpm dev
```

Set environment variables required by the Vercel serverless routes (see `api/`) for script generation, speech, and optional Google Maps keys for local search.

## Privacy

How data is handled—including local storage, network requests, and third-party services—is described on the in-app **Privacy** page (`/privacy` route, linked from the footer when you run the app).

## Stack

Vite, React, TypeScript, Vercel Functions.
