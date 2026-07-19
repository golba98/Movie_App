# Watch Party rooms

## Feature flag (not enabled in production)

Watch Party is still under development and is gated out of production:

- **Frontend** — `watchPartyEnabled` in `src/utils/featureFlags.ts`: on in dev (`npm run dev`), off in production builds unless `VITE_ENABLE_WATCH_PARTY=true` is set at build time. Use `npm run build:watch-party && npm run preview` to test a production build (e.g. the extension flow on :4173). When off, the `/watch-party/*` routes and the "Watch with friends" button are not rendered.
- **Worker** — every `/api/watch-party/*` route returns 404 unless the `WATCH_PARTY_ENABLED` secret equals `"true"`. It is declared in `wrangler.jsonc` `secrets.required` (declaration only — a secret name listed there replaces `.dev.vars` inference, so the worker would never see the var otherwise) and set to `"true"` in `.dev.vars` for local dev/preview. Production deliberately never sets the secret, so deploys ship with the API disabled (`wrangler deploy` may warn about the missing secret — that is expected). To enable in production later: `wrangler secret put WATCH_PARTY_ENABLED` with value `true`.
- The `WatchPartyRoom` Durable Object binding stays deployed (removing it would require a destructive migration); with the routes disabled it is never instantiated.

## Architecture

Watch Party keeps video delivery in every participant's own browser. It never relays video, shares a browser tab, uses WebRTC, requests a camera or microphone, or supplies in-app calling. Rooms only accept active administrator-configured MP4/WebM sources that are suitable for the native player; dynamic external providers are not available in rooms.

Each room maps to one Cloudflare Durable Object (`WatchPartyRoom`). The object serializes room actions, owns the current playback state and revision, keeps hibernating WebSocket connections, and broadcasts only server-authorized state. D1 persists durable metadata, invitations, bans, expiry and moderation audit records; it does not receive a playback-position write every second.

## Routes and HTTP API

| Route | Purpose |
| --- | --- |
| `/watch-party/join` | Join by short room code. |
| `/watch-party/:roomId` | Lobby, then synchronized room player. |
| `POST /api/watch-party/rooms` | Authenticated room creation. |
| `GET /api/watch-party/lookup?code=…` | Resolve a room code. |
| `GET /api/watch-party/rooms/:roomId` | Lobby-safe room summary. |
| `POST /api/watch-party/rooms/:roomId/join` | Join with a guest name, password, and/or signed invitation. |
| `GET /api/watch-party/rooms/:roomId/state` | Read the current state with a room access token. |
| `GET /api/watch-party/rooms/:roomId/media` | Return the selected authorised source with a room access token. |
| `GET /api/watch-party/rooms/:roomId/socket` | WebSocket transport; requires the short-lived room access token. |
| `POST /api/watch-party/rooms/:roomId/extension-token` | Exchange a current room bearer token for a one-use, 120-second extension token. |
| `GET /api/watch-party/rooms/:roomId/extension-socket` | Credential-free extension WebSocket upgrade from a valid `chrome-extension://` origin. |
| `POST /api/watch-party/extension/dev-connect` | Localhost-only room-code connection for extension development; production returns 404. |
| `POST /api/watch-party/rooms/:roomId/invitation` | Regenerate an invite-only room link. |

Room creation needs an authenticated viewer. Public rooms use a link or code, private rooms additionally require a password, and invite-only rooms require a valid signed invitation. Guests select a 2–32-character display name. The server intentionally returns generic unavailable responses for private, expired, invalid-invite, full, and banned join failures.

## WebSocket contract

Every post-authentication client message has `eventId` and `baseRevision`. The Durable Object discards duplicate control event IDs and rejects non-sync control messages whose revision is stale. Extension sockets must send `extension:authenticate` first; pending sockets are closed after 10 seconds by the existing room alarm scheduler.

Client events: `extension:authenticate`, `room:ready`, `room:sync-request`, `playback:play-request`, `playback:pause-request`, `playback:seek-request`, `playback:restart-request`, `playback:rate-request`, `playback:buffering`, `playback:client-snapshot`, `control:request`, `control:grant`, `host:transfer`, `room:lock`, `room:end`, and `participant:remove`.

Server events: `room:joined`, `room:state`, `playback:state`, `playback:sync`, `room:ended`, and structured `error` responses. State-bearing events include the complete authoritative room state, including the revision, server timestamp, selected media, settings, presence, activity, position, rate, and playback state. Sync replies echo the requesting event ID. Accepted playback actions include optional `{ reason, executeAtServerMs }` metadata with a 120 ms lead; website clients can ignore it.

Extension snapshots contain position, state, rate, buffering, readiness, and drift. They are stored only in the connection attachment, do not increment the revision, and never become authoritative. Attachments contain only the minimum connection identity and capability metadata needed to restore an authenticated socket after Durable Object hibernation.

## Permission rules

- The host can always control playback, lock/end the room, grant control, remove or ban participants, and transfer host ownership.
- `host_only` is the default. `everyone` permits every participant. `approved` and `request` require host-granted control.
- Moderators, when present, can remove or ban but cannot change playback or transfer host ownership.
- A disconnected host has a two-minute grace period. On expiry, ownership transfers deterministically to a connected moderator, otherwise the connected participant who joined earliest.

## Synchronization

The authoritative position is not broadcast on every video frame. While playing, a client computes:

`positionMs + (serverNow - stateUpdatedAt) × playbackRate`

The client asks for a sync every four seconds and after reconnecting or returning to the tab. It synchronizes immediately after accepted playback actions and room entry. Remote state is applied under a suppression flag, preventing native player callbacks from feeding a programmatic seek or pause back into the room.

Absolute drift at or below 250 ms is ignored. Between 251 ms and 1.5 s, the companion temporarily applies `authoritativeRate × clamp(1 + driftMs / 50_000, 0.97, 1.03)`. Above 1.5 s, and for explicit seek/recovery commands, it seeks to the nearest valid position. The authoritative rate is restored at convergence or after four seconds.

## Security and operations

- Room IDs, codes, access tokens, and invitation tokens are generated with Web Crypto randomness; invitations and access grants are HMAC signed with `WATCH_PARTY_SIGNING_SECRET`.
- The Worker checks room membership, revision, origin, action permissions, malformed payload size, duplicate event IDs, password verification, bans, lock state, capacity, and expiry before accepting an action.
- Password attempts are throttled per room and requester. Password verification uses the existing PBKDF2 + timing-safe comparison path.
- Keep `WATCH_PARTY_SIGNING_SECRET` only in `.dev.vars` locally and in Cloudflare Worker secrets in production. Use a long, random value; rotating it invalidates outstanding room access and invitation tokens.
- The website room token remains on the existing website socket for backward compatibility. Extension socket URLs contain no credentials, accept only `chrome-extension://[a-p]{32}` origins, and use one-use extension-purpose tokens.

See [`watch-sync-extension.md`](./watch-sync-extension.md) for extension permissions, build instructions, fixture coverage, and the manual Chromium checklist.

## Local development and deployment

Add this to the ignored `.dev.vars` file alongside the existing secrets:

```text
WATCH_PARTY_SIGNING_SECRET=generate-a-long-random-value
```

Then run `npm run cf:types`, `npm run db:migrate:local`, and `npm run dev`. For production, run `npm run db:migrate:remote`, set `WATCH_PARTY_SIGNING_SECRET` with `npx wrangler secret put WATCH_PARTY_SIGNING_SECRET`, and deploy the Worker. The Durable Object migration in `wrangler.jsonc` must ship with the Worker configuration.
