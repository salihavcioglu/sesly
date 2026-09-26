# Electron diagnostics

Settings > Logs provides Backend and Frontend sources. Backend logs use the existing
rolling-log API, with the shell startup tail as a fallback when the API is unavailable.
Frontend logs reuse the existing bounded console buffer. Nothing is sent remotely.

Search filters the visible lines; Copy copies that view. Refresh fetches immediately,
and the view refreshes every three seconds. Scrolling up stops automatic scrolling
until the reader returns to the bottom. Clear requires an explicit confirmation.
The backend log file can be revealed with the native file manager when available.
Synthesis error details link directly to this settings view. Error and failure lines
are red, warnings amber, successful readiness events green, and debug output muted.
**Repair with an agent** opens the footer dock without covering the log and preloads
the visible failure and warning lines as repair context.

Run `node electron/tests/logs-smoke.mjs` against the development renderer. It mocks
backend reads/clears and checks frontend capture without clearing any real log files.
