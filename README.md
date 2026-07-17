# Fedora Movies

Fedora Movies is a private, account-based movie and TV application built with React 19, TypeScript, Vite, and a Cloudflare Worker. TMDB requests, authentication, account administration, sessions, and favourites all run through the Worker; viewer data is stored in Cloudflare D1.

## What is included

- Viewer sign-in for the entire application
- Mandatory password change after first sign-in or an administrator reset
- A separate `/admin` console for creating, searching, enabling, disabling, expiring, and maintaining viewer accounts
- Administrator password resets, session revocation, and an audit log
- Account-synced favourites with a one-time import offer for older local favourites
- A server-side, authenticated TMDB proxy so the TMDB token is never bundled into browser JavaScript
- Movie and TV discovery, search, details, trailers, providers, cast, and episode browsing
- A mobile-first dark Apple-inspired interface with safe-area support, bottom navigation on phones, touch-sized controls, and adaptive iPad/tablet layouts
- Isolated Worker/D1 tests plus Chromium, Android, iPhone-profile, iPad-profile, responsive, and accessibility browser tests

Fedora Movies does not host video files. The optional embedded player loads third-party sources selected by the viewer; confirm that any source you configure is lawful in your location.

## Requirements

- Node.js 22.12 or newer (`.node-version` pins 22.22.0)
- npm
- A Cloudflare account with Workers and D1 access
- A TMDB API Read Access Token

## Install and run locally

```bash
npm install
npm run cf:types
npm run db:migrate:local
npm run dev
```

The Worker fails closed when its secrets are absent. For local development, create an ignored `.dev.vars` file containing `ADMIN_PASSWORD` and `TMDB_ACCESS_TOKEN`. No password or token value is committed to this repository.

```text
ADMIN_PASSWORD=choose-a-long-unique-password
TMDB_ACCESS_TOKEN=your-tmdb-read-access-token
```

Open the URL printed by Vite, then visit `/admin` to sign in and create the first viewer account. Viewer temporary passwords must be 12–128 characters and are never returned by the API or retained in the admin form.

## Cloudflare resources

`wrangler.jsonc` updates the existing Cloudflare Worker named `movie-app` and binds it to the D1 database named exactly:

```text
movie-streaming-app-db
```

The configured database ID is `1e038815-7d0b-4830-840b-d2661ba98c27`. If deploying from a different Cloudflare account, create a database with the same name and replace only the `database_id` in `wrangler.jsonc`:

```bash
npx wrangler d1 create movie-streaming-app-db
```

Apply production migrations:

```bash
npm run db:migrate:remote
```

## Add production secrets

Run both commands and enter each value only at Wrangler's secure prompt:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put TMDB_ACCESS_TOKEN
```

The administrator password is intentionally not set by this repository. `wrangler.jsonc` declares both secrets as required, so missing configuration is visible during local builds and deployment checks.

## Validate and deploy

```bash
npm run typecheck
npm run lint
npm test
npm run build
npx wrangler deploy --dry-run
npm run deploy
```

The Playwright suite uses deterministic API mocks and does not need real credentials. The Worker tests run against isolated local D1 storage with the real migration and Worker runtime.

## Account and session security

- Viewer passwords use PBKDF2-HMAC-SHA-256 with a unique 16-byte salt and 600,000 iterations.
- Raw passwords are never stored. Raw session tokens are sent only in `HttpOnly`, `SameSite=Strict` cookies; D1 stores only SHA-256 token hashes.
- Viewer sessions last 30 days. Administrator sessions last 8 hours.
- Disabling or resetting an account invalidates its active sessions.
- Viewer and administrator sign-in attempts are throttled after five failures in a 15-minute window.
- Mutating API requests require same-origin JSON requests.
- Account deletion is intentionally unavailable; administrators use disable/expiry controls to preserve auditability.
- `VITE_*` secrets are not used. The browser calls only `/api/tmdb/*`, and the Worker adds the TMDB token server-side.

## Project structure

```text
migrations/   D1 schema migrations
src/          React application
  api/        Browser API clients
  components/ Auth, layout, media, and shared UI components
  hooks/      Shared React state and request hooks
  pages/      Route-level views, grouped by account and admin areas
  types/      Shared API and media contracts
  utils/      Formatting and media helpers
tests/        Playwright end-to-end, device, responsive, and accessibility tests
worker/       Cloudflare Worker routes, authentication, admin, favourites, and TMDB proxy
```

## TMDB attribution

South Africa (`ZA`) is the default region for provider availability. Provider data is supplied through TMDB's JustWatch integration and can change.

**This product uses the TMDB API but is not endorsed or certified by TMDB.**
