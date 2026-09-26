//! Backend process management: spawn, port probing, log paths.

use std::fs;
use std::io::BufRead;
use std::io::BufReader;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::Manager;

use crate::bootstrap::{
    BootstrapStage, current_attempt, emit_log_for_attempt, ensure_venv_ready, set_stage,
};
use crate::config::load_config;
use crate::tools::{resolve_ffmpeg, resolve_ffprobe};
use crate::backend_port;

// ── Port probing ──────────────────────────────────────────────────────────

/// Just "something is listening on :port"
pub fn port_in_use(port: u16) -> bool {
    TcpStream::connect_timeout(
        &(std::net::Ipv4Addr::LOCALHOST, port).into(),
        Duration::from_millis(200),
    )
    .is_ok()
}

/// Full health check — returns true only if the responder at :port is
/// actually our Sesly backend.
pub fn backend_healthy(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{}/system/info", port);
    match ureq_get_with_timeout(&url, Duration::from_millis(500)) {
        Ok(body) => is_omnivoice_body(&body),
        Err(_) => false,
    }
}

fn is_omnivoice_body(body: &str) -> bool {
    body.contains("\"model_checkpoint\"") || body.contains("\"data_dir\"")
}

/// The `app_version` reported by the Sesly backend at :port.
/// `None` when nothing Sesly answers there (port free, or a foreign
/// process). `Some("")` when it IS our backend but predates the
/// `app_version` field — callers treat that as stale.
pub fn running_backend_version(port: u16) -> Option<String> {
    let url = format!("http://127.0.0.1:{}/system/info", port);
    let body = ureq_get_with_timeout(&url, Duration::from_millis(500)).ok()?;
    if !is_omnivoice_body(&body) {
        return None;
    }
    Some(parse_app_version(&body).unwrap_or_default())
}

/// Extract `"app_version": "X"` from a /system/info body. String-sniff on one
/// field (consistent with `backend_healthy`) — no JSON dependency needed.
fn parse_app_version(body: &str) -> Option<String> {
    let key = "\"app_version\"";
    let rest = &body[body.find(key)? + key.len()..];
    let rest = rest[rest.find(':')? + 1..].trim_start();
    let rest = rest.strip_prefix('"')?;
    Some(rest[..rest.find('"')?].to_string())
}

/// The `data_dir` the running backend advertises via `/system/info` — the
/// directory `backend/core/config.py::get_app_data_dir()` resolved for
/// itself (honors `OMNIVOICE_DATA_DIR`, else the per-OS default).
///
/// This exists so Tauri's one-shot host-path capability files
/// (`commands::authorize_host_path`) always land where
/// `backend/core/path_authorization.py` actually looks for them. Tauri's own
/// `setup::resolved_data_dir` normally agrees with the backend, but they can
/// diverge: dev mode spawns the backend out-of-process
/// (`scripts/dev-backend.mjs`, which strips `OMNIVOICE_*` from the child
/// env) so it may fall back to a different platform default than Tauri
/// computes, and in a packaged build a custom data folder or portable mode
/// applied after the backend already started can do the same (#1781).
/// Asking the backend directly makes the two processes structurally unable
/// to disagree.
///
/// `None` when nothing Sesly answers at `port` (not started yet,
/// unreachable) or an old backend predating the `data_dir` field — callers
/// fall back to Tauri's own resolution, the historical behavior.
///
/// Only an ABSOLUTE path is accepted. `get_app_data_dir()` returns
/// `OMNIVOICE_DATA_DIR` verbatim, so a relative value (`OMNIVOICE_DATA_DIR=
/// omnivoice_data`, plausible for source/Docker setups) would make the
/// backend resolve the store against ITS working directory while Tauri
/// resolved the same string against its own — silently recreating the very
/// split this function exists to close. A relative advertisement is
/// therefore treated as unusable and the caller falls back, which is also
/// what keeps a foreign responder on the port from steering capability
/// writes to a path of its choosing.
pub fn backend_data_dir(port: u16) -> Option<String> {
    let url = format!("http://127.0.0.1:{}/system/info", port);
    let body = ureq_get_with_timeout(&url, Duration::from_millis(500)).ok()?;
    if !is_omnivoice_body(&body) {
        return None;
    }
    parse_json_string_field(&body, "data_dir")
        .filter(|dir| !dir.is_empty() && Path::new(dir).is_absolute())
}

/// Whether a running backend's version matches THIS app build, comparing
/// **base** versions (any `-N` pre-release suffix stripped from both sides) so
/// a preview build `0.3.10-4` still attaches to its `0.3.10` backend.
///
/// Why this exists (the "bound port blocked the newer version" report): an
/// orphaned backend from a *previous* version keeps answering health checks
/// after an update, so "healthy" alone made the new UI silently attach to old
/// backend code — every fix in the update appeared to change nothing. A
/// version-mismatched (or unversioned) Sesly responder is stale by
/// definition; callers kill it and spawn the bundled backend instead.
pub fn same_app_version(running: &str) -> bool {
    fn base(v: &str) -> &str {
        v.split('-').next().unwrap_or(v).trim()
    }
    !running.is_empty() && base(running) == base(env!("CARGO_PKG_VERSION"))
}

/// `app_version` + `code_fingerprint`, parsed from ONE `/system/info` fetch
/// — see `code_fingerprint_is_current` for how callers interpret
/// `code_fingerprint`.
#[derive(Debug, PartialEq, Eq)]
pub struct BackendIdentity {
    pub version: String,
    /// `None` when the response has no `code_fingerprint` key at all (an old
    /// backend whose `/system/info` schema predates the field, since a
    /// *present* field always serializes — even as `""`). `Some("")` when
    /// the field is present but blank (current schema, but the process
    /// wasn't spawned with `OMNIVOICE_BUILD_FINGERPRINT` set — dev mode's
    /// `dev-backend.mjs` strips `OMNIVOICE_*`, and a manually started
    /// `uvicorn` never sets it).
    pub code_fingerprint: Option<String>,
}

/// Parse both fields out of a single already-fetched `/system/info` body.
/// Pure — no network — so the absent/blank/known distinction is unit-tested
/// directly against fixture bodies, not against a live probe.
fn parse_backend_identity(body: &str) -> Option<BackendIdentity> {
    if !is_omnivoice_body(body) {
        return None;
    }
    Some(BackendIdentity {
        version: parse_app_version(body).unwrap_or_default(),
        code_fingerprint: parse_json_string_field(body, "code_fingerprint"),
    })
}

/// `running_backend_version` + a separate `code_fingerprint` fetch used to be
/// two independent `/system/info` round-trips in the attach handshake —
/// besides the redundant probe, that let a transport hiccup on the *second*
/// fetch (a transient timeout, not "no key in the body") come back as
/// `None`, indistinguishable from a successfully parsed body that genuinely
/// lacks `code_fingerprint`. `code_fingerprint_is_current` treats a missing
/// key as stale, so that ambiguity could kill and respawn a perfectly
/// healthy backend on a single flaky probe. One fetch removes the ambiguity
/// structurally: `None` here means "nothing answered at all" (the caller's
/// existing "no Sesly here" branch), full stop — it can never be
/// confused with "answered, but the field was absent from that body".
pub fn running_backend_identity(port: u16) -> Option<BackendIdentity> {
    let url = format!("http://127.0.0.1:{}/system/info", port);
    let body = ureq_get_with_timeout(&url, Duration::from_millis(500)).ok()?;
    parse_backend_identity(&body)
}

/// Whether an already-version-matched running backend's *code* is current
/// enough to attach to, for the `prepare_backend_launch` handshake (#1770).
///
/// `running` is `BackendIdentity::code_fingerprint` from the SAME
/// `/system/info` fetch that established the version match — never a
/// separate probe (see `running_backend_identity`'s doc comment for why);
/// `ours` is `bootstrap::own_backend_code_fingerprint`'s.
///
/// - `running: None` — the backend's `/system/info` has no `code_fingerprint`
///   key at all, meaning its code predates this fingerprinting mechanism
///   outright. Because `main` holds one version string for an entire
///   release cycle (see `same_app_version`'s doc comment), a matching
///   version string does NOT mean matching code — this is exactly the class
///   of bug #1770 reported: a same-version backend running weeks-old code
///   was attached to and adopted as current. Treated as STALE, the same
///   "replace it" outcome a version mismatch already gets.
/// - `running: Some("")` — the field IS present (current schema) but blank:
///   confirmed at-least-this-fix-or-later by schema, just unverifiable
///   further (no env var at spawn time — dev mode, a manually started
///   backend). Accepted rather than hard-failing every dev session or
///   manual-start workflow.
/// - `ours: None` — we failed to compute our own fingerprint (unreadable
///   resource dir / dev root). We can't enforce a check we can't compute
///   either side of, so this degrades to accept too, same as the historical
///   version-only behavior.
/// - both `Some` — must match exactly; a mismatch is STALE.
pub fn code_fingerprint_is_current(running: Option<&str>, ours: Option<&str>) -> bool {
    match (running, ours) {
        (None, _) => false,
        (Some(""), _) => true,
        (Some(_), None) => true,
        (Some(r), Some(o)) => r == o,
    }
}

/// Deep health probe for the attach-to-a-running-backend shortcut.
///
/// `/health` and `/system/info` keep answering from a backend whose install
/// was deleted out from under it (files unlinked on disk, code already in
/// memory) — that zombie passes the version check and then 500s every real
/// route, so the UI looks alive but nothing works. Probe a DB-touching
/// endpoint and require an actual `200` status line before attaching;
/// anything else (500, timeout, refused) means the responder is not a
/// backend worth keeping.
pub fn backend_deep_healthy(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{}/profiles", port);
    match raw_http_get(&url, Duration::from_millis(1500)) {
        Ok(resp) => parse_http_status(&resp) == Some(200),
        Err(_) => false,
    }
}

/// Readiness = identity AND capability. The shallow probe proves the
/// responder is OUR backend; the deep probe proves it can actually serve a
/// DB-backed route. Declaring Ready on the shallow probe alone announced a
/// backend whose install/DB was broken underneath as up — the UI looked
/// alive while every real request 500'd or dead-ended on "can't reach the
/// backend". Both Ready transitions (startup poll, supervisor respawn wait)
/// gate on this; the supervisor's DEATH detection stays process-exit-only
/// (`try_wait`), so a busy-but-alive backend is still never killed.
pub fn backend_ready(port: u16) -> bool {
    backend_healthy(port) && backend_deep_healthy(port)
}

