"""Remove only this build/target's colliding installers before a release retry."""
import argparse
import json
import re
import subprocess


def matching_assets(names, version, target):
    versions = [version]
    updater = None
    if target == "x86_64-pc-windows-msvc":
        versions.append(version.replace("-", "."))
        suffix = r"x64(?:_[A-Za-z-]+\.msi(?:\.zip)?|-setup\.(?:exe|nsis\.zip))(?:\.sig)?"
    elif target == "aarch64-apple-darwin":
        suffix = r"aarch64\.dmg(?:\.sig)?"
        updater = re.compile(r"Sesly_aarch64\.app\.tar\.gz(?:\.sig)?")
    elif target == "x86_64-apple-darwin":
        suffix = r"x64\.dmg(?:\.sig)?"
        updater = re.compile(r"Sesly_x64\.app\.tar\.gz(?:\.sig)?")
    elif target == "x86_64-unknown-linux-gnu":
        suffix = r"amd64\.(?:AppImage(?:\.tar\.gz)?|deb)(?:\.sig)?"
    else:
        raise ValueError(f"Unsupported release target: {target}")
    pattern = re.compile(r"Sesly_(?:" + "|".join(map(re.escape, versions)) + ")_" + suffix)
    # macOS updater archives have no version in their names. The release tag
    # scopes their version; only this target's architecture may be replaced.
    return [name for name in names if pattern.fullmatch(name) or (updater and updater.fullmatch(name))]


def clear_assets(tag, version, target):
    result = subprocess.run(["gh", "release", "view", tag, "--json", "assets"],
                            capture_output=True, text=True)
    if result.returncode:
        if "HTTP 404" in result.stderr or "release not found" in result.stderr.lower():
            return
        raise RuntimeError(result.stderr)
    names = [asset["name"] for asset in json.loads(result.stdout)["assets"]]
    for name in matching_assets(names, version, target):
        result = subprocess.run(["gh", "release", "delete-asset", tag, name, "--yes"],
                                capture_output=True, text=True)
        if result.returncode and "HTTP 404" not in result.stderr:
            raise RuntimeError(result.stderr)
        print(f"Cleared retry asset: {name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--target", required=True)
    args = parser.parse_args()
    clear_assets(args.tag, args.version, args.target)
