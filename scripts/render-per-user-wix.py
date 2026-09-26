#!/usr/bin/env python3
"""Render the supported per-user MSI template from the canonical WiX source."""

from __future__ import annotations

import argparse
import json
import xml.etree.ElementTree as ET
from pathlib import Path, PureWindowsPath
from uuid import UUID, uuid5

WEBVIEW_ACTIONS_START = "        <!-- BEGIN WEBVIEW_INSTALL_ACTIONS -->"
WEBVIEW_ACTIONS_END = "        <!-- END WEBVIEW_INSTALL_ACTIONS -->"

TRANSFORMS = (
    ('InstallScope="perMachine"', 'InstallScope="perUser"'),
    (
        'Id="PrevInstallDirNoName" Root="HKLM"',
        'Id="PrevInstallDirNoName" Root="HKCU"',
    ),
    (
        'Id="PrevInstallDirWithName" Root="HKLM"',
        'Id="PrevInstallDirWithName" Root="HKCU"',
    ),
    (
        '<Directory Id="$(var.PlatformProgramFilesFolder)" Name="PFiles">',
        '<Directory Id="LocalAppDataFolder" Name="LocalAppData">',
    ),
    (
        '<RegistryKey Root="HKLM" Key="Software\\\\{{manufacturer}}\\\\{{product_name}}">',
        '<RegistryKey Root="HKCU" Key="Software\\\\{{manufacturer}}\\\\{{product_name}}">',
    ),
    ('Value="perMachine"', 'Value="perUser"'),
    (
        'Guid="{{path_component_guid}}"',
        'Guid="41f6d598-8908-4004-9332-291b64fd38be"',
    ),
    (
        r'<RegistryKey Root="HKLM" Key="Software\Classes\\{{protocol}}">',
        r'<RegistryKey Root="HKCU" Key="Software\Classes\\{{protocol}}">',
    ),
    (
        (
            "        <!-- Managed-deployment switches. Explicit allow is required for network bootstrap. -->\n"
            '        <Property Id="ALLOWWEBVIEW2BOOTSTRAP" Secure="yes" />\n'
            '        <Property Id="DISABLEWEBVIEW2BOOTSTRAP" Secure="yes" />'
        ),
        "        <!-- The current-user bundle never installs or updates WebView2. -->",
    ),
    (
        '        <Condition Message="Microsoft Edge WebView2 Runtime is required. Install the Evergreen Standalone Runtime first, or explicitly set ALLOWWEBVIEW2BOOTSTRAP=1."><![CDATA[Installed OR REMOVE OR INSTALLED_WEBVIEW2_VERSION OR (ALLOWWEBVIEW2BOOTSTRAP = "1" AND DISABLEWEBVIEW2BOOTSTRAP <> "1")]]></Condition>',
        '        <Condition Message="Microsoft Edge WebView2 Runtime is required. Install the Evergreen Runtime for the current user first."><![CDATA[Installed OR REMOVE OR INSTALLED_WEBVIEW2_VERSION]]></Condition>',
    ),
)


RESOURCE_START = "<!-- BEGIN BUNDLED_RESOURCES -->"
RESOURCE_END = "<!-- END BUNDLED_RESOURCES -->"
USER_NAMESPACE = UUID("f27de3a8-a9dc-4a3d-84bb-e98f1bf82393")


def registry_key(name: str) -> ET.Element:
    return ET.Element(
        "RegistryValue",
        {
            "Root": "HKCU",
            "Key": r"Software\\{{@root.manufacturer}}\\{{@root.product_name}}\Components",
            "Name": name,
            "Type": "integer",
            "Value": "1",
            "KeyPath": "yes",
        },
    )


def resource_authoring(system_wxs: str) -> tuple[str, str]:
    """Reuse Tauri's resolved resource destinations, never its random component IDs."""
    if system_wxs.count(RESOURCE_START) != 1 or system_wxs.count(RESOURCE_END) != 1:
        raise ValueError(
            "system WiX source must contain exactly one marked bundled resource block"
        )
    fragment = system_wxs.split(RESOURCE_START, 1)[1].split(RESOURCE_END, 1)[0]
    if "{{" in fragment:
        raise ValueError("system WiX resources must already be rendered by Tauri")
    tree = ET.fromstring("<Resources>" + fragment + "</Resources>")
    refs = []
    directories = []
    destinations = set()

    def visit(node: ET.Element, path: tuple[str, ...]) -> None:
        for child in node:
            if child.tag == "Directory":
                destination = (*path, child.attrib["Name"])
                identity = uuid5(
                    USER_NAMESPACE, "directory:" + "/".join(destination).casefold()
                ).hex
                child.set("Id", "UserDir" + identity)
                directories.append(child.attrib["Id"])
                visit(child, destination)
            elif child.tag == "Component":
                files = child.findall("File")
                if len(files) != 1:
                    raise ValueError(
                        "expected exactly one file per Tauri resource component"
                    )
                file = files[0]
                name = file.get("Name") or PureWindowsPath(file.attrib["Source"]).name
                destination = "/".join((*path, name)).casefold()
                if destination in destinations:
                    raise ValueError(f"duplicate resource destination: {destination}")
                destinations.add(destination)
                identity = uuid5(USER_NAMESPACE, "file:" + destination)
                component_id = "UserResource" + identity.hex
                child.set("Id", component_id)
                child.set("Guid", str(identity))
                child.attrib.pop("KeyPath", None)
                file.attrib.pop("KeyPath", None)
                file.set("Id", "UserFile" + identity.hex)
                child.append(registry_key(component_id))
                refs.append(component_id)
            else:
                raise ValueError(f"unexpected Tauri resource element: {child.tag}")

    visit(tree, ())
    if directories:
        cleanup = ET.SubElement(
            tree,
            "Component",
            {
                "Id": "UserResourceDirectoryCleanup",
                "Guid": str(uuid5(USER_NAMESPACE, "resource-directory-cleanup")),
                "Win64": "$(var.Win64)",
            },
        )
        cleanup.append(registry_key("UserResourceDirectoryCleanup"))
        for directory in directories:
            ET.SubElement(
                cleanup,
                "RemoveFolder",
                {
                    "Id": "Remove" + directory,
                    "Directory": directory,
                    "On": "uninstall",
                },
            )
        refs.append(cleanup.attrib["Id"])
    return (
        "\n".join(ET.tostring(node, encoding="unicode") for node in tree),
        "\n".join(f'<ComponentRef Id="{ref}" />' for ref in refs),
    )


