import importlib.util
import json
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "frontend/src-tauri/wix/main.wxs"
SCRIPT = ROOT / "scripts/render-per-user-wix.py"
CONFIG = ROOT / "frontend/src-tauri/tauri.per-user.conf.json"


RESOURCE_FIXTURE = """<Wix><Component Id="helper.exe" Guid="random"><File Id="Bin_helper.exe" Source="C:/build/helper.exe" /></Component><!-- BEGIN BUNDLED_RESOURCES -->
<Component Id="randomRoot" Guid="00000000-0000-0000-0000-000000000001" KeyPath="yes" Win64="$(var.Win64)"><File Id="rootFile" Source="C:/build/README.md" /></Component>
<Directory Id="randomDir" Name="backend"><Directory Id="nestedDir" Name="data">
<Component Id="randomNested" Guid="00000000-0000-0000-0000-000000000002" KeyPath="yes" Win64="$(var.Win64)"><File Id="nestedFile" Source="C:/build/a&amp;b.json" /></Component>
</Directory></Directory><!-- END BUNDLED_RESOURCES --></Wix>"""


def _renderer():
    spec = importlib.util.spec_from_file_location("render_per_user_wix", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_machine_and_per_user_templates_have_distinct_scopes_and_roots():
    machine = SOURCE.read_text(encoding="utf-8")
    user = _renderer().render(machine, RESOURCE_FIXTURE)

    assert 'InstallScope="perMachine"' in machine
    assert 'InstallScope="perUser"' in user
    assert 'Directory Id="$(var.PlatformProgramFilesFolder)"' in machine
    assert 'Directory Id="LocalAppDataFolder"' in user
    assert 'Name="InstallScope" Type="string" Value="perMachine"' in machine
    assert 'Name="InstallScope" Type="string" Value="perUser"' in user
    assert 'Id="PrevInstallDirNoName" Root="HKLM"' in machine
    assert 'Id="PrevInstallDirNoName" Root="HKCU"' in user
    assert 'Id="PrevInstallDirWithName" Root="HKLM"' in machine
    assert 'Id="PrevInstallDirWithName" Root="HKCU"' in user
    assert (
        '<RegistryKey Root="HKCU" Key="Software\\\\{{manufacturer}}\\\\{{product_name}}">'
        in user
    )
    assert '<RegistryKey Root="HKCU" Key="Software\\Classes\\\\{{protocol}}">' in user
    assert 'Guid="{{path_component_guid}}"' in machine
    assert 'Guid="41f6d598-8908-4004-9332-291b64fd38be"' not in user


def test_per_user_bundle_has_separate_identity_and_no_elevated_update_task():
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    assert config["productName"].endswith("(Current User)")
    # The WiX resource snapshot comes from the preceding system build.
    # Null deletes the inherited hook via Tauri's JSON Merge Patch.
    assert config["build"]["beforeBuildCommand"] is None
    wix = config["bundle"]["windows"]["wix"]
    assert wix["upgradeCode"] == "f27de3a8-a9dc-4a3d-84bb-e98f1bf82393"
    assert wix["enableElevatedUpdateTask"] is False
    assert wix["template"] == "target/wix-per-user/main.wxs"


def test_per_user_template_never_contains_webview_install_actions():
    machine = SOURCE.read_text(encoding="utf-8")
    user = _renderer().render(machine, RESOURCE_FIXTURE)

    assert "https://go.microsoft.com/fwlink/p/?LinkId=2124703" in machine
    assert "ALLOWWEBVIEW2BOOTSTRAP" in machine
    for forbidden in (
        "https://go.microsoft.com/fwlink/p/?LinkId=2124703",
        "ALLOWWEBVIEW2BOOTSTRAP",
        "DownloadAndInvokeBootstrapper",
        "InvokeBootstrapper",
        "InvokeStandalone",
        "UpdateWebView2ViaEdgeUpdate",
    ):
        assert forbidden not in user
    assert "Installed OR REMOVE OR INSTALLED_WEBVIEW2_VERSION" in user


def test_release_builds_publishes_and_smokes_as_a_standard_user():
    workflow = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
    smoke = (ROOT / "scripts/smoke-per-user-msi.ps1").read_text(encoding="utf-8")
    updater = (ROOT / "frontend/src-tauri/src/updater_channel.rs").read_text(
        encoding="utf-8"
    )

    assert "render-per-user-wix.py" in workflow
    assert "tauri.per-user.conf.json" in workflow
    assert "artifact// (Current User)/_Current_User" in workflow
    assert "latest-user.json" in workflow
    assert "smoke-per-user-msi.ps1" in workflow
    assert "Start-Process msiexec.exe -Credential" in smoke
    assert "if ($LASTEXITCODE -ne 0)" in smoke
    assert "-PrepareHostedRunner" in workflow
    assert "New-LocalUser" in smoke
    assert "if ($createdUser)" in smoke
    assert "standard-user uninstall" in smoke
    assert "latest/download/latest-user.json" in updater
    assert "releases/download/preview/latest-user.json" in updater


def test_resource_components_use_hkcu_keypaths_and_remove_nested_folders():
    fragment, refs = _renderer().resource_authoring(RESOURCE_FIXTURE)
    tree = ET.fromstring("<Root>" + fragment + "</Root>")
    components = tree.findall(".//Component")
    for component in components:
        assert "KeyPath" not in component.attrib
        registry = component.find("RegistryValue")
        assert registry is not None
        assert registry.get("Root") == "HKCU"
        assert registry.get("KeyPath") == "yes"
        for file in component.findall("File"):
            assert file.get("KeyPath") != "yes"
    assert {node.get("Directory") for node in tree.findall(".//RemoveFolder")} == {
        node.get("Id") for node in tree.findall(".//Directory")
    }
    assert {node.get("Id") for node in ET.fromstring("<Root>" + refs + "</Root>")} == {
        component.get("Id") for component in components
    }
    assert any(
        file.get("Source") == "C:/build/a&b.json" for file in tree.findall(".//File")
    )


def test_resource_identity_depends_on_destination_not_random_tauri_ids_or_build_root():
    renderer = _renderer()
    first, first_refs = renderer.resource_authoring(RESOURCE_FIXTURE)
    second, second_refs = renderer.resource_authoring(
        RESOURCE_FIXTURE.replace("random", "other").replace("C:/build/", "D:/runner/")
    )
    assert first.replace("C:/build/", "D:/runner/") == second
    assert first_refs == second_refs


@pytest.mark.parametrize(
    "source",
    [
        "",
        "{{resources}}",
        "<!-- BEGIN BUNDLED_RESOURCES -->{{resources}}<!-- END BUNDLED_RESOURCES -->",
    ],
)
def test_missing_or_unrendered_system_resources_fail_closed(source):
    with pytest.raises(ValueError):
        _renderer().render(SOURCE.read_text(), source)


def test_main_and_helper_files_use_registry_keypaths():
    rendered = _renderer().render(SOURCE.read_text(), RESOURCE_FIXTURE)
    assert '<File Id="Path" Source="{{main_binary_path}}" Checksum="yes"/>' in rendered
    assert '<File Id="Bin_{{ bin.id }}" Source="{{bin.path}}"/>' in rendered
    assert (
        'Name="Binary_{{ bin.id }}" Type="integer" Value="1" KeyPath="yes"' in rendered
    )
    assert 'Guid="{{bin.guid}}"' not in rendered


def test_external_binary_guid_is_explicit_and_stable_across_builds():
    renderer = _renderer()
    first = renderer.render(SOURCE.read_text(), RESOURCE_FIXTURE)
    second = renderer.render(
        SOURCE.read_text(),
        RESOURCE_FIXTURE.replace("C:/build/", "D:/runner/").replace(
            'Guid="random"', 'Guid="another"'
        ),
    )
    marker = '<Component Id="{{ bin.id }}" Guid="'
    first_guid = first.split(marker)[1].split(" Win64=")[0]
    assert first_guid == second.split(marker)[1].split(" Win64=")[0]
    assert '(eq bin.id "helper.exe")' in first_guid
    assert 'Guid="*"' not in marker + first_guid


def test_registry_key_template_does_not_escape_handlebars_expressions():
    key = _renderer().registry_key("MainBinary").attrib["Key"]
    # A single backslash escapes the opening Handlebars delimiter. The canonical
    # WiX template doubles it so the installed key uses resolved product names.
    assert key == r"Software\\{{@root.manufacturer}}\\{{@root.product_name}}\Components"
