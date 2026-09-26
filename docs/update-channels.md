# Update channels (Stable / Preview)

Sesly checks for updates shortly after launch and every six hours while
it stays open. You choose **which builds** it offers you with the update
channel in **Settings → Updates → Update channel**.

| Channel | What you get | Who it's for |
|---------|--------------|--------------|
| **Stable** (default) | The latest tagged `vX.Y.Z` release. | Everyone. This is the default on every install and every launch. |
| **Preview** | The latest `main` build (a rolling `preview` prerelease). Newer features, less testing. Falls back to a stable release if one is ahead. | Users who want to try fixes/features before they're tagged, and report issues. |

Switching is instant — the next automatic or manual check uses your chosen
channel. Downloads show transferred size, total size, speed, percentage and
ETA, and can continue while synthesis, transcription or dubbing work runs.
Sesly only enables **Restart to update** after the package has downloaded
and passed the updater's signature/checksum verification, and blocks that
restart until active work has finished and current drafts are flushed.

There are **no accounts or updater telemetry**. Stable checks fetch only the
Stable manifest. Preview checks compare the small Stable and Preview manifests,
then use whichever has the newer version; package download begins when the user
asks. Both channels use a different release location:

- Stable → `releases/latest/download/`
- Preview → `releases/download/preview/`

The Electron feed publishes a platform/architecture-specific manifest with a
SHA-512 package checksum; the Tauri feed publishes its signed `latest.json`.
Each desktop shell rejects a package that fails its integrity check.

## Your data during updates

Your voices, projects, history, and settings live in a SQLite database
(`omnivoice.db`) outside the app bundle, so replacing the app never touches
them. On the **first launch of an updated build**, if the new version needs a
database schema upgrade, Sesly:

1. **Backs up the database first** — a consistent snapshot is written next to
   it as `omnivoice.db.backup-<version>-<n>` before any migration runs. The
   newest **3** backups are kept; older ones are pruned automatically.
   (Databases over 500 MB skip the snapshot, with a log line saying so.)
2. **Stops instead of guessing** — if a migration fails midway, the app does
   *not* start on a half-migrated database and does *not* silently restore
   anything. It shows an error naming the backup path so you (or a support
   thread) decide: retry, report the issue, or roll back by replacing
   `omnivoice.db` with the backup.

**Settings → Updates** shows the timestamp of the latest backup, the release
notes of any available update, and a **What's new** reader for the shipped
changelog — all local, no extra network calls.

The Python environment (`.venv`) is also updated non-destructively: dependency
drift after an app update is reconciled **in place** with `uv sync`, and a
failed sync keeps the previous environment working. The venv is only ever
rebuilt when its interpreter is *confirmed* broken (structural check + a
direct probe) or when you explicitly use **Clean & Retry**.

## For maintainers — how previews are built

Preview builds come from **`main`**, two ways:

- **Nightly (automatic).** A scheduled job (07:00 UTC) rebuilds the rolling
  `preview` prerelease from `main` — but only when `main` actually moved in the
  last day, so idle days cost nothing. Preview is never more than ~24h behind
  `main`.
- **On demand.** **Actions → Desktop Release → Run workflow** on `main`, set
  **publish_preview = true**. Useful to refresh immediately without waiting
  for the nightly. Previews build from `main` **only** (hard rule, decided
  2026-07-16) — the preview-gate refuses any other branch; to preview a fix,
  merge it to `main` first.

Either way it builds the matrix and publishes/updates a single rolling
`preview` **prerelease** — always flagged prerelease, and carrying the same
platform set as stable (both verified in CI after each preview publish) — with
its own signed `latest.json`. The tagged `latest` stable release is never
affected. Preview users get the new build on their next check; stable users see
nothing.

To stop offering previews, delete the `preview` release/tag on GitHub — the
Preview channel then falls back to stable.
