# Repository Guidelines

## Project Structure & Module Organization

Fedora Movies is a React 19, TypeScript, and Vite single-page application. Application code lives in `src/`: route-level views are in `src/pages/`, reusable UI in `src/components/`, TMDB requests in `src/api/`, shared state and request logic in `src/hooks/`, data contracts in `src/types/`, and formatting or normalization helpers in `src/utils/`. Global styling is in `src/index.css`. Static files belong in `public/`; production output is generated in `dist/` and should not be edited. Playwright end-to-end tests live in `tests/`.

## Build, Test, and Development Commands

- `npm install` installs the locked dependencies.
- `npm run dev` starts Vite's development server.
- `npm run typecheck` runs strict TypeScript checks without emitting files.
- `npm run lint` checks all TypeScript and TSX with ESLint.
- `npm test` runs the Playwright Chromium suite; first run `npx playwright install chromium`.
- `npm run build` type-checks and creates the production bundle in `dist/`.
- `npm run preview` serves that bundle for a final local smoke test.

## Coding Style & Naming Conventions

Follow the existing style: two-space indentation, single quotes, no semicolons, and trailing commas in multiline structures. Use `PascalCase` for components and page files (`MediaCard.tsx`), `camelCase` for functions and variables, and `useX` for hooks. Keep shared TMDB shapes in `src/types/tmdb.ts`; avoid duplicating response types. Prefer small functional components, semantic HTML, accessible labels, and explicit loading, empty, and error states. ESLint and the strict `tsconfig.json` are authoritative.

## Testing Guidelines

Use Playwright tests named `tests/*.spec.ts`. Cover user-visible behavior through accessible roles and text rather than implementation details. Mock TMDB and external media requests so tests remain deterministic and do not require real credentials. Add regression coverage for route changes, error handling, persistence, and responsive layouts. Run `npm run typecheck`, `npm run lint`, and `npm test` before submitting.

## Commit & Pull Request Guidelines

This snapshot has no Git history to establish a local convention. Use short, imperative, scoped commits such as `fix: preserve favourites after reload`. Pull requests should explain the user-facing change, list validation performed, link related issues, and include screenshots for visual or responsive changes. Keep generated reports, `test-results/`, and unrelated refactors out of the change.

## Security & Configuration

Copy `.env.example` to `.env.local` and set `VITE_TMDB_ACCESS_TOKEN`. Never commit tokens or `.env.local`. Because `VITE_*` values are browser-visible, use only TMDB's read access token, never a privileged secret.