/// Startup progress from the backend's early-bind `/startup/progress`
/// endpoint: `(status, step, label)`, e.g. `("starting", "ml_imports",
/// "Loading ML runtime (PyTorch)…")`. `None` when nothing answers, when the
/// responder lacks the `x-omnivoice-backend` marker header (a foreign
/// process on our port must not narrate our splash), or on an old backend
/// without the endpoint — callers fall back to the legacy probes.
pub fn startup_progress(port: u16) -> Option<(String, String, String)> {
    let url = format!("http://127.0.0.1:{}/startup/progress", port);
    let resp = raw_http_get(&url, Duration::from_millis(800)).ok()?;
    if parse_http_status(&resp) != Some(200) {
        return None;
    }
    let head_end = resp.find("\r\n\r\n").unwrap_or(resp.len());
    if !resp[..head_end].to_ascii_lowercase().contains("x-omnivoice-backend") {
        return None;
    }
    let body = &resp[resp.find("\r\n\r\n").map(|i| i + 4).unwrap_or(0)..];
    let status = parse_json_string_field(body, "status")?;
    let step = parse_json_string_field(body, "step").unwrap_or_default();
    let label = parse_json_string_field(body, "label").unwrap_or_default();
    Some((status, step, label))
}

/// First `"key": "value"` string field in a JSON body — same dependency-free
/// sniffing style as `parse_app_version`. `None` for absent or non-string
/// (e.g. `null`) values.
///
/// Decodes JSON string escapes properly (`decode_json_string`) rather than
/// substring-slicing to the first `"` byte: a naive slice returns the
/// literal wire form, which breaks on any value containing a backslash or an
/// escaped quote. This matters most for `data_dir` — a Windows path like
/// `C:\Users\x\AppData\Roaming\OmniVoice` serialises as
/// `"C:\\Users\\x\\..."`, and slicing to the first raw `"` would either hand
/// back the doubled-backslash form verbatim or, for a path containing a
/// literal quote, truncate the value outright.
fn parse_json_string_field(body: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let rest = &body[body.find(&needle)? + needle.len()..];
    let rest = rest[rest.find(':')? + 1..].trim_start();
    let rest = rest.strip_prefix('"')?;
    decode_json_string(rest)
}

/// Decode a JSON string body starting right after its opening `"`, stopping
/// at the first *unescaped* closing `"`. Handles `\\`, `\"`, `\/`, `\n`,
/// `\r`, `\t`, `\b`, `\f`, and `\uXXXX` (including UTF-16 surrogate pairs for
/// codepoints outside the BMP). Returns `None` on an unterminated string or a
/// malformed escape — matching the previous function's `?`-propagating
/// behavior on absent/malformed input.
fn decode_json_string(rest: &str) -> Option<String> {
    fn read_hex4(chars: &mut std::str::Chars) -> Option<u32> {
        let mut hex = String::with_capacity(4);
        for _ in 0..4 {
            hex.push(chars.next()?);
        }
        u32::from_str_radix(&hex, 16).ok()
    }

    let mut chars = rest.chars();
    let mut out = String::new();
    loop {
        let c = chars.next()?;
        if c == '"' {
            return Some(out);
        }
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next()? {
            '"' => out.push('"'),
            '\\' => out.push('\\'),
            '/' => out.push('/'),
            'n' => out.push('\n'),
            'r' => out.push('\r'),
            't' => out.push('\t'),
            'b' => out.push('\u{0008}'),
            'f' => out.push('\u{000C}'),
            'u' => {
                let code = read_hex4(&mut chars)?;
                if (0xD800..=0xDBFF).contains(&code) {
                    // High surrogate: must be followed by a \uXXXX low
                    // surrogate to form one codepoint outside the BMP.
                    if chars.next()? != '\\' || chars.next()? != 'u' {
                        return None;
                    }
                    let low = read_hex4(&mut chars)?;
                    if !(0xDC00..=0xDFFF).contains(&low) {
                        return None;
                    }
                    let cp = 0x10000 + (((code - 0xD800) << 10) | (low - 0xDC00));
                    out.push(char::from_u32(cp)?);
                } else if (0xDC00..=0xDFFF).contains(&code) {
                    return None; // lone low surrogate — malformed
                } else {
                    out.push(char::from_u32(code)?);
                }
            }
            _ => return None, // invalid escape
        }
    }
}

/// Status code from a raw HTTP response ("HTTP/1.1 200 OK" → 200).
fn parse_http_status(response: &str) -> Option<u16> {
    let line = response.lines().next()?;
    line.split_whitespace().nth(1)?.parse().ok()
}

fn ureq_get_with_timeout(url: &str, timeout: Duration) -> Result<String, String> {
    let buf = raw_http_get(url, timeout)?;
    if let Some(idx) = buf.find("\r\n\r\n") {
        Ok(buf[idx + 4..].to_string())
    } else {
        Err("no body".into())
    }
}

