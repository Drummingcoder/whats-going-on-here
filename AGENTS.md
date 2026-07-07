# Repository Instructions

## Project Shape
- This is a plain Chrome Manifest V3 extension; there is no `package.json`, lockfile, build step, test runner, linter, or CI config in the repo.
- Load/test it manually from `chrome://extensions` with Developer Mode -> Load unpacked -> repo root; after changing extension files, reload the unpacked extension.
- `manifest.json` wires `background.js` as the service worker, `content.js` on `<all_urls>` at `document_idle`, and `popup.html` as the action popup.

## Main Entrypoints
- `background.js` owns session/event tracking, heartbeat/offline inference, tab/window listeners, `chrome.runtime.onMessage`, and dynamic blocking rules.
- `content.js` only reports page visibility, focus/blur, inactivity, and page title back to the background script; keep message action names aligned with `background.js`.
- `popup.js` renders current active-tab/session time and opens `overview.html`.
- `overview.js` is the settings and analytics UI; it dynamically loads the vendored `chart.js` file when creating the pie chart.

## State And Messaging
- Tracking data is event-based in `chrome.storage.local.eventLog`, keyed by `new Date(timestamp).toDateString()`; overview/popup derive totals from this log.
- Active session recovery uses `chrome.storage.local.persistedSession` plus `lastHeartbeat`; be careful changing timeout, day rollover, or shutdown behavior in `background.js`.
- User settings live mostly in `chrome.storage.sync`: `allowedSites`, `blockedSitesList`, `blockingScheduleRules`, `blockingPassword`, `redirectUrl`, and fallback `pendingBlockingUpdate`.
- Blocking updates flow from `overview.js` -> runtime message `updateBlockingRules` -> `background.js` -> `chrome.declarativeNetRequest` dynamic rules; the fallback saves `pendingBlockingUpdate` and reloads the runtime.

## Repo-Specific Gotchas
- The README and UI both note scheduled blocking is present but not working; do not assume schedule rules are reliable without manual verification.
- Blocking rule changes may require closing/reopening Chrome or reloading the extension to fully apply to existing tabs.
- `chart.js` is vendored/minified Chart.js v4.5.0 with a local comment; avoid editing it unless intentionally updating the vendor file.
- The code uses direct DOM APIs and Chrome callback-style APIs, not modules or a bundler; new scripts must be included explicitly from HTML or `manifest.json`.
