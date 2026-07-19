# Chromium Watch Sync companion

## Scope

The companion is a Manifest V3 Chromium extension in `packages/watch-sync-extension/`. It controls only native `HTMLVideoElement` instances in user-approved HTTP(S) origins. It does not relay media, inspect or log media URLs, use `MAIN`-world injection, request capture APIs, or permanently inject a player controller across all sites.

The shipped manifest permanently trusts only the Fedora Movies production app and `http://127.0.0.1:4173`. Player pages are optional host permissions requested from the popup. The fixture-only manifest pregrants `127.0.0.1:4300` and `:4301` so automated Chromium runs do not depend on browser permission UI.

## Build and load

```bash
npm install
npm run extension:build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `packages/watch-sync-extension/dist/`. Keep the Fedora Movies watch-party room tab open: it mints one-use 120-second tokens for connection and reconnection.

## Permission and player flow

1. Open the popup on the tab containing the player.
2. Review the top-level origin. Embedded frame origins are listed separately and are not silently selected.
3. Select only the origins that contain the intended player and choose **Enable sync on this tab**.
4. The popup calls `chrome.permissions.request()` directly from that click, then the service worker injects the isolated controller into each permitted frame separately.
5. Select a player when candidates are ambiguous. A manual selection is preserved while the same document and safe fingerprint remain present.
6. Return to the watch-party room and choose **Connect browser extension**. Companion mode unmounts the in-app player only after the extension reports a successful socket connection.
7. Choose **Use in-app player** to disconnect the companion before restoring the website player.

Origin preferences and the diagnostics toggle use `chrome.storage.local`. Room identifiers, tokens, socket state, and reconnect state use `chrome.storage.session`. Diagnostics are metadata-only, capped at 500 entries, allowlisted, and recursively redacted before popup export.

## Automated checks

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:extension
npm run test:extension:integration
npm run test:e2e -- --project=chromium
npm run build
npm run extension:build
npx wrangler deploy --dry-run
```

The integration build uses `manifest.test.config.ts`. It launches two separate persistent Chromium contexts, scans the two-origin fixture, injects the player controller per frame, verifies manual target preservation across video replacement, reinjects after iframe navigation, scores a tiny preview separately, shuts controllers down before revocation, and confirms the second profile remains independent.

## Manual 20-step Chromium checklist

Record a result only when it was directly observed. Automated coverage is useful evidence but is not a substitute for the browser permission prompt or visual/manual checks.

1. Run `npm run extension:build` and confirm `packages/watch-sync-extension/dist/manifest.json` exists.
2. Open `chrome://extensions`, enable Developer mode, and load `packages/watch-sync-extension/dist/` unpacked.
3. Start the app at `http://127.0.0.1:4173` and the fixture with `npm run extension:fixtures`.
4. Open `http://127.0.0.1:4300` and confirm its iframe loads `http://127.0.0.1:4301`.
5. Open the extension popup and confirm the top origin and embedded origin are listed separately.
6. Select both fixture origins and choose **Enable sync on this tab**; observe the real runtime permission prompt.
7. Create or join a watch party in profile A and keep its room tab open.
8. Create a separate Chromium profile B, load the unpacked extension, grant the same two fixture origins, and join the room as a second participant.
9. In both profiles, confirm the full-size player outranks the tiny muted looping preview; make a manual selection if the popup reports ambiguity.
10. Trigger playback once locally if Chrome reports that activation is required.
11. From the host, press Play and confirm both selected players start after the scheduled command lead.
12. Press Pause and confirm both selected players pause and align.
13. Seek forward 10 seconds and confirm both profiles converge without an echoed local seek.
14. Seek backward 10 seconds and confirm the same behavior.
15. Introduce 251–1,500 ms drift and observe bounded temporary rate correction, rate restoration, and the one-second reevaluation cooldown.
16. Introduce drift above 1,500 ms and observe a hard seek; repeat inside two seconds to verify the non-explicit hard-seek cooldown.
17. Use **Navigate player iframe**, then **Replace main video**, and confirm the controller reinjects while stale document targets are removed.
18. Interrupt the extension socket and confirm reconnect backoff/status, fresh-token request through the room tab, and the clear reopen-room message when that tab is closed.
19. Inspect Network activity and confirm only room protocol metadata crosses the extension socket; the MP4 remains a direct browser request and is never relayed through the Worker.
20. Choose **Revoke selected access** and confirm controller shutdown occurs first, playback control stops, and later iframe navigation does not reinject without a new grant.

## Observed status for this implementation run

- Automated extension unit tests: observed.
- Automated two-profile fixture integration: observed.
- Website companion-mode Playwright regression: observed.
- Real unpacked-extension permission prompt: not manually observed.
- Full two-person room sequence with intentional medium/large drift and network-panel inspection: not manually observed.

## Explicit limitations

Unsupported targets include pages without a native video, canvas playback, protected browser surfaces, inaccessible or continuously replaced frames, injection-blocked pages, and timelines that do not represent the same media. Autoplay can require a real pointer or keyboard activation. Permission to a page does not make an otherwise inaccessible browser surface controllable.