/// One raw loopback HTTP GET, returning the FULL response (status line +
/// headers + body). Kept dependency-free on purpose — see module docs.
fn raw_http_get(url: &str, timeout: Duration) -> Result<String, String> {
    let url = url.strip_prefix("http://").ok_or("only http:// supported")?;
    let (host_port, path) = match url.find('/') {
        Some(i) => (&url[..i], &url[i..]),
        None => (url, "/"),
    };
    let mut stream = TcpStream::connect_timeout(
        &host_port
            .to_socket_addrs()
            .map_err(|e| e.to_string())?
            .next()
            .ok_or("unresolvable")?,
        timeout,
    )
    .map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|e| e.to_string())?;
    let req = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
        path, host_port
    );
    use std::io::{Read, Write};
    stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut buf = String::new();
    stream.read_to_string(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Exit code `backend/main.py` uses when it could not bind the port (#1223).
/// Keep in sync with `_EXIT_PORT_IN_USE` there.
pub const EXIT_PORT_IN_USE: i32 = 78;

/// Confirm whether `port` is free. An unowned listener is never killed by
/// numeric PID: even a successful HTTP identity probe cannot make a reusable
/// PID/process-group identifier safe to signal.
///
/// #1223: every caller used to kill-then-sleep-then-spawn unconditionally, so
/// a holder we do not own was indistinguishable from success. The backend then
/// died on the bind with a raw errno and the user got "Backend died (exit code
/// 1)".
///
/// Returns true when the port is free afterwards. Polling accommodates the
/// short close handoff after a contained backend has just been drained.
pub fn free_port_or_report(port: u16) -> bool {
    kill_orphan_on_port(port);
    for _ in 0..20 {
        if !port_in_use(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    log::error!(
        "Port {} is still held by an unowned listener — the backend cannot \
         bind it. Quit the other Sesly instance or application and try \
         again.",
        port
    );
    false
}

/// Who is holding the port, as far as an HTTP request can tell (#1933).
///
/// The port-conflict failure used to assert "already in use by **another
/// application**" without asking. That is wrong in the common case: the holder
/// is usually the user's own orphaned backend from an earlier run, which has
/// no window to quit — so the message sent them to close a copy of Sesly
/// they cannot see, and gave them nothing that would work.
///
/// The identity check already existed (`running_backend_version`, used to
/// decide whether to attach to a healthy same-version backend, a far more
/// consequential decision). It just was not consulted here.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PortHolder {
    /// Nothing answered — either genuinely free, or a listener that accepts a
    /// connection but does not respond in time.
    Unknown,
    /// A Sesly backend, carrying the version it reports. Empty string
    /// when it predates the `app_version` field.
    OurBackend(String),
    /// Something answered `/system/info` and it was not us.
    Foreign,
}

/// Ask the listener on `port` who it is.
///
/// Stricter than `running_backend_version`, deliberately. That one accepts a
/// `/system/info` body containing `model_checkpoint` or `data_dir` — a
/// substring sniff, which is fine for deciding whether to ATTACH but not for
/// deciding what to tell a user to kill. This answer ends in a message naming
/// a process to end, so it requires the `x-omnivoice-backend` marker header
/// that `backend/main.py` stamps on every response (review). A body alone
/// can be served by anything; the header is what our backend actually asserts,
/// and `startup_progress` already gates on it for the same reason.
pub fn port_holder(port: u16) -> PortHolder {
    if !port_in_use(port) {
        return PortHolder::Unknown;
    }
    let url = format!("http://127.0.0.1:{}/system/info", port);
    let Ok(resp) = raw_http_get(&url, Duration::from_millis(500)) else {
        return PortHolder::Foreign;
    };
    let head_end = resp.find("

").unwrap_or(resp.len());
    if !resp[..head_end].to_ascii_lowercase().contains("x-omnivoice-backend") {
        // Something is listening but it does not identify as Sesly.
        // That covers a genuinely foreign app AND one of ours too wedged to
        // answer — `Foreign` is the conservative reading either way, since it
        // is the one that never tells a user to kill what is not theirs.
        return PortHolder::Foreign;
    }
    let body = &resp[resp.find("

").map(|i| i + 4).unwrap_or(0)..];
    if !is_omnivoice_body(body) {
        return PortHolder::Foreign;
    }
    PortHolder::OurBackend(parse_app_version(body).unwrap_or_default())
}

/// How to find and end the listener on `port`, for the platform this build
/// runs on. Offered only when the holder identified itself as our own backend.
///
/// Two steps, deliberately, and never a one-liner that pipes a lookup straight
/// into `kill`. `lsof -ti tcp:PORT` matches *connected clients* as well as the
/// listener, and Windows `findstr :3900` matches `:39001` and established
/// connections too — so the convenient one-liner can end a process that merely
/// talks to Sesly, or one that has nothing to do with it. The identity
/// `port_holder` established is a fact about the moment the message was
/// written; by the time the user runs a command it has to be re-established,
/// and only they can do that. So the first command shows exactly one listening
/// process to look at, and the second ends that pid.
fn reclaim_command(port: u16) -> String {
    if cfg!(target_os = "windows") {
        format!(
            "Get-NetTCPConnection -LocalPort {port} -State Listen | \
             Select-Object OwningProcess, @{{n='Name';e={{(Get-Process -Id \
             $_.OwningProcess).ProcessName}}}}\n\n    \
             ...then, once you have confirmed it is python or omnivoice:\n\n    \
             Stop-Process -Id <OwningProcess>"
        )
    } else {
        format!(
            "lsof -nP -iTCP:{port} -sTCP:LISTEN\n\n    \
             ...then, once you have confirmed the COMMAND is python or \
             omnivoice:\n\n    kill <PID>"
        )
    }
}

/// What to tell the user when the port could not be freed.
///
/// Pure, so the three wordings are unit-tested without a listener.
///
/// Every branch must contain a phrase `BootstrapSplash.detectHints` matches
/// ("port … in use"), because that is what turns this English Rust string into
/// the LOCALISED `bootstrap.hint_port` the user actually reads. Pinned by
/// `frontend/src/test/portInUseHint.test.js`.
pub fn port_conflict_message(port: u16, holder: &PortHolder, suffix: &str) -> String {
    let body = match holder {
        PortHolder::OurBackend(version) if version.is_empty() || same_app_version(version) => {
            format!(
                "Port {port} is in use by a Sesly backend from an earlier \
                 session that never shut down. It has no window to quit, so \
                 closing Sesly will not release it. End it from a \
                 terminal:\n\n    {}",
                reclaim_command(port)
            )
        }
        PortHolder::OurBackend(version) => {
            format!(
                "Port {port} is in use by a Sesly backend from version \
                 {version}, left running by an earlier install. This build is \
                 {}, so it cannot use that one. Find and end it from a terminal:\n\n    {}",
                env!("CARGO_PKG_VERSION"),
                reclaim_command(port)
            )
        }
        PortHolder::Foreign | PortHolder::Unknown => format!(
            "Port {port} is already in use by another application, and \
             Sesly could not free it. Quit whatever is using that port \
             and try again."
        ),
    };
    if suffix.is_empty() {
        body
    } else {
        format!("{body}\n\n{suffix}")
    }
}

/// An HTTP response can justify attaching to a healthy same-version backend,
/// but never grants process ownership. Deliberately refuse orphan cleanup:
/// signalling a PID discovered through lsof/netstat has an unavoidable reuse
/// race, and a matching foreign service must never be terminated.
pub fn kill_orphan_on_port(port: u16) {
    if port_in_use(port) {
        log::warn!(
            "Refusing to signal the unowned listener on port {port}; only desktop-contained backends are terminable"
        );
    }
}

// ── Log paths ─────────────────────────────────────────────────────────────

pub fn backend_log_path() -> PathBuf {
    // Support/test override: point logs (and the crash-marker store, which
    // derives from this path) somewhere explicit. The fault-injection
    // harness gives every scenario its own tempdir through this.
    if let Ok(dir) = std::env::var("OMNIVOICE_LOG_DIR") {
        if !dir.trim().is_empty() {
            // Trim here too, not only in the emptiness test above. The Python
            // reader strips this variable before joining (see
            // api/routers/system.py::_backend_redirect_log_candidates), so a
            // padded value had the writer and the reader looking at different
            // directories — the exact divergence #1925 exists to close.
            let log_dir = PathBuf::from(dir.trim());
            let _ = fs::create_dir_all(&log_dir);
            return log_dir.join("backend.log");
        }
    }
    let log_dir = if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        PathBuf::from(home).join("Library/Logs/OmniVoice")
    } else if cfg!(target_os = "windows") {
        let base = std::env::var("LOCALAPPDATA")
            .or_else(|_| std::env::var("USERPROFILE").map(|u| format!("{}\\AppData\\Local", u)))
            .unwrap_or_else(|_| "C:\\Temp".to_string());
        PathBuf::from(base).join("OmniVoice").join("Logs")
    } else {
        let base = std::env::var("XDG_STATE_HOME")
            .or_else(|_| std::env::var("HOME").map(|h| format!("{}/.local/state", h)))
            .unwrap_or_else(|_| "/tmp".to_string());
        PathBuf::from(base).join("OmniVoice")
    };
    let _ = fs::create_dir_all(&log_dir);
    log_dir.join("backend.log")
}

/// Read the last N lines from backend_err.log for diagnostic messages.
///
/// Whole-file view — bootstrap phases (uv sync et al.) that predate any
/// backend run use this. Anything reporting on a specific backend process
/// (crash markers, death diagnostics) must use [`read_error_log_tail_for_run`]
/// instead: the file outlives runs, so an unbounded tail can attribute one
/// run's output to another (#1510).
pub fn read_error_log_tail(max_lines: usize) -> String {
    let err_path = backend_log_path().with_file_name("backend_err.log");
    read_error_log_tail_at(&err_path, 0, max_lines)
}

// ── Per-run crash evidence (#1510) ────────────────────────────────────────
//
// backend_err.log is one file shared by every backend run in an app session,
// and it used to be TRUNCATED on each spawn. Both properties destroyed crash
// evidence: a respawn wiped the dead process's final words, and any tail read
// after the replacement started could attach the new run's healthy startup to
// the old run's crash marker — exactly the undiagnosable report in #1510.
// The file is append-only now, each spawn records where its run begins, and
// death paths read only their own run's slice.

/// Byte offset in backend_err.log where the CURRENT run's output begins.
/// Set by `spawn_backend` before the child starts writing.
static ERR_LOG_RUN_START: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Rotate once the shared file gets this big (append-only would otherwise
/// grow across runs forever). Generous: evidence beats disk here.
const ERR_LOG_ROTATE_BYTES: u64 = 1024 * 1024;

/// Where the current backend run's slice of backend_err.log begins.
pub fn err_log_run_start() -> u64 {
    ERR_LOG_RUN_START.load(std::sync::atomic::Ordering::SeqCst)
}

/// Last N lines of the CURRENT run's slice of backend_err.log.
///
/// This is the reader every death path must use: it cannot see another run's
/// output, so a crash marker carries the dying process's words or nothing.
pub fn read_error_log_tail_for_run(max_lines: usize) -> String {
    read_error_log_tail_range(err_log_run_start(), None, max_lines)
}

/// Last N lines of one run's slice, `[start, end)`.
///
/// A death path pins `start` BEFORE it settles the drainers (#1850, review):
/// settling can take up to two seconds, and a Retry arriving in that window
/// installs a new run and moves `ERR_LOG_RUN_START` past the dying run's
/// output. Reading "the current run" afterwards would hand the dead process's
/// crash marker the REPLACEMENT's healthy startup — the cross-run attribution
/// #1510 exists to prevent, reintroduced through the wait that fixed the tail.
///
/// `end` closes the other side (review). A start offset with an unbounded
/// end still does not identify ONE run: the replacement writes below the dying
/// run's lines, and a tail reads the last N of the file, so the newer run's
/// startup is exactly what a caller would get. `end` is where the next run's
/// slice begins, or `None` when no run started in the meantime.
pub fn read_error_log_tail_range(start: u64, end: Option<u64>, max_lines: usize) -> String {
    let err_path = backend_log_path().with_file_name("backend_err.log");
    read_error_log_slice(&err_path, start, end, max_lines)
}

/// The run that has just died, read as a closed range.
///
/// Call AFTER settling: the end is taken from wherever the current run now
/// begins, which is either still `start` (nothing replaced it) or the
/// replacement's offset (which is exactly where this run's slice ends).
pub fn read_dead_run_tail(start: u64, max_lines: usize) -> String {
    let now = err_log_run_start();
    let end = if now > start { Some(now) } else { None };
    read_error_log_tail_range(start, end, max_lines)
}

/// Tail of `path` starting at byte `start` (whole file when `start` is 0 or
/// no longer valid — an externally replaced/shrunk file must degrade to the
/// old whole-file behaviour, never to a silent empty capture).
fn read_error_log_tail_at(path: &Path, start: u64, max_lines: usize) -> String {
    read_error_log_slice(path, start, None, max_lines)
}

/// `read_error_log_tail_at` with the far end closed too.
fn read_error_log_slice(
    path: &Path,
    start: u64,
    end: Option<u64>,
    max_lines: usize,
) -> String {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    let start = usize::try_from(start).unwrap_or(0);
    let slice = if start > 0 && start <= content.len() && content.is_char_boundary(start) {
        &content[start..]
    } else {
        &content[..]
    };
    // An end that is not a usable boundary degrades to "the rest of the file",
    // matching how an unusable start degrades to the whole file: evidence
    // beats precision, and a silent empty capture is the one outcome that
    // helps nobody.
    let slice = match end.and_then(|e| usize::try_from(e).ok()) {
        Some(e) if e >= start && e <= content.len() && content.is_char_boundary(e) => {
            &content[..e - start]
        }
        _ => slice,
    };
    let lines: Vec<&str> = slice.lines().collect();
    let from = lines.len().saturating_sub(max_lines);
    lines[from..].join("\n")
}

/// Stderr-drainer threads that have not finished writing yet.
///
/// A list, not a slot. Two callers wait on these — a respawn before it records
/// its start offset (#1510) and a crash marker before it captures the tail
/// (#1850) — and either can time out on a wedged drainer (a pipe held open by
/// an orphaned grandchild) while a NEW run installs its own. A single slot
/// loses the timed-out handle at that moment: dropping a JoinHandle detaches
/// the thread, so nothing can ever wait for that run's output again and both
/// guarantees quietly stop holding. Keeping every unfinished handle costs a
/// Vec that is empty in the normal case, since a finished drainer is dropped
/// on the next settle.
static ERR_LOG_DRAINERS: Mutex<Vec<std::thread::JoinHandle<()>>> = Mutex::new(Vec::new());

/// Register a run's stderr drainer so the settles below can wait for it.
fn track_err_drainer(handle: std::thread::JoinHandle<()>) {
    if let Ok(mut guard) = ERR_LOG_DRAINERS.lock() {
        guard.push(handle);
    }
}

/// Serializes a whole settlement. `settle_err_log` takes the handles out of
/// the list and then waits without holding that lock, so two callers could
/// otherwise interleave: the second finds an empty list, concludes there is
/// nothing to wait for, and reads the log while the first is still waiting for
/// exactly the drainer it needs (review). One settlement at a time makes a
/// caller that returns a caller for whom the waiting is genuinely done.
static ERR_LOG_SETTLE_LOCK: Mutex<()> = Mutex::new(());

/// Wait briefly for every outstanding stderr drainer to finish writing.
///
/// Two callers, one guarantee: everything a run wrote is on disk before anyone
/// reads it.
///
/// - Before a respawn takes its start offset, so a dying run's buffered tail
///   cannot be appended past that offset and get attributed to the new run
///   (#1510).
/// - Before a crash marker captures `last_stderr` (#1850). `wait()` returns the
///   moment the child exits, but the drainer is a separate thread reading a
///   pipe: its last lines — the traceback naming the cause — can still be in
///   flight. Reading the file at that instant captures a tail that stops BEFORE
///   the death, which is how a crash report arrives with a log ending a minute
///   early and nothing to diagnose.
///
/// A wedged drainer must not block forever. After the bound we proceed, and
/// every handle still running is kept for the next caller to wait on. For a
/// respawn that degrades to attributing too MUCH to the new run; for a marker,
/// to a short tail. Never to destroyed evidence, and never to a detached
/// thread nobody can wait for again.
pub fn settle_err_log(bound: Duration) {
    let _settling = ERR_LOG_SETTLE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let pending: Vec<_> = match ERR_LOG_DRAINERS.lock() {
        Ok(mut guard) => guard.drain(..).collect(),
        Err(_) => return,
    };
    if pending.is_empty() {
        return;
    }
    let deadline = std::time::Instant::now() + bound;
    while std::time::Instant::now() < deadline && pending.iter().any(|h| !h.is_finished()) {
        std::thread::sleep(Duration::from_millis(20));
    }
    let mut still_running = Vec::new();
    for handle in pending {
        if handle.is_finished() {
            let _ = handle.join();
        } else {
            still_running.push(handle);
        }
    }
    if !still_running.is_empty() {
        if let Ok(mut guard) = ERR_LOG_DRAINERS.lock() {
            // Put them back at the FRONT: they are older than anything a
            // concurrent spawn pushed while this was waiting.
            still_running.append(&mut guard);
            *guard = still_running;
        }
    }
}

/// How long a death path waits for the dying run's final stderr. Bounded so a
/// wedged pipe cannot stall crash recording, generous enough to cover a
/// traceback already sitting in the drainer's buffer.
pub const ERR_LOG_SETTLE: Duration = Duration::from_secs(2);

/// Open backend_err.log for a new run: append-only (a respawn must not
/// destroy the previous run's evidence), rotated when oversized, with the
/// run's start offset returned for `ERR_LOG_RUN_START`.
fn open_err_log_for_run(err_path: &Path) -> (Option<fs::File>, u64) {
    let len = fs::metadata(err_path).map(|m| m.len()).unwrap_or(0);
    if len > ERR_LOG_ROTATE_BYTES {
        let rotated = err_path.with_file_name("backend_err.log.1");
        // Rename preferred (keeps the old evidence in .1); on failure —
        // e.g. the file is still held open on Windows — fall back to
        // truncating, which is exactly the pre-#1510 behaviour.
        if fs::rename(err_path, &rotated).is_err() {
            let file = fs::File::create(err_path).ok();
            return (file, 0);
        }
    }
    let file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(err_path)
        .ok();
    let start = fs::metadata(err_path).map(|m| m.len()).unwrap_or(0);
    (file, start)
}

/// Human-readable diagnostic for a failed `Command::spawn()` of the backend.
///
/// #144 / #127: when the bundled venv Python can't exec (the common Linux/
/// AppImage failure — missing system lib, stale venv, arch mismatch) the
/// process "never started" and we previously surfaced "no error output
/// captured". Writing this to backend_err.log lets read_error_log_tail show the
/// real OS error + an actionable hint instead.
/// Replace the user's home-directory prefix with `~`. This diagnostic is
/// retained in backend_err.log across runs and lands verbatim in bug
/// reports, so the username must not travel with it.
fn redact_home(text: &str) -> String {
    for var in ["HOME", "USERPROFILE"] {
        if let Ok(home) = std::env::var(var) {
            let home = home.trim_end_matches(['/', '\\']);
            if home.len() > 1 && text.starts_with(home) {
                return format!("~{}", &text[home.len()..]);
            }
        }
    }
    text.to_string()
}

fn spawn_failure_diagnostic(python: &Path, err: &std::io::Error) -> String {
    // Platform-specific tail (cfg! resolves to this build's target OS, i.e. the
    // OS it runs on) — don't show AppImage/loader wording to macOS/Windows users.
    let os_hint = if cfg!(target_os = "linux") {
        "On Linux (especially the AppImage) this usually means the bundled venv \
         Python can't execute — a missing system library or a stale/incomplete \
         venv. If it persists, run the app from a terminal to see the \
         dynamic-loader error."
    } else if cfg!(target_os = "macos") {
        "On macOS this usually means the bundled venv Python can't execute (a \
         stale/incomplete venv, or the interpreter got quarantined)."
    } else if cfg!(target_os = "windows") {
        "On Windows this usually means the bundled venv Python is missing or was \
         blocked (antivirus / SmartScreen), or the venv is stale/incomplete."
    } else {
        "This usually means the bundled venv Python can't execute, or the venv is \
         stale/incomplete."
    };
    format!(
        "Failed to launch the backend process.\n\
         Tried to run: {}\n\
         Interpreter present on disk: {}\n\
         OS error: {}\n\n\
         {} Use \"Clean & Retry\" to rebuild the environment.",
        redact_home(&python.display().to_string()),
        python.exists(),
        err,
        os_hint,
    )
}

// ── Spawn the backend via the bootstrapped venv Python ────────────────────

/// Analytics env for the spawned backend: destination override + install channel.
///
/// `core/analytics.py` ships an in-repo publishable default token (#1193), and
/// reads `POSTHOG_PROJECT_TOKEN` from its environment as the OVERRIDE. release.yml
/// passes the `POSTHOG_PROJECT_TOKEN` secret to the tauri-action step as
/// `VITE_POSTHOG_KEY`, and that step compiles this binary as well as the frontend
/// bundle — so `option_env!` bakes it in on the builds that ship it, and we hand
/// it to the child process here so a baked release token wins over the in-repo
/// default.
///
/// Two properties this preserves, both load-bearing:
///   * **Since #1193 there is always a destination**: `core/analytics.py` now
///     carries the in-repo publishable default token, so even when nothing is
///     baked in here (a source-built shell) the backend can run its
///     consent-gated analytics. What this function adds on top is *override*
///     precedence — a baked release token replaces the in-repo default.
///   * **A real process env var wins over both**, so a developer can point a
///     local run at their own PostHog project without recompiling.
///
/// It also stamps `OMNIVOICE_INSTALL_CHANNEL=installer` (#1193): anyone running
/// through this desktop shell is on the "installer" channel — the backend's
/// `install_channel()` reads it (docker is detected via its own marker; bare
/// `uvicorn` runs report "source").
///
/// This only supplies a *destination* and a channel label. Consent is a separate
/// gate the backend checks in prefs (default off) — a token alone never causes a
/// single event.
fn analytics_env(baked_token: Option<&str>, baked_host: Option<&str>) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut pass = |name: &str, baked: Option<&str>| {
        if std::env::var(name).is_ok() {
            return; // caller's environment wins
        }
        if let Some(v) = baked.map(str::trim).filter(|v| !v.is_empty()) {
            out.push((name.to_string(), v.to_string()));
        }
    };
    pass("POSTHOG_PROJECT_TOKEN", baked_token);
    pass("POSTHOG_HOST", baked_host);
    pass("OMNIVOICE_INSTALL_CHANNEL", Some("installer"));
    out
}

/// Parse the `OMNIVOICE_BACKEND_CMD` override: a JSON array (`["prog","a"]`)
/// when it starts with `[` — the form the harness uses, so paths with spaces
/// survive — else whitespace-split. `None` for unset/empty/unparseable.
pub fn parse_backend_cmd_override(raw: &str) -> Option<Vec<String>> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let argv: Vec<String> = if raw.starts_with('[') {
        serde_json::from_str(raw).ok()?
    } else {
        raw.split_whitespace().map(str::to_string).collect()
    };
    if argv.is_empty() || argv[0].trim().is_empty() {
        return None;
    }
    Some(argv)
}

fn backend_cmd_override() -> Option<Vec<String>> {
    parse_backend_cmd_override(&std::env::var("OMNIVOICE_BACKEND_CMD").ok()?)
}

pub(crate) fn spawn_backend<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    progress: Option<&Arc<Mutex<BootstrapStage>>>,
) -> Option<crate::tools::ContainedChild> {
    let log_path = backend_log_path();
    let err_path = log_path.with_file_name("backend_err.log");
    log::info!(
        "Spawning backend — log: {} · err: {}",
        log_path.display(),
        err_path.display(),
    );

    // Fault-injection / QA seam: OMNIVOICE_BACKEND_CMD runs the given argv
    // as "the backend". Venv bootstrap and ffmpeg resolution are skipped
    // (they can install toolchains or touch the network); everything else —
    // the err-log run offset, the drainer threads, env pinning, real OS
    // pipes, the spawn-failure diagnostic — stays exactly real, which is
    // the point: the lifecycle harness exercises genuine process deaths.
    let cmd_override = backend_cmd_override();
    let (python, backend_dir) = match cmd_override {
        Some(ref argv) => (PathBuf::from(&argv[0]), PathBuf::new()),
        None => match ensure_venv_ready(app, progress) {
            Some(x) => x,
            None => {
                log::error!("Venv bootstrap failed — backend not started");
                return None;
            }
        },
    };

    if let Some(p) = progress {
        set_stage(p, BootstrapStage::StartingBackend);
    }

    let stdout_file = fs::File::create(&log_path).ok();
    // Append + per-run offset, never truncate: the previous run's stderr is
    // crash evidence until someone reads it (#1510). Flush the previous
    // drainer first so old buffered lines land BEFORE this run's offset.
    settle_err_log(Duration::from_secs(2));
    let (err_log_file, err_log_start) = open_err_log_for_run(&err_path);
    ERR_LOG_RUN_START.store(err_log_start, std::sync::atomic::Ordering::SeqCst);
    if let Some(ref f) = err_log_file {
        use std::io::Write;
        let mut f = f;
        let _ = writeln!(
            f,
            "──── backend run starting (unix {}s) ────",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        );
    }

    let mut env: Vec<(String, String)> = vec![
        ("PYTHONUNBUFFERED".into(), "1".into()),
        // Backend-managed engines/installers must inherit the desktop-owned
        // process group/Job rather than escaping into a new session.
        ("OMNIVOICE_DESKTOP_CONTAINED".into(), "1".into()),
    ];
    // Pin the child's OMNIVOICE_PORT to the value Rust resolved so Python's
    // network_share.backend_port() always agrees with the uvicorn --port we
    // pass below — otherwise a user-set OMNIVOICE_PORT would change the
    // LAN-share/Tailscale target while the listener stayed on the Rust port.
    env.push(("OMNIVOICE_PORT".into(), backend_port().to_string()));
    if cfg!(target_os = "windows") {
        env.push(("TORCHDYNAMO_DISABLE".into(), "1".into()));
        env.push(("HF_HUB_DISABLE_SYMLINKS_WARNING".into(), "1".into()));
        env.push(("HF_HUB_DISABLE_SYMLINKS".into(), "1".into()));
        // #1153 class: the Intel Fortran runtime in MKL (numpy/scipy) aborts
        // the whole backend with `forrtl: error (200)` when a console
        // CLOSE/LOGOFF event reaches the child. Belt (this env var disables
        // that handler) and suspenders (CREATE_NO_WINDOW below means no
        // console gets the event at all). Process env wins for power users.
        if std::env::var("FOR_DISABLE_CONSOLE_CTRL_HANDLER").is_err() {
            env.push(("FOR_DISABLE_CONSOLE_CTRL_HANDLER".into(), "1".into()));
        }
        // #1155: without UTF-8 mode the child's stdio + default file
        // encoding is cp1252, and a library print of Vietnamese/CJK user
        // text raised UnicodeEncodeError mid-synthesis. macOS/Linux are
        // UTF-8 already — this brings Windows to parity.
        if std::env::var("PYTHONUTF8").is_err() {
            env.push(("PYTHONUTF8".into(), "1".into()));
        }
    }
    // HF endpoint precedence: process env (power user) > setup-screen custom
    // mirror > region preset.
    let cfg = load_config(app);
    if let Ok(hf_ep) = std::env::var("HF_ENDPOINT") {
        env.push(("HF_ENDPOINT".into(), hf_ep));
    } else if let Some(hf_mirror) = cfg.mirrors.hf_endpoint.as_deref() {
        env.push(("HF_ENDPOINT".into(), hf_mirror.into()));
    } else if cfg.region == "china" {
        env.push(("HF_ENDPOINT".into(), "https://hf-mirror.com".into()));
    }
    // Storage layout chosen on the setup screen. Unset (None) means platform
    // default — we deliberately don't set the env vars then, so legacy
    // installs keep byte-identical behavior. Process env still wins so a
    // power user can relocate per-launch.
    if std::env::var("OMNIVOICE_DATA_DIR").is_err() {
        if let Some(data_dir) = crate::setup::resolved_data_dir(app) {
            env.push(("OMNIVOICE_DATA_DIR".into(), data_dir.to_string_lossy().into()));
        }
    }
    if std::env::var("OMNIVOICE_CACHE_DIR").is_err() {
        if let Some(models_dir) = crate::setup::resolved_models_dir(app) {
            env.push(("OMNIVOICE_CACHE_DIR".into(), models_dir.to_string_lossy().into()));
        }
    }
    // Analytics destination (#1123) — see analytics_env() below for why.
    env.extend(analytics_env(option_env!("VITE_POSTHOG_KEY"), option_env!("VITE_POSTHOG_HOST")));
    if cmd_override.is_none() {
        // #1770: lets the attach handshake tell "this build's code" apart
        // from "a same-version backend running older code" — see
        // `bootstrap::own_backend_code_fingerprint` / `code_fingerprint_is_current`.
        if let Some(fingerprint) = crate::bootstrap::own_backend_code_fingerprint(app) {
            env.push(("OMNIVOICE_BUILD_FINGERPRINT".into(), fingerprint));
        }
        let app_data = app.path().app_local_data_dir().unwrap_or_default();
        if let Some(ffmpeg_path) = resolve_ffmpeg(app, &app_data) {
            env.push(("FFMPEG_PATH".into(), ffmpeg_path.to_string_lossy().into()));
        }
        if let Some(ffprobe_path) = resolve_ffprobe(app, &app_data) {
            let ffprobe_str: String = ffprobe_path.to_string_lossy().into();
            env.push(("FFPROBE_PATH".into(), ffprobe_str.clone()));
            // Issue #76: OMNIVOICE_FFPROBE_PATH is the canonical name going
            // forward — explicit, namespaced, and unambiguously the path of a
            // file (not a PATH-style command name). FFPROBE_PATH stays for
            // backward compat with prior backend releases.
            env.push(("OMNIVOICE_FFPROBE_PATH".into(), ffprobe_str));
        }
    }
    let mut cmd = Command::new(&python);
    cmd.env_remove("PYTHONHOME").env_remove("PYTHONPATH").env_remove("LD_LIBRARY_PATH");
    for (k, v) in &env {
        cmd.env(k, v);
    }
    match cmd_override {
        Some(ref argv) => {
            cmd.args(&argv[1..]);
        }
        None => {
            cmd.args([
                "-m",
                "uvicorn",
                "main:app",
                "--app-dir",
                backend_dir.to_string_lossy().as_ref(),
                "--host",
                "127.0.0.1",
                "--port",
                &backend_port().to_string(),
            ]);
        }
    }
    // Keep stdin piped but unwritten. The backend's parent-liveness watchdog
    // blocks on it; desktop exit closes the handle and the child terminates,
    // including on macOS where parent death alone does not reap descendants.
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut contained = match crate::tools::spawn_process_tree(&mut cmd) {
        Ok(c) => {
            log::info!(
                "Backend started via venv python {} (pid {})",
                python.display(),
                c.child.id()
            );
            c
        }
        Err(e) => {
            // #144/#127: surface WHY it never started. Write the diagnostic to
            // backend_err.log so the bootstrap's read_error_log_tail shows the
            // real exec error instead of "no error output captured".
            let diag = spawn_failure_diagnostic(&python, &e);
            log::error!("{}", diag);
            // Append (not overwrite): the run header above already marks this
            // run's slice, and earlier runs' evidence stays intact.
            if let Ok(mut f) = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&err_path)
            {
                use std::io::Write;
                let _ = writeln!(f, "{}", diag);
            }
            return None;
        }
    };

    // The attempt these pumps drain, captured up front: the threads outlive
    // the run, and a restart must not relabel its trailing output as the new
    // attempt's evidence (#1900).
    let pump_attempt = current_attempt();

    if let Some(stdout_pipe) = contained.child.stdout.take() {
        let app_clone = app.clone();
        let mut out_file = stdout_file;
        std::thread::spawn(move || {
            use std::io::Write;
            let reader = BufReader::new(stdout_pipe);
            for line in reader.lines().flatten() {
                log::info!("[backend_stdout] {}", line);
                emit_log_for_attempt(&app_clone, pump_attempt, "starting_backend", &line);
                if let Some(ref mut f) = out_file {
                    let _ = writeln!(f, "{}", line);
                }
            }
        });
    }

    if let Some(stderr_pipe) = contained.child.stderr.take() {
        let app_clone = app.clone();
        // Tracked (not detached): the next spawn joins this handle so this
        // run's buffered tail flushes before the next run's offset is taken.
        let drainer = std::thread::spawn(move || {
            use std::io::Write;
            let reader = BufReader::new(stderr_pipe);
            let mut log_file = err_log_file;
            for line in reader.lines().flatten() {
                log::info!("[backend_stderr] {}", line);
                emit_log_for_attempt(&app_clone, pump_attempt, "starting_backend", &line);
                if let Some(ref mut f) = log_file {
                    let _ = writeln!(f, "{}", line);
                }
            }
        });
        track_err_drainer(drainer);
    }

    Some(contained)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;

    // #1123 shipped backend analytics that could never run: core/analytics.py reads
    // POSTHOG_PROJECT_TOKEN from the runtime environment, and nothing on the user's
    // machine ever set it. These pin the wiring that fixes it. Since #1193 the
    // backend also carries an in-repo default token, so what's pinned here is the
    // OVERRIDE precedence (baked > in-repo default, process env > baked) plus the
    // "installer" channel marker this shell stamps on the child.

    /// The env-var tests below mutate process-global state; keep them off each
    /// other's toes (cargo runs tests in threads by default).
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// `ERR_LOG_DRAINERS` is one process-global list, and several tests push
    /// a handle onto it. Without this they race: one test's settle drains and
    /// joins another's thread, and both assert on state they no longer own.
    static DRAINER_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn a_baked_token_reaches_the_spawned_backend() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("POSTHOG_PROJECT_TOKEN");
        std::env::remove_var("POSTHOG_HOST");
        std::env::remove_var("OMNIVOICE_INSTALL_CHANNEL");

        let env = analytics_env(Some("phc_baked"), Some("https://eu.i.posthog.com"));

        // The baked release token must reach the child, where it overrides the
        // backend's in-repo default destination (#1193).
        assert!(env.contains(&("POSTHOG_PROJECT_TOKEN".into(), "phc_baked".into())));
        assert!(env
            .contains(&("POSTHOG_HOST".into(), "https://eu.i.posthog.com".into())));
    }

    #[test]
    fn a_source_build_passes_no_destination_but_still_marks_the_channel() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("POSTHOG_PROJECT_TOKEN");
        std::env::remove_var("POSTHOG_HOST");
        std::env::remove_var("OMNIVOICE_INSTALL_CHANNEL");

        // No secret at compile time (anyone building the shell from source), and
        // the empty string CI hands over when the secret is simply absent: no
        // POSTHOG_* is passed (the backend falls back to its in-repo default,
        // #1193) — but running under this shell is still the "installer" channel.
        for env in [analytics_env(None, None), analytics_env(Some(""), Some("   "))] {
            assert_eq!(
                env,
                vec![("OMNIVOICE_INSTALL_CHANNEL".to_string(), "installer".to_string())]
            );
        }
    }

    #[test]
    fn the_process_environment_beats_the_baked_token() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::set_var("POSTHOG_PROJECT_TOKEN", "phc_developers_own_project");
        std::env::set_var("OMNIVOICE_INSTALL_CHANNEL", "source");
        let env = analytics_env(Some("phc_baked"), None);
        // Don't override what the caller deliberately set — the child inherits it.
        assert!(env.iter().all(|(k, _)| k != "POSTHOG_PROJECT_TOKEN"));
        assert!(env.iter().all(|(k, _)| k != "OMNIVOICE_INSTALL_CHANNEL"));
        std::env::remove_var("POSTHOG_PROJECT_TOKEN");
        std::env::remove_var("OMNIVOICE_INSTALL_CHANNEL");
    }

    /// Loopback responder for the /startup/progress probe tests.
    fn spawn_progress_stub(with_marker: bool, body: &'static str) -> u16 {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut buf = [0u8; 512];
                let _ = stream.read(&mut buf);
                let marker = if with_marker {
                    "x-omnivoice-backend: 0.0.0\r\n"
                } else {
                    ""
                };
                let resp = format!(
                    "HTTP/1.1 200 OK\r\n{marker}Content-Length: {}\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(resp.as_bytes());
            }
        });
        port
    }

    /// Loopback HTTP responder for the probe tests: answers `/system/info`
    /// with a genuine-looking backend body and `/profiles` with the given
    /// status — the exact shape of a zombie whose install/DB broke while
    /// `/system/info` kept answering from memory.
    fn spawn_probe_stub(profiles_status: u16) -> u16 {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut buf = [0u8; 512];
                let n = stream.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let resp = if req.starts_with("GET /system/info") {
                    "HTTP/1.1 200 OK\r\nContent-Length: 19\r\n\r\n{\"data_dir\": \"/x\"}\n".to_string()
                } else {
                    format!("HTTP/1.1 {profiles_status} X\r\nContent-Length: 2\r\n\r\n[]")
                };
                let _ = stream.write_all(resp.as_bytes());
            }
        });
        port
    }

    /// Loopback responder that answers `/system/info` with an arbitrary
    /// body, for `backend_data_dir` tests.
    fn spawn_system_info_stub(body: &'static str) -> u16 {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut buf = [0u8; 512];
                let _ = stream.read(&mut buf);
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(resp.as_bytes());
            }
        });
        port
    }

    #[test]
    fn backend_data_dir_reads_system_info_and_degrades_safely() {
        // Reachable backend advertising data_dir → Some(path). This is what
        // lets Tauri and the backend agree on where one-shot capability
        // files live (#1781) even when they'd otherwise resolve different
        // platform defaults (e.g. a dev backend spawned without
        // OMNIVOICE_DATA_DIR).
        //
        // The fixture must be a platform-appropriate ABSOLUTE path:
        // `Path::new("/custom/data").is_absolute()` is FALSE on Windows
        // (Windows requires a drive prefix like `C:` *and* a root — a
        // rooted-but-driveless path is drive-relative and genuinely
        // ambiguous), so a Unix-style fixture would spuriously fail the
        // `is_absolute()` filter in `backend_data_dir` on that platform.
        // The wire body doubles each backslash (JSON escaping); the new
        // `decode_json_string` decodes that back to a single backslash, so
        // the assertion checks the DECODED form, not the wire form.
        #[cfg(windows)]
        let (body, expected) = (
            r#"{"data_dir": "C:\\custom\\data"}"#,
            r"C:\custom\data",
        );
        #[cfg(not(windows))]
        let (body, expected) = (r#"{"data_dir": "/custom/data"}"#, "/custom/data");
        let port = spawn_system_info_stub(body);
        assert_eq!(backend_data_dir(port), Some(expected.to_string()));

        // A rooted-but-driveless path is drive-relative on Windows (which
        // drive is "the" drive is ambiguous) and must be REJECTED there —
        // `is_absolute()` correctly returns false for it, and the fixture
        // fixed above must not silently paper over that. `/custom/data` and
        // `\data` are exactly the un-prefixed forms a misbehaving responder
        // (or a backend running under an unexpected shell) could send.
        #[cfg(windows)]
        {
            assert_eq!(
                backend_data_dir(spawn_system_info_stub(r#"{"data_dir": "/custom/data"}"#)),
                None
            );
            assert_eq!(
                backend_data_dir(spawn_system_info_stub(r#"{"data_dir": "\\data"}"#)),
                None
            );
        }

        // Old backend body (identifies via model_checkpoint) predating the
        // data_dir field → None, so callers fall back to Tauri's own
        // resolution instead of trusting a missing field.
        let old = spawn_system_info_stub(r#"{"model_checkpoint": "x"}"#);
        assert_eq!(backend_data_dir(old), None);

        // Explicit empty data_dir must not resolve to a bare/relative root —
        // treated the same as absent.
        let empty = spawn_system_info_stub(r#"{"data_dir": ""}"#);
        assert_eq!(backend_data_dir(empty), None);

        // A foreign (non-Sesly) responder must not be trusted either.
        let foreign = spawn_system_info_stub(r#"{"hello": "world"}"#);
        assert_eq!(backend_data_dir(foreign), None);

        // A RELATIVE data_dir is unusable and must not be adopted: the
        // backend resolves it against its own working directory, so joining
        // the same string onto Tauri's cwd would recreate exactly the split
        // #1781 is about. `get_app_data_dir()` hands back
        // OMNIVOICE_DATA_DIR verbatim, so this is reachable without any
        // malice — a source or Docker setup using a relative override.
        let relative = spawn_system_info_stub(r#"{"data_dir": "omnivoice_data"}"#);
        assert_eq!(backend_data_dir(relative), None);
        let dotted = spawn_system_info_stub(r#"{"data_dir": "./data"}"#);
        assert_eq!(backend_data_dir(dotted), None);

        // Nothing listening → None, same fallback path.
        assert_eq!(backend_data_dir(1), None); // port 1 — never bindable by us
    }

    #[test]
    fn parse_json_string_field_decodes_escape_sequences() {
        // Windows data dirs are full of backslashes: the backend serializes
        // `C:\Users\x\AppData\Roaming\OmniVoice` as
        // `"C:\\Users\\x\\AppData\\Roaming\\OmniVoice"` on the wire. A naive
        // substring extract to the first raw `"` would hand back the
        // doubled-backslash literal instead of the real path.
        assert_eq!(
            parse_json_string_field(
                r#"{"data_dir": "C:\\Users\\x\\AppData\\Roaming\\OmniVoice"}"#,
                "data_dir"
            ),
            Some(r"C:\Users\x\AppData\Roaming\OmniVoice".to_string())
        );

        // A path containing an escaped quote must not truncate the value at
        // that quote — only an UNESCAPED quote terminates the string.
        assert_eq!(
            parse_json_string_field(r#"{"data_dir": "C:\\a \"weird\" dir"}"#, "data_dir"),
            Some("C:\\a \"weird\" dir".to_string())
        );

        // \uXXXX escapes, including a surrogate pair for a codepoint outside
        // the BMP (backend labels are ensure_ascii-encoded JSON, so any
        // non-ASCII text — e.g. an ellipsis "…" or an emoji — arrives this
        // way, not as raw UTF-8 bytes).
        assert_eq!(
            parse_json_string_field(r#"{"label": "Loading\u2026"}"#, "label"),
            Some("Loading\u{2026}".to_string())
        );
        assert_eq!(
            parse_json_string_field(r#"{"label": "\ud83d\ude00"}"#, "label"),
            Some("\u{1F600}".to_string())
        );

        // The other basic escapes.
        assert_eq!(
            parse_json_string_field(r#"{"x": "a\nb\tc\rd\/e"}"#, "x"),
            Some("a\nb\tc\rd/e".to_string())
        );

        // Malformed/unterminated input still degrades to None.
        assert_eq!(parse_json_string_field(r#"{"x": "unterminated"#, "x"), None);
        assert_eq!(parse_json_string_field(r#"{"x": "bad \q escape"}"#, "x"), None);
    }

    #[test]
    fn backend_cmd_override_parses_json_and_whitespace_forms() {
        // JSON form (the harness's): paths with spaces survive.
        assert_eq!(
            parse_backend_cmd_override(r#"["/tmp/my dir/prog", "arg1"]"#),
            Some(vec!["/tmp/my dir/prog".into(), "arg1".into()])
        );
        // Whitespace form (manual QA): OMNIVOICE_BACKEND_CMD="/bin/false x".
        assert_eq!(
            parse_backend_cmd_override("/bin/false x"),
            Some(vec!["/bin/false".into(), "x".into()])
        );
        // Unset/empty/garbage never activates the seam — production behavior
        // is byte-identical without the env var.
        assert_eq!(parse_backend_cmd_override(""), None);
        assert_eq!(parse_backend_cmd_override("   "), None);
        assert_eq!(parse_backend_cmd_override("[not json"), None);
        assert_eq!(parse_backend_cmd_override("[]"), None);
        assert_eq!(parse_backend_cmd_override(r#"[""]"#), None);
    }

    #[test]
    fn startup_progress_parses_fields_and_requires_the_marker() {
        const BODY: &str =
            r#"{"status": "starting", "step": "ml_imports", "label": "Loading ML runtime (PyTorch)…", "error": null}"#;
        // Marker present → the tuple the poll loops narrate from.
        let port = spawn_progress_stub(true, BODY);
        assert_eq!(
            startup_progress(port),
            Some((
                "starting".into(),
                "ml_imports".into(),
                "Loading ML runtime (PyTorch)…".into()
            ))
        );
        // No marker header → a foreign responder must not narrate our splash.
        let foreign = spawn_progress_stub(false, BODY);
        assert_eq!(startup_progress(foreign), None);
        // Ready body with null step/label → status still parses, step empty.
        let ready = spawn_progress_stub(true, r#"{"status": "ready", "step": null, "label": null}"#);
        assert_eq!(startup_progress(ready), Some(("ready".into(), String::new(), String::new())));
        // Nothing listening → None (old backend / dead port fall back).
        assert_eq!(startup_progress(1), None);
    }

    #[test]
    fn ready_requires_the_deep_probe_not_just_identity() {
        // Regression for the shallow-Ready class: a backend that identifies
        // itself on /system/info but 500s a DB-backed route must NOT be
        // announced Ready — that zombie looked alive while every real
        // request dead-ended on "can't reach the backend".
        let broken = spawn_probe_stub(500);
        assert!(backend_healthy(broken), "identity probe should pass");
        assert!(!backend_deep_healthy(broken), "deep probe must fail on 500");
        assert!(!backend_ready(broken), "Ready must gate on the deep probe");

        let ok = spawn_probe_stub(200);
        assert!(backend_ready(ok), "identity + working DB route is Ready");

        // Nothing listening at all: no probe passes.
        assert!(!backend_ready(1)); // port 1 — never bindable by us
    }

    #[test]
    fn spawn_failure_diagnostic_surfaces_path_error_and_hint() {
        let err = io::Error::new(io::ErrorKind::NotFound, "No such file or directory");
        let diag = spawn_failure_diagnostic(Path::new("/no/such/python"), &err);
        assert!(diag.contains("/no/such/python"), "must name the interpreter path");
        assert!(diag.contains("No such file or directory"), "must include the OS error");
        assert!(diag.contains("Interpreter present on disk: false"));
        assert!(diag.contains("Clean & Retry"), "must give an actionable hint");
    }

    // ── stale-backend detection (the "bound port blocked the newer version"
    //    report: a healthy orphan from a previous version must NOT be
    //    attached to) ─────────────────────────────────────────────────────

    #[test]
    fn parse_app_version_reads_system_info_shape() {
        let body = r#"{"app_version":"0.3.9","data_dir":"/x","model_checkpoint":"k2"}"#;
        assert_eq!(parse_app_version(body).as_deref(), Some("0.3.9"));
        // whitespace after the colon is fine
        assert_eq!(
            parse_app_version(r#"{ "app_version" :  "1.2.3" }"#).as_deref(),
            Some("1.2.3")
        );
        // pre-app_version backends and foreign bodies yield None
        assert_eq!(parse_app_version(r#"{"data_dir":"/x"}"#), None);
        assert_eq!(parse_app_version("<html>not json</html>"), None);
    }

    #[test]
    fn parse_http_status_reads_the_status_line_only() {
        assert_eq!(super::parse_http_status("HTTP/1.1 200 OK\r\nX: 500\r\n\r\nbody"), Some(200));
        assert_eq!(
            super::parse_http_status("HTTP/1.1 500 Internal Server Error\r\n\r\nInternal Server Error"),
            Some(500)
        );
        assert_eq!(super::parse_http_status("garbage"), None);
        assert_eq!(super::parse_http_status(""), None);
    }

    #[test]
    fn same_app_version_matches_current_build_and_rejects_stale() {
        let ours = env!("CARGO_PKG_VERSION");
        assert!(same_app_version(ours), "own version must attach");
        // preview stamp of the same base still attaches
        assert!(same_app_version(&format!("{}-7", ours)));
        // a different (older) release is stale
        assert!(!same_app_version("0.0.1"));
        // unversioned (pre-app_version backend) is stale by definition
        assert!(!same_app_version(""));
    }

    // ── #1770: code fingerprint decision (pure — no AppHandle, per the
    //    Windows tauri::test::mock_builder abort that broke a PR earlier
    //    today) ────────────────────────────────────────────────────────────

    #[test]
    fn code_fingerprint_absent_is_stale() {
        // No `code_fingerprint` key at all in /system/info -> the backend's
        // code predates the fingerprinting mechanism outright, regardless of
        // whether we could compute our own. This is the #1770 bug case: a
        // same-version backend running weeks-old code must NOT be adopted.
        assert!(!code_fingerprint_is_current(None, Some("abc123")));
        assert!(!code_fingerprint_is_current(None, None));
    }

    #[test]
    fn code_fingerprint_present_but_blank_degrades_to_accept() {
        // Present-but-blank means current schema, no env var at spawn time
        // (dev mode's dev-backend.mjs strips OMNIVOICE_*; a manually started
        // uvicorn never sets it) — don't hard-fail every dev/manual-start
        // session over an unverifiable-but-plausibly-current backend.
        assert!(code_fingerprint_is_current(Some(""), Some("abc123")));
        assert!(code_fingerprint_is_current(Some(""), None));
    }

    #[test]
    fn code_fingerprint_matches_and_mismatches() {
        // Tracked re-supervision / preview-build reattach: same resource
        // dir hashed twice by the same build -> identical value -> accept.
        assert!(code_fingerprint_is_current(Some("abc123"), Some("abc123")));
        // Different code within the same version string -> stale, replace it.
        assert!(!code_fingerprint_is_current(Some("abc123"), Some("def456")));
    }

    #[test]
    fn code_fingerprint_our_side_unknown_degrades_to_accept() {
        // We failed to compute our own fingerprint (unreadable resource dir
        // / dev root) — can't enforce a check we can't compute either side
        // of, so don't block a legitimate attach on our own tooling failure.
        assert!(code_fingerprint_is_current(Some("abc123"), None));
    }

    #[test]
    fn parse_backend_identity_distinguishes_absent_from_blank_from_known() {
        // Old backend: /system/info has no code_fingerprint key at all.
        let old = parse_backend_identity(r#"{"app_version":"0.5.2","data_dir": "/x"}"#).unwrap();
        assert_eq!(old.version, "0.5.2");
        assert_eq!(old.code_fingerprint, None);

        // Current schema, no env var set at spawn time.
        let blank = parse_backend_identity(
            r#"{"app_version":"0.5.2","data_dir": "/x", "code_fingerprint": ""}"#,
        )
        .unwrap();
        assert_eq!(blank.code_fingerprint, Some(String::new()));

        // Current schema, fingerprint present.
        let known = parse_backend_identity(
            r#"{"app_version":"0.5.2","data_dir": "/x", "code_fingerprint": "abc123"}"#,
        )
        .unwrap();
        assert_eq!(known.code_fingerprint, Some("abc123".to_string()));

        // Not our backend at all (no data_dir/model_checkpoint marker) — the
        // whole identity is unknown, not just the fingerprint.
        assert!(parse_backend_identity(r#"{"code_fingerprint": "abc123"}"#).is_none());
    }

    #[test]
    fn running_backend_identity_reads_both_fields_from_one_fetch() {
        let stub = spawn_system_info_stub(
            r#"{"app_version":"0.5.2","data_dir": "/x", "code_fingerprint": "abc123"}"#,
        );
        let identity = running_backend_identity(stub).unwrap();
        assert_eq!(identity.version, "0.5.2");
        assert_eq!(identity.code_fingerprint, Some("abc123".to_string()));
    }

    #[test]
    fn running_backend_identity_transport_failure_is_not_conflated_with_absent_field() {
        // The P1 finding on #1796: when version and
        // fingerprint came from two independent /system/info fetches, a
        // transport hiccup on the SECOND one (nothing listening, timeout,
        // connection reset) returned `None` from
        // `running_backend_code_fingerprint` alone — wire-identical to "the
        // body parsed fine but the key was genuinely absent", which
        // `code_fingerprint_is_current` treats as stale. That could kill and
        // respawn a perfectly healthy, externally-owned backend on a single
        // flaky probe.
        //
        // With one fetch, a transport failure can no longer reach that
        // branch at all: `running_backend_identity` returns a flat `None`,
        // which `prepare_backend_launch`'s `None => {}` arm treats as
        // "nothing answered" — a wholly different code path from "answered,
        // but predates the fingerprint field" (`Some(identity)` with
        // `code_fingerprint: None`). Assert that boundary directly: nothing
        // is listening on this port, so the fetch itself fails, and the
        // result must be the "nothing answered" `None` — never a `Some`
        // that a caller could misread as an absent-field verdict.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().unwrap().port();
        drop(listener); // frees the port; nothing is listening on it now
        assert_eq!(running_backend_identity(port), None);
    }

    // ── Per-run crash evidence (#1510) ───────────────────────────────────
    // The reported failure shape: a crash marker whose stderr tail was the
    // REPLACEMENT process's healthy startup, because the shared err log was
    // truncated on respawn and read unbounded afterwards.

    #[test]
    fn a_respawn_preserves_the_previous_runs_evidence() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backend_err.log");

        let (file, start) = open_err_log_for_run(&path);
        assert_eq!(start, 0);
        writeln!(file.unwrap(), "run1: fatal abort, last words").unwrap();

        // Respawn: pre-#1510 this truncated the file (File::create), turning
        // the dead run's final output into nothing.
        let (file2, start2) = open_err_log_for_run(&path);
        let content = fs::read_to_string(&path).unwrap();
        assert!(
            content.contains("run1: fatal abort"),
            "respawn destroyed the previous run's evidence: {content:?}"
        );
        assert_eq!(
            start2 as usize,
            content.len(),
            "run2 must begin at the old EOF"
        );
        drop(file2);
    }

    #[test]
    fn a_run_bounded_tail_cannot_show_another_runs_output() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backend_err.log");

        let (file, _) = open_err_log_for_run(&path);
        writeln!(file.unwrap(), "run1: Traceback — the actual crash").unwrap();
        let (file2, start2) = open_err_log_for_run(&path);
        writeln!(file2.unwrap(), "run2: OmniVoice model loaded successfully.").unwrap();

        // The dead run's slice: only its own words.
        let run1 = read_error_log_tail_at(&path, 0, 10);
        assert!(run1.contains("the actual crash"));
        // The replacement's slice: its startup, and NEVER run1's crash —
        // and, symmetrically, a marker bounded to run1's slice could never
        // have contained run2's healthy startup (the #1510 report).
        let run2 = read_error_log_tail_at(&path, start2, 10);
        assert!(run2.contains("model loaded successfully"));
        assert!(
            !run2.contains("the actual crash"),
            "run-bounded tail leaked another run's output: {run2:?}"
        );
    }

    #[test]
    fn an_invalid_offset_degrades_to_the_whole_file_not_to_silence() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backend_err.log");
        fs::write(&path, "only line\n").unwrap();
        // Offset beyond EOF (file replaced/shrunk externally): evidence
        // beats precision — degrade to the whole file, never to "".
        assert_eq!(read_error_log_tail_at(&path, 10_000, 10), "only line");
    }

    #[test]
    fn a_dying_runs_buffered_stderr_flushes_before_the_next_offset() {
        let _g = DRAINER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backend_err.log");
        fs::write(&path, "run1: early line\n").unwrap();

        // A drainer still flushing the dead run's buffered tail…
        let p = path.clone();
        let late = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(120));
            let mut f = fs::OpenOptions::new().append(true).open(&p).unwrap();
            writeln!(f, "run1: buffered last words").unwrap();
        });
        track_err_drainer(late);

        // …must land BEFORE the next run records where its output begins.
        settle_err_log(Duration::from_secs(2));
        let (_file, start) = open_err_log_for_run(&path);
        let run2 = read_error_log_tail_at(&path, start, 10);
        assert!(
            !run2.contains("buffered last words"),
            "old run's buffered stderr was attributed to the new run: {run2:?}"
        );
        assert!(fs::read_to_string(&path)
            .unwrap()
            .contains("buffered last words"));
    }

    #[test]
    fn the_spawn_diagnostic_never_carries_the_users_home_path() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let saved = std::env::var("HOME").ok();
        std::env::set_var("HOME", "/home/realname");
        let diag = spawn_failure_diagnostic(
            Path::new("/home/realname/.local/share/app/venv/bin/python"),
            &io::Error::new(io::ErrorKind::NotFound, "nope"),
        );
        match saved {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }
        assert!(!diag.contains("/home/realname"), "home path leaked: {diag}");
        assert!(diag.contains("~/.local/share/app/venv/bin/python"));
    }

    #[test]
    fn an_oversized_log_rotates_instead_of_growing_forever() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backend_err.log");
        fs::write(&path, "x".repeat((ERR_LOG_ROTATE_BYTES + 1) as usize)).unwrap();

        let (_file, start) = open_err_log_for_run(&path);
        assert_eq!(start, 0, "a rotated log starts the new run at offset 0");
        let rotated = path.with_file_name("backend_err.log.1");
        assert!(
            rotated.exists(),
            "old evidence must survive rotation in the sibling file"
        );
    }


    // ── #1933: name who actually holds the port ───────────────────────────

    #[test]
    fn our_own_orphan_is_not_reported_as_another_application() {
        // The report that opened #1933: the holder was the user's own backend
        // from an earlier run, and the message told them to quit "another
        // application" — then a copy of Sesly with no window. Nothing in
        // it would have worked.
        let msg = port_conflict_message(
            3900,
            &PortHolder::OurBackend(env!("CARGO_PKG_VERSION").to_string()),
            "",
        );

        assert!(msg.contains("Sesly backend from an earlier session"), "{msg}");
        assert!(!msg.contains("another application"), "{msg}");
        // And a way out, not just a diagnosis.
        assert!(msg.contains("terminal"), "{msg}");
    }

    #[test]
    fn a_backend_from_another_version_is_named() {
        let msg = port_conflict_message(3900, &PortHolder::OurBackend("0.1.0".into()), "");

        assert!(msg.contains("0.1.0"), "the stale version is what identifies it: {msg}");
        assert!(msg.contains(env!("CARGO_PKG_VERSION")), "{msg}");
    }

    #[test]
    fn an_unidentified_listener_keeps_the_conservative_wording() {
        // Never tell a user to go kill a process that may not be theirs.
        for holder in [PortHolder::Foreign, PortHolder::Unknown] {
            let msg = port_conflict_message(3900, &holder, "");
            assert!(msg.contains("another application"), "{msg}");
            assert!(!msg.contains("lsof"), "{msg}");
            assert!(!msg.contains("Get-NetTCPConnection"), "{msg}");
            assert!(!msg.contains("kill"), "{msg}");
        }
    }

    /// A one-shot loopback responder: serves `response` verbatim to the first
    /// connection, then stops. Enough to answer one `/system/info` probe.
    fn serve_once(response: String) -> u16 {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(2) {
                let Ok(mut stream) = stream else { continue };
                let mut scratch = [0u8; 1024];
                let _ = stream.read(&mut scratch);
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });
        port
    }

    #[test]
    fn a_body_that_merely_looks_like_ours_is_not_treated_as_ours() {
        // review: running_backend_version accepts a body containing
        // "model_checkpoint" or "data_dir" — a substring sniff. Fine for
        // deciding whether to ATTACH; not fine here, where the answer ends in
        // a message naming a process for the user to kill. Anything can serve
        // that body. Only our backend stamps x-omnivoice-backend.
        let body = r#"{"model_checkpoint": "x", "data_dir": "/tmp", "app_version": "9.9.9"}"#;
        let port = serve_once(format!(
            "HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: {}

{body}",
            body.len()
        ));

        assert_eq!(
            port_holder(port),
            PortHolder::Foreign,
            "an unmarked responder must never be named as our backend"
        );
        let msg = port_conflict_message(port, &port_holder(port), "");
        assert!(!msg.contains("lsof"), "{msg}");
        assert!(!msg.contains("Get-NetTCPConnection"), "{msg}");
    }

    #[test]
    fn the_marker_header_is_what_identifies_our_backend() {
        let body = r#"{"model_checkpoint": "x", "data_dir": "/tmp", "app_version": "9.9.9"}"#;
        let port = serve_once(format!(
            "HTTP/1.1 200 OK
x-omnivoice-backend: 9.9.9
Content-Length: {}

{body}",
            body.len()
        ));

        assert_eq!(port_holder(port), PortHolder::OurBackend("9.9.9".into()));
    }

    #[test]
    fn the_reclaim_guidance_never_pipes_a_lookup_into_kill() {
        // review, security: the convenient one-liner does not preserve the
        // identity `port_holder` established. `lsof -ti tcp:3900 | xargs kill`
        // matches CONNECTED CLIENTS as well as the listener, and Windows
        // `findstr :3900` matches `:39001` and established connections — so a
        // user following it can end a process that merely talks to
        // Sesly, or one unrelated to it. The lookup has to be shown for
        // a human to check before anything is signalled.
        let guidance = reclaim_command(3900);

        assert!(
            !guidance.contains("| xargs kill") && !guidance.contains("|xargs kill"),
            "a lookup piped straight into kill can end a process nobody identified: {guidance}"
        );
        // The listener, not every socket on the port.
        if cfg!(target_os = "windows") {
            assert!(guidance.contains("-State Listen"), "{guidance}");
        } else {
            assert!(guidance.contains("-sTCP:LISTEN"), "{guidance}");
        }
        // And a step where the user confirms what they found.
        assert!(guidance.contains("confirmed"), "{guidance}");
    }

    #[test]
    fn every_wording_still_triggers_the_localised_port_hint() {
        // detectHints matches /port.*in use/i to swap this English string for
        // the translated bootstrap.hint_port. An earlier draft of one of these
        // said "is held by" and silently dropped the translation.
        for holder in [
            PortHolder::OurBackend(env!("CARGO_PKG_VERSION").to_string()),
            PortHolder::OurBackend("0.1.0".into()),
            PortHolder::Foreign,
            PortHolder::Unknown,
        ] {
            let msg = port_conflict_message(3900, &holder, "").to_lowercase();
            let port_at = msg.find("port").expect("no 'port' in the message");
            assert!(
                msg[port_at..].contains("in use"),
                "detectHints will not match this, so the user loses the translated hint: {msg}"
            );
        }
    }

    #[test]
    fn a_caller_suffix_is_appended_not_substituted() {
        let msg = port_conflict_message(3900, &PortHolder::Foreign, "so the backend can't restart.");

        assert!(msg.contains("another application"), "{msg}");
        assert!(msg.ends_with("so the backend can't restart."), "{msg}");
    }

    #[test]
    fn a_crash_tail_waits_for_the_dying_runs_last_words() {
        let _g = DRAINER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // #1850: `wait()` returns the moment the child exits, but the stderr
        // drainer is a separate thread still reading the pipe. Capturing
        // `last_stderr` at that instant produced a crash report whose log
        // stopped a minute before the death — the traceback that named the
        // cause never made it into the file in time.
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backend_err.log");
        fs::write(&path, "steady state\n").unwrap();

        let p = path.clone();
        let dying = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(120));
            let mut f = fs::OpenOptions::new().append(true).open(&p).unwrap();
            writeln!(f, "Traceback (most recent call last):").unwrap();
            writeln!(f, "RuntimeError: the actual cause").unwrap();
        });
        track_err_drainer(dying);

        // Without the settle this reads "steady state" and nothing else.
        settle_err_log(ERR_LOG_SETTLE);
        let tail = read_error_log_tail_at(&path, 0, 30);

        assert!(
            tail.contains("RuntimeError: the actual cause"),
            "the crash marker captured a tail that predates the death: {tail:?}"
        );
    }

    #[test]
    fn a_pinned_offset_survives_a_respawn_during_the_settle() {
        // review, #1994: settling can take up to two seconds, and a Retry
        // in that window installs a new run and moves ERR_LOG_RUN_START past
        // the dying run's output. Reading "the current run" after the wait
        // would hand the dead process's crash marker the REPLACEMENT's healthy
        // startup — the cross-run attribution #1510 exists to prevent,
        // reintroduced through the wait that fixes the tail. Death paths pin
        // the offset first, so the slice is the dying run's either way.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backend_err.log");
        fs::write(&path, "run1: RuntimeError: the actual cause
").unwrap();
        let pinned = 0u64;

        // A respawn lands mid-settle and the new run starts after that line.
        let moved_on = fs::metadata(&path).unwrap().len();
        fs::write(
            &path,
            "run1: RuntimeError: the actual cause
run2: healthy startup
",
        )
        .unwrap();

        assert!(
            read_error_log_tail_at(&path, pinned, 30).contains("the actual cause"),
            "the pinned offset must still name the dying run's slice"
        );
        assert!(
            !read_error_log_tail_at(&path, moved_on, 30).contains("the actual cause"),
            "sanity: reading from the new run's offset really does lose it"
        );
    }

    #[test]
    fn a_dead_runs_slice_stops_where_the_replacement_begins() {
        // review: a start offset with an unbounded end does not identify
        // ONE run. The replacement writes BELOW the dying run's lines, and a
        // tail reads the last N of the file — so the newer run's healthy
        // startup is exactly what the dead run's crash marker would get.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backend_err.log");
        let run1 = "run1: RuntimeError: the actual cause
";
        fs::write(&path, run1).unwrap();
        let boundary = run1.len() as u64;
        fs::write(&path, format!("{run1}run2: healthy startup
run2: listening
")).unwrap();

        let closed = read_error_log_slice(&path, 0, Some(boundary), 30);
        assert!(closed.contains("the actual cause"), "{closed}");
        assert!(!closed.contains("run2"), "the replacement's output leaked in: {closed}");

        // Unbounded, the tail is the replacement — the bug this closes.
        let open = read_error_log_slice(&path, 0, None, 2);
        assert!(open.contains("run2"), "sanity: an open end really does read the newer run");
    }

    #[test]
    fn an_unusable_end_degrades_to_the_rest_of_the_file() {
        // Same principle as an unusable start: evidence beats precision, and a
        // silent empty capture is the one outcome that helps nobody.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backend_err.log");
        fs::write(&path, "only line
").unwrap();

        // Past EOF, and an end that sits before the start — both mean the
        // caller cannot pin the far side, so the slice runs to the end of the
        // file. The start is honoured independently either way.
        assert_eq!(read_error_log_slice(&path, 0, Some(10_000), 10), "only line");
        assert_eq!(read_error_log_slice(&path, 5, Some(1), 10), "line");
    }

    #[test]
    fn a_wedged_drainer_is_handed_back_rather_than_detached() {
        let _g = DRAINER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // The bound exists so an orphaned grandchild holding the pipe cannot
        // stall crash recording. But giving up must not drop the handle:
        // every later caller would then have nothing to wait on, and the
        // respawn-offset guarantee (#1510) would quietly stop holding.
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let wedged = std::thread::spawn(move || {
            let _ = rx.recv();
        });
        track_err_drainer(wedged);

        settle_err_log(Duration::from_millis(60));

        assert!(
            !ERR_LOG_DRAINERS.lock().unwrap().is_empty(),
            "a drainer that outlived the bound was detached instead of retained"
        );

        // review: a NEW run installing its own drainer while the wait was
        // timing out must not evict the old one. A single slot dropped it here,
        // which detaches the thread — nothing could wait for that run's output
        // again, and both the #1510 and #1850 guarantees silently stopped
        // holding.
        let (tx2, rx2) = std::sync::mpsc::channel::<()>();
        track_err_drainer(std::thread::spawn(move || {
            let _ = rx2.recv();
        }));
        settle_err_log(Duration::from_millis(60));
        assert_eq!(
            ERR_LOG_DRAINERS.lock().unwrap().len(),
            2,
            "an unfinished drainer was dropped when another run installed one"
        );

        let _ = tx.send(());
        let _ = tx2.send(());
        for handle in ERR_LOG_DRAINERS.lock().unwrap().drain(..) {
            let _ = handle.join();
        }
    }
}
