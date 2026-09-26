"""Keep the Electron parity ledger and route smoke aligned with product sources."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _area(name: str, commands: str) -> dict[str, str]:
    return {command: name for command in commands.split()}


# Every registered native command must be assigned to a user-visible parity area. A new Tauri
# command therefore cannot land without an explicit Electron parity decision.
TAURI_COMMAND_AREAS = {
    **_area(
        "First-run/setup and model readiness",
        """
        bootstrap::bootstrap_status bootstrap::last_bootstrap_failure
        bootstrap::get_bootstrap_logs bootstrap::retry_bootstrap
        bootstrap::clean_and_retry_bootstrap setup::get_setup_state
        setup::check_install_target setup::complete_setup config::get_region config::set_region
        """,
    ),
    **_area(
        "Desktop lifecycle, files, update, tray, native shortcuts",
        """
        config::get_update_channel config::set_update_channel updater_channel::check_update
        updater_channel::install_update updater_channel::list_releases commands::set_tray_recording
        commands::quit_app
        """,
    ),
    **_area(
        "Models and engine configuration",
        "commands::authorize_host_path commands::hf_cache_scan",
    ),
    **_area(
        "Full settings: devices, network, storage, privacy, logs",
        """
        commands::get_sysinfo commands::read_log_tail commands::check_accessibility
        commands::open_accessibility_settings commands::check_microphone
        commands::open_microphone_settings commands::open_input_monitoring_settings
        uninstall::uninstall_scan uninstall::uninstall_purge reset::reset_scan reset::reset_purge
        """,
    ),
    **_area(
        "Dictation and transcription",
        """
        commands::simulate_paste commands::copy_dictation_output_session commands::simulate_type
        commands::activate_dictation_output_session commands::reject_dictation_output_session
        commands::finish_dictation_output_session commands::get_dictation_shortcut
        commands::get_effective_dictation_shortcut commands::set_dictation_shortcut
        commands::request_dictation_capture commands::begin_dictation_capture_registration
        commands::mark_dictation_capture_ready commands::acknowledge_dictation_capture_delivery
        commands::complete_dictation_capture_delivery commands::end_dictation_capture_registration
        commands::show_dictation_pill commands::get_launch_as_widget commands::set_launch_as_widget
        """,
    ),
    **_area(
        "Desktop lifecycle, files, update, tray, native shortcuts",
        """
        commands::clear_webview_cache_and_relaunch crash::get_last_backend_crash
        crash::acknowledge_backend_crash persistence_exit::confirm_persistence_flush
        blank_guard::report_render_state blank_guard::recover_main_window
        """,
    ),
    **_area(
        "Projects and recovery",
        "commands::save_text_file commands::reveal_host_path",
    ),
    **_area(
        "Batch processing",
        """
        watch_folder::watch_folder_pick watch_folder::watch_folder_scan
        watch_folder::watch_folder_enqueue watch_folder::watch_folder_forget
        """,
    ),
}


def test_every_tauri_page_is_mapped_in_the_capability_inventory() -> None:
    ledger = (ROOT / "electron" / "PARITY.md").read_text(encoding="utf-8")
    inventory = ledger.split("## Capability inventory", 1)[1].split(
        "## Current verification limits", 1
    )[0]
    pages = {
        path.name
        for path in (ROOT / "frontend" / "src" / "pages").glob("*.jsx")
        if ".test." not in path.name
    }
    mapped = set(re.findall(r"pages/([A-Za-z0-9_-]+\.jsx)", inventory))

    assert pages <= mapped, "Unmapped Tauri pages: " + ", ".join(sorted(pages - mapped))
    assert mapped <= pages, "Stale Tauri page references: " + ", ".join(sorted(mapped - pages))


def test_every_static_electron_route_is_in_the_layout_smoke() -> None:
    route_source = (ROOT / "electron" / "src" / "renderer" / "src" / "routes" / "index.ts").read_text(
        encoding="utf-8"
    )
    smoke_source = (ROOT / "electron" / "tests" / "route-layout-smoke.mjs").read_text(
        encoding="utf-8"
    )
    settings_source = (
        ROOT
        / "electron"
        / "src"
        / "renderer"
        / "src"
        / "features"
        / "settings"
        / "settings-page.tsx"
    ).read_text(encoding="utf-8")
    routes = {
        path
        for path in re.findall(r"\bpath:\s*'(/[^']*)'", route_source)
        if "$" not in path
    }
    missing = {
        path
        for path in routes
        if f"'{path}'" not in smoke_source and f'"{path}"' not in smoke_source
    }

    assert not missing, "Electron routes missing layout coverage: " + ", ".join(sorted(missing))

    orphaned_settings = {
        path
        for path in routes
        if path.startswith("/settings/")
        and f"'{path}'" not in settings_source
        and f'"{path}"' not in settings_source
    }
    assert not orphaned_settings, "Settings routes missing navigation: " + ", ".join(
        sorted(orphaned_settings)
    )


def test_every_model_family_route_has_layout_coverage() -> None:
    family_source = (
        ROOT
        / "electron"
        / "src"
        / "renderer"
        / "src"
        / "features"
        / "settings"
        / "model-family.ts"
    ).read_text(encoding="utf-8")
    family_block = family_source.split("export const modelFamilies = [", 1)[1].split(
        "] as const", 1
    )[0]
    families = set(re.findall(r"'([a-z-]+)'", family_block))
    smoke_source = (ROOT / "electron" / "tests" / "route-layout-smoke.mjs").read_text(
        encoding="utf-8"
    )

    missing = {family for family in families if f"'{family}'" not in smoke_source}
    assert not missing, "Model families missing layout coverage: " + ", ".join(sorted(missing))


def test_live_route_health_covers_every_rendered_route() -> None:
    """The real-backend acceptance list must follow the router, not a stale count."""
    route_source = (
        ROOT / "electron" / "src" / "renderer" / "src" / "routes" / "index.ts"
    ).read_text(encoding="utf-8")
    family_source = (
        ROOT
        / "electron"
        / "src"
        / "renderer"
        / "src"
        / "features"
        / "settings"
        / "model-family.ts"
    ).read_text(encoding="utf-8")
    live_source = (ROOT / "electron" / "tests" / "live-route-health.mjs").read_text(
        encoding="utf-8"
    )

    static_routes = {
        path
        for path in re.findall(r"\bpath:\s*'(/[^']*)'", route_source)
        if "$" not in path and path != "/settings"
    }
    family_block = family_source.split("export const modelFamilies = [", 1)[1].split(
        "] as const", 1
    )[0]
    families = set(re.findall(r"'([a-z-]+)'", family_block))
    expected = static_routes | {f"/settings/models/{family}" for family in families}
    live_block = live_source.split("const routes = [", 1)[1].split("];", 1)[0]
    covered = set(re.findall(r"'(/[^']*)'", live_block))

    assert covered == expected, (
        "Live route health inventory drifted: "
        f"missing={sorted(expected - covered)}, stale={sorted(covered - expected)}"
    )


def test_every_tauri_native_command_has_an_electron_parity_area() -> None:
    source = (ROOT / "frontend" / "src-tauri" / "src" / "lib.rs").read_text(encoding="utf-8")
    match = re.search(r"invoke_handler\(tauri::generate_handler!\[(.*?)\]\)", source, re.DOTALL)
    assert match, "Tauri native command registration was not found"
    registered = set(re.findall(r"\b(?:[a-z_]+::)+[a-z_]+\b", match.group(1)))
    mapped = set(TAURI_COMMAND_AREAS)

    assert registered <= mapped, "Unmapped Tauri native commands: " + ", ".join(
        sorted(registered - mapped)
    )
    assert mapped <= registered, "Stale Tauri native command mappings: " + ", ".join(
        sorted(mapped - registered)
    )

    ledger = (ROOT / "electron" / "PARITY.md").read_text(encoding="utf-8")
    missing_areas = {area for area in TAURI_COMMAND_AREAS.values() if f"| {area}" not in ledger}
    assert not missing_areas, "Native command areas missing from parity inventory: " + ", ".join(
        sorted(missing_areas)
    )
