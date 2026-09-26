use serde::Deserialize;
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const MAX_PLAN_BYTES: u64 = 64 * 1024;
const MAX_TARGETS: usize = 16;
const OWNER_EXIT_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CleanupPlan {
    paths: Vec<PathBuf>,
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let key = "USERPROFILE";
    #[cfg(not(target_os = "windows"))]
    let key = "HOME";
    std::env::var_os(key)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn has_signature(path: &Path) -> bool {
    [
        "omnivoice.db",
        "prefs.json",
        "voices",
        "outputs",
        "engines",
        "runtime",
    ]
    .iter()
    .any(|name| path.join(name).exists())
}

fn recognizably_owned(path: &Path, home: Option<&Path>) -> bool {
    if !path.is_absolute() || path.parent().is_none() || home == Some(path) {
        return false;
    }
    const OWNED: [&str; 6] = [
        "OmniVoice",
        "omnivoice",
        ".omnivoice",
        "Sesly",
        "com.salihavcioglu.sesly",
        "huggingface",
    ];
    path.components()
        .filter_map(|component| component.as_os_str().to_str())
        .any(|component| {
            OWNED
                .iter()
                .any(|owned| component.eq_ignore_ascii_case(owned))
        })
        || has_signature(path)
}

#[cfg(target_os = "windows")]
fn wait_for_owner(owner_pid: u32) -> bool {
    use windows::Win32::Foundation::{CloseHandle, WAIT_TIMEOUT};
    use windows::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };
    let Ok(handle) = (unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, owner_pid) }) else {
        return true;
    };
    let deadline = Instant::now() + OWNER_EXIT_TIMEOUT;
    let mut exited = false;
    while Instant::now() < deadline {
        if unsafe { WaitForSingleObject(handle, 250) } != WAIT_TIMEOUT {
            exited = true;
            break;
        }
    }
    let _ = unsafe { CloseHandle(handle) };
    exited
}

#[cfg(not(target_os = "windows"))]
fn wait_for_owner(owner_pid: u32) -> bool {
    if owner_pid > i32::MAX as u32 {
        return true;
    }
    let deadline = Instant::now() + OWNER_EXIT_TIMEOUT;
    while Instant::now() < deadline {
        let result = unsafe { libc::kill(owner_pid as i32, 0) };
        if result != 0 && io::Error::last_os_error().raw_os_error() != Some(libc::EPERM) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

fn remove_target(path: &Path) -> io::Result<()> {
    let info = match fs::symlink_metadata(path) {
        Ok(info) => info,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if info.is_dir() && !info.file_type().is_symlink() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

pub fn run(owner_pid: u32, plan_path: &Path) -> io::Result<()> {
    let info = fs::metadata(plan_path)?;
    if info.len() > MAX_PLAN_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Cleanup plan is too large",
        ));
    }
    let plan: CleanupPlan = serde_json::from_slice(&fs::read(plan_path)?)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    fs::remove_file(plan_path)?;
    if plan.paths.is_empty() || plan.paths.len() > MAX_TARGETS {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid cleanup target count",
        ));
    }
    let home = home_dir().and_then(|path| fs::canonicalize(path).ok());
    let mut seen = HashSet::new();
    let mut paths = Vec::new();
    for path in plan.paths {
        let canonical = fs::canonicalize(&path)?;
        if !recognizably_owned(&canonical, home.as_deref()) || !seen.insert(canonical.clone()) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Unsafe cleanup target",
            ));
        }
        paths.push(canonical);
    }
    if !wait_for_owner(owner_pid) {
        return Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "Owner process did not exit",
        ));
    }
    let mut failures = Vec::new();
    for path in paths {
        if let Err(error) = remove_target(&path) {
            failures.push(format!("{}: {error}", path.display()));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(io::Error::other(failures.join("; ")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ownership_guard_rejects_roots_and_accepts_app_signatures() {
        let root = std::env::temp_dir().join(format!("desktop-cleanup-{}", std::process::id()));
        let signed = root.join("custom-data");
        fs::create_dir_all(&signed).unwrap();
        fs::write(signed.join("omnivoice.db"), b"db").unwrap();
        assert!(recognizably_owned(&signed, home_dir().as_deref()));
        assert!(!recognizably_owned(Path::new("."), home_dir().as_deref()));
        if let Some(home) = home_dir() {
            assert!(!recognizably_owned(&home, Some(&home)));
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleanup_reads_then_removes_only_the_authorized_tree() {
        let root = std::env::temp_dir().join(format!("native-cleanup-{}", std::process::id()));
        let target = root.join("custom-data");
        let plan = root.join("plan.json");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("omnivoice.db"), b"db").unwrap();
        fs::write(
            &plan,
            serde_json::to_vec(&serde_json::json!({ "paths": [&target] })).unwrap(),
        )
        .unwrap();
        run(u32::MAX, &plan).unwrap();
        assert!(!target.exists());
        assert!(!plan.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