def render(source: str, system_wxs: str) -> str:
    rendered = source
    for old, new in TRANSFORMS:
        count = rendered.count(old)
        if count != 1:
            raise ValueError(f"expected exactly one WiX token, found {count}: {old}")
        rendered = rendered.replace(old, new)

    start_count = rendered.count(WEBVIEW_ACTIONS_START)
    end_count = rendered.count(WEBVIEW_ACTIONS_END)
    if (start_count, end_count) != (1, 1):
        raise ValueError(
            "expected exactly one marked WebView2 action block, "
            f"found start={start_count}, end={end_count}"
        )
    start = rendered.index(WEBVIEW_ACTIONS_START)
    end = rendered.index(WEBVIEW_ACTIONS_END, start) + len(WEBVIEW_ACTIONS_END)
    rendered = (
        rendered[:start]
        + "        <!-- WebView2 is a prerequisite for current-user installs. -->"
        + rendered[end:]
    )
    resources, references = resource_authoring(system_wxs)
    rendered = rendered.replace("{{resources}}", resources)
    resource_refs = '{{#each resource_file_ids as |resource_file_id| ~}}\n                <ComponentRef Id="{{ resource_file_id }}"/>\n            {{/each~}}'
    if rendered.count(resource_refs) != 1:
        raise ValueError("expected exactly one Tauri resource reference block")
    rendered = rendered.replace(resource_refs, references)
    rendered = rendered.replace(
        'Guid="41f6d598-8908-4004-9332-291b64fd38be"',
        f'Guid="{uuid5(USER_NAMESPACE, "main-binary-registry-keypath")}"',
    )
    # WiX cannot auto-generate GUIDs for components containing both a file and
    # a registry keypath. Tauri binary IDs are sanitized installed filenames;
    # retain the dynamic bin.path while supplying stable, per-user GUIDs.
    system_tree = ET.fromstring(system_wxs)
    binary_guids = []
    for component in system_tree.iter():
        if component.tag.rsplit("}", 1)[-1] != "Component":
            continue
        for file in component:
            if file.tag.rsplit("}", 1)[-1] != "File" or not file.get(
                "Id", ""
            ).startswith("Bin_"):
                continue
            binary_id = component.attrib["Id"]
            installed_name = (
                file.get("Name") or PureWindowsPath(file.attrib["Source"]).name
            )
            guid = uuid5(USER_NAMESPACE, "binary:" + installed_name.casefold())
            binary_guids.append(
                "{{#if (eq bin.id "
                + json.dumps(binary_id)
                + ")}}"
                + str(guid)
                + "{{/if}}"
            )
    rendered = rendered.replace(
        'Guid="{{bin.guid}}"', 'Guid="' + "".join(binary_guids) + '"'
    )
    for file_token, key_name in (
        (
            '<File Id="Path" Source="{{main_binary_path}}" KeyPath="yes" Checksum="yes"/>',
            "MainBinary",
        ),
        (
            '<File Id="Bin_{{ bin.id }}" Source="{{bin.path}}" KeyPath="yes"/>',
            "Binary_{{ bin.id }}",
        ),
    ):
        if rendered.count(file_token) != 1:
            raise ValueError(f"expected exactly one binary file token: {file_token}")
        rendered = rendered.replace(
            file_token,
            file_token.replace(' KeyPath="yes"', "")
            + ET.tostring(registry_key(key_name), encoding="unicode"),
        )
    return rendered


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--system-wxs",
        type=Path,
        required=True,
        help="Fully rendered system MSI main.wxs from the preceding Tauri bundle",
    )
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        render(
            args.source.read_text(encoding="utf-8"),
            args.system_wxs.read_text(encoding="utf-8"),
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
