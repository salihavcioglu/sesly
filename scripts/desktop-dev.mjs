#!/usr/bin/env bun
// ──────────────────────────────────────────────────────────────────────────
// desktop-dev.mjs — launch `tauri dev` with a self-healing PATH.
//
// Why this exists: `tauri dev` shells out to `cargo`. On Windows especially, a
// terminal opened *before* rustup was installed keeps a stale PATH snapshot
// that lacks `~/.cargo/bin`, so `bun desktop` dies with
//     failed to run 'cargo metadata' command … program not found
// even though cargo IS installed and IS on the persisted User PATH — a brand
// new terminal would find it. Rather than make every contributor remember to
// reopen their shell, prepend the standard rustup bin dir here when cargo isn't
// already resolvable. Cross-platform (`~/.cargo/bin` on macOS/Linux/Windows)
// and a complete no-op when cargo is already on PATH, so nothing changes for
// anyone whose environment is already correct.
//
// Invoked as the frontend `desktop` script (`bun ../scripts/desktop-dev.mjs`),
// so cwd is frontend/ and `bun run tauri dev` resolves the workspace-local
// @tauri-apps/cli. All extra args are forwarded untouched.
// ──────────────────────────────────────────────────────────────────────────
import { spawnSync } from "node:child_process";
import process from "node:process";
import { DEV_APP_PROCESS_NAME } from "./desktop-common.mjs";
import { launchTauriDev } from "./desktop-dev-launch.mjs";
import { desktopRuntimeReady } from "./desktop-runtime-preflight.mjs";
import {
  cargoMissingMessage,
  healToolchainPath,
  healedPathNotes,
} from "./desktop-toolchain-path.mjs";

/**
 * Take down a leftover dev app before starting a new one.
 *
 * Launching a second `bun desktop` while one is already running does NOT just
 * fail politely — it cascades into a BLANK WINDOW. Reproduced deterministically:
 * the new launch's port grab makes the running instance's `dev:api` exit, and
 * `concurrently --kill-others-on-fail` then tears down that instance's whole
 * stack *including its Vite server* — leaving its window open, pointed at a
 * dev URL that no longer answers, with an empty #root. The user sees a black
 * app and nothing explains why.
 *
 * So: clear the previous dev instance first, loudly. Deliberately matches ONLY
 * the cargo-built dev binary (`sesly-dev`); the installed release app is
 * `Sesly` and is never touched.
 */
function killStaleDevApp() {
  const NAME = DEV_APP_PROCESS_NAME;
  try {
    if (process.platform === "win32") {
      const list = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${NAME}.exe`, "/NH"], {
        encoding: "utf8",
      });
      if (!list.stdout || !list.stdout.toLowerCase().includes(`${NAME}.exe`)) return;
      spawnSync("taskkill", ["/F", "/T", "/IM", `${NAME}.exe`], { stdio: "ignore" });
    } else {
      // -f matches the full path so we hit target/debug/sesly-dev only.
      const found = spawnSync("pgrep", ["-f", `${NAME}$`], { encoding: "utf8" });
      if (found.status !== 0) return;
      spawnSync("pkill", ["-f", `${NAME}$`], { stdio: "ignore" });
    }
    console.log(
      "[desktop-dev] closed a previous dev app instance - two instances fight over the " +
        "dev server and leave one window blank. Starting a clean one.",
    );
  } catch {
    // Best-effort: never block a launch because cleanup failed.
  }
}

if (!desktopRuntimeReady()) process.exit(1);
killStaleDevApp();

// Start from the real environment; heal a stale PATH into a *copy* (mutating
// process.env doesn't reliably propagate to children under Bun). Shared with
// desktop-prod / desktop-fresh so every launcher fixes the same class of
// "installed but not on this terminal's PATH" failure.
const { env: childEnv, added, missing } = healToolchainPath(process.env);
for (const note of healedPathNotes(added, "desktop-dev")) console.log(note);
if (missing.includes("cargo")) {
  console.error(cargoMissingMessage("`tauri dev`"));
  process.exit(1);
}

// `frontend/dist` is a required bundle resource even under `tauri dev`.
// The helper creates it before spawning Tauri and is behavior-tested with an
// injected process runner (#1664). cwd is already frontend/.
const res = launchTauriDev({ env: childEnv });
if (res.error) {
  console.error(`❌ failed to launch tauri dev: ${res.error.message}`);
  process.exit(1);
}
// #1177: "builds but won't launch" (reported on Discord) is the from-source
// twin of the packaged app's evidence-free "Can't reach the local Sesly
// backend": cargo compiles fine, the shell exits non-zero, and this script
// used to forward the bare status and say NOTHING — leaving the user with a
// silent exit code and nowhere to look. Point at the two places that actually
// hold the reason. A clean exit (Ctrl-C / closing the window) stays silent.
const status = res.status ?? 1;
if (status !== 0 && status !== 130) {
  console.error(
    [
      "",
      `❌ the desktop shell exited with code ${status}.`,
      "",
      "   The reason is in one of these — the shell logs the backend's failure",
      "   even when the window never appears:",
      "     • the cargo/tauri output above (a Rust panic or a webview error)",
      "     • omnivoice.log and backend_err.log in your Sesly data folder",
      // Paths mirror resolveDataDir() in dev-backend.mjs, itself a mirror of
      // backend/core/config.py::get_app_data_dir — keep all three in step.
      "       (macOS: ~/Library/Application Support/OmniVoice,",
      "        Linux: ~/.omnivoice,",
      "        Windows: %APPDATA%\\Sesly)",
      "",
      "   Common causes and fixes: docs/install/troubleshooting.md",
      "",
    ].join("\n"),
  );
}
process.exit(status);
