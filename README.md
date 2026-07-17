# Fedora Movies

Fedora Movies is a private, account-based movie and TV application built with React 19, TypeScript, Vite, and a Cloudflare Worker. TMDB requests, authentication, account administration, sessions, and favourites all run through the Worker; viewer data is stored in Cloudflare D1.

## What is included

- Viewer sign-in for the entire application
- Mandatory password change after first sign-in or an administrator reset
- A separate `/admin` console for creating, searching, enabling, disabling, expiring, and maintaining viewer accounts
- Administrator password resets, session revocation, and an audit log
- An administrator-managed catalog of direct owned or licensed MP4/WebM sources, plus optional dynamic third-party search providers
- Account-synced favourites with a one-time import offer for older local favourites
- A server-side, authenticated TMDB proxy so the TMDB token is never bundled into browser JavaScript
- Movie and TV discovery, search, details, trailers, providers, cast, and episode browsing
- A mobile-first dark Apple-inspired interface with safe-area support, bottom navigation on phones, touch-sized controls, and adaptive iPad/tablet layouts
- A signed-in `/capture-test` page for separating application playback faults from browser, GPU, Wayland, PipeWire, and protected-content capture faults
- Isolated Worker/D1 tests plus Chromium, Firefox, Android, iPhone-profile, iPad-profile, responsive, and accessibility browser tests

The production player supports direct administrator-approved media URLs through a persistent HTML5 `<video>` element. Administrators may also configure optional dynamic providers that resolve an external embed only after a viewer explicitly presses **Watch**. Fedora Movies does not proxy the resulting media or attempt to bypass DRM, access controls, or copy protection.

## Third-party content and copyright notice

Fedora Movies does not create, upload, seed, copy, host, store, or redistribute movie and TV files. Optional dynamic providers use URLs and embed resources supplied by independent third-party services; those services control their own sites, catalogs, availability, and content.

Some third-party services may contain material uploaded without the rightsholder's permission. This project does not control or endorse that material, and the presence of a provider integration is not a claim that every title it exposes is licensed or lawful in every jurisdiction. Administrators and viewers must only configure, access, or display content when they have the necessary permission and must comply with applicable laws and the third party's terms.

This notice describes the project's technical role; it is not legal advice or a guarantee about any external source.

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
npm start
```

`npm start` launches the development server and opens Fedora Movies in the default browser. Use `npm run dev` when you want the server without opening a browser automatically.

The Worker fails closed when its secrets are absent. For local development, create an ignored `.dev.vars` file containing `ADMIN_PASSWORD` and `TMDB_ACCESS_TOKEN`. No password or token value is committed to this repository.

```text
ADMIN_PASSWORD=choose-a-long-unique-password
TMDB_ACCESS_TOKEN=your-tmdb-read-access-token
```

Open the URL printed by Vite, then visit `/admin` to sign in and create the first viewer account. Viewer temporary passwords must be 12–128 characters and are never returned by the API or retained in the admin form.

## Video playback

Use the **Authorised media catalog** in `/admin` to associate a direct MP4 or WebM URL with a TMDB movie or TV episode. Sources may be a same-origin path or an HTTPS URL. A remote media host must provide a browser-compatible codec, correct content type, and byte-range support; Fedora Movies deliberately does not proxy remote video.

Optional dynamic search providers are configured separately in `/admin`. The Worker checks the configured provider, resolves its external embed only after the viewer presses **Watch**, and returns an error if it cannot prepare the player within 15 seconds. The raw provider page is not embedded, and leaving theater mode destroys the iframe so the rest of the application remains usable.

The player:

- keeps one native `<video controls playsInline preload="metadata">` element mounted while playback controls and theater mode change;
- does not react to window blur, page visibility, capture state, Discord, Zoom, OBS, or developer tools;
- does not render video through a canvas or place an opaque capture overlay over it;
- does not set a `crossorigin` attribute, because doing so without matching media-server CORS headers can break otherwise valid direct playback; and
- reports ordinary media errors below the player without blanking or replacing it.

DRM, HDCP, Encrypted Media Extensions, browser output protection, and operating-system restrictions are outside the application's control. This project does not try to bypass those protections. Use unencrypted media you are authorised to share when recording or presenting.

## Screen-capture compatibility test

After viewer sign-in, open `/capture-test`. Play the original test clip, choose **Test screen capture**, then select the current tab, browser window, or display. The second native video shows the stream returned by `getDisplayMedia()`. The original player is never paused, hidden, removed, or used as the capture preview.

Interpret the comparison as follows:

- both videos visible: ordinary HTML5 video capture works in the selected browser/session;
- original visible but preview black: investigate browser hardware acceleration, GPU overlays, Wayland/PipeWire, the compositor, or drivers;
- test media visible but another source black: investigate that source's codec, DRM, HDCP, or output policy; and
- original test media failing locally: investigate delivery, content type, codec, and byte-range support before capture software.

`public/test-media/capture-test.mp4` is repository-owned diagnostic media with a moving pattern, timecode, and synchronized flash/beep. It was generated with:

```bash
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=12" \
  -f lavfi -i "aevalsrc=if(lt(mod(t\,1)\,0.15)\,0.25*sin(2*PI*1000*t)\,0):s=48000:d=12" \
  -vf "drawbox=x=24:y=24:w=110:h=110:color=white@1:t=fill:enable='lt(mod(t\,1)\,0.15)',drawtext=text='Capture test %{pts\\:hms}':fontcolor=white:fontsize=42:box=1:boxcolor=black@0.65:x=(w-text_w)/2:y=h-90" \
  -c:v libopenh264 -b:v 1400k -pix_fmt yuv420p \
  -c:a aac -b:a 96k -movflags +faststart \
  public/test-media/capture-test.mp4
```

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
public/       Static files, including repository-owned capture test media
src/          React application
  api/        Browser API clients
  components/ Auth, layout, media, and shared UI components
  hooks/      Shared React state and request hooks
  pages/      Route-level views, grouped by account and admin areas
  types/      Shared API and media contracts
  utils/      Formatting and media helpers
tests/        Playwright end-to-end, device, responsive, and accessibility tests
worker/       Cloudflare Worker routes, authentication, admin, media catalog, favourites, and TMDB proxy
```

## TMDB attribution

South Africa (`ZA`) is the default region for provider availability. Provider data is supplied through TMDB's JustWatch integration and can change.

**This product uses the TMDB API but is not endorsed or certified by TMDB.**
