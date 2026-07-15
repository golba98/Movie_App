# Fedora Movies

Fedora Movies is a polished movie and TV discovery demo built with React, TypeScript, Vite, Tailwind CSS, React Router, Lucide icons, and the TMDB API. It displays real metadata, posters, trailers, ratings, cast information, similar titles, and legal watch-provider availability for South Africa.

It does **not** stream, host, download, scrape, sell, or link to pirated media. Provider links lead to TMDB's legal availability page.

## Features

- Cinematic home page with trending, popular, top-rated, upcoming, and TV collections
- Debounced movie and TV search stored in the URL
- Movie and TV details with credits, official YouTube trailers, similar titles, and ZA providers
- Local favourites that survive refreshes and require no account
- Dedicated Movies and TV browse pages with pagination
- Full-width top navigation on desktop and a phone-friendly top-bar menu
- Loading skeletons, retryable errors, empty states, missing-image fallbacks, and a missing-token setup screen
- Keyboard navigation, focus-visible states, reduced-motion support, and an accessible trailer dialog

## Requirements

- Node.js 22.12 or newer
- npm
- A TMDB API Read Access Token

## TMDB token setup

1. Create or sign in to a [TMDB account](https://www.themoviedb.org/signup).
2. Open **Account Settings → API** and request API access for a non-commercial developer project.
3. Copy the **API Read Access Token** from [TMDB API settings](https://www.themoviedb.org/settings/api).
4. Copy the example environment file:

   ```bash
   cp .env.example .env.local
   ```

5. Add the token to `.env.local`:

   ```env
   VITE_TMDB_ACCESS_TOKEN=your_tmdb_access_token
   ```

Never commit `.env.local`. Vite injects `VITE_*` variables into the browser bundle, so this project must use only the TMDB read token—not a privileged application secret.

## Install and run

```bash
npm install
npm run dev
```

Vite prints the local URL, normally `http://localhost:5173`.

## Quality checks and production build

```bash
npm run typecheck
npm run lint
npx playwright install chromium
npm test
npm run build
npm run preview
```

The production output is written to `dist/`. When deploying as a static single-page application, configure the host to rewrite unknown paths to `index.html` so detail and search URLs can be refreshed directly.

## Deploy to Cloudflare

Fedora Movies is a static SPA, so it deploys to Cloudflare Workers static assets with no server code. The repo ships a `wrangler.jsonc` that serves `dist/` and handles SPA routing, so `npx wrangler deploy` works with no interactive setup.

1. Connect the repository to a Cloudflare Workers project (Workers Builds), or deploy from your machine with `npx wrangler deploy` after a local `npm run build`.
2. Build settings (Workers Builds detects these automatically):
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
   - **Output directory:** `dist` (declared as `assets.directory` in `wrangler.jsonc`)
3. Node version: the repo pins Node via `.node-version` (`22.22.0`), which satisfies the engine requirements of `react-router` and ESLint. Cloudflare's build image honours it automatically.
4. Add the build-time environment variable in the project's **Settings → Variables** (Production and Preview):

   ```env
   VITE_TMDB_ACCESS_TOKEN=your_tmdb_access_token
   ```

   Vite inlines `VITE_*` variables at build time, so this must be set before the build runs. Without it the app builds successfully and shows the in-app setup screen.
5. Client-side routing works because `wrangler.jsonc` sets `assets.not_found_handling` to `single-page-application`, so deep links such as `/movies` or `/movie/123` serve the SPA shell and resolve correctly on refresh.

## Project structure

```text
src/
  api/          Shared authenticated TMDB client and endpoint functions
  components/   Navigation, cards, rows, hero, modal, providers, and UI states
  hooks/        Debounce, favourites, and abortable request state
  pages/        Home, browse, search, details, favourites, and 404 routes
  types/        Nullable-safe TMDB and application interfaces
  utils/        Image URLs, normalization, formatting, trailer/provider selection
tests/          Playwright browser flows with intercepted test-only TMDB responses
```

Detail requests use TMDB's `append_to_response` support to retrieve credits, videos, similar content, and providers without duplicating fetch logic. Search and route changes cancel stale requests with `AbortController`.

## Data and attribution

South Africa (`ZA`) is the default region for provider availability. Provider data is supplied through TMDB's JustWatch integration and may change; always verify current availability and terms with the named provider.

**This product uses the TMDB API but is not endorsed or certified by TMDB.**

The approved TMDB logo is included unmodified from TMDB's official attribution assets. Watch-provider information is attributed to JustWatch wherever it appears.
# Movie_App
