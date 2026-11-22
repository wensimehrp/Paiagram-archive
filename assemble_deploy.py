#!/usr/bin/env python3
"""Assemble the Cloudflare Pages deployment directory."""

import shutil
from pathlib import Path

SPECIAL_DIRS = ("site", "http_config")
EXCLUDED_DIRS = {"new-snapshot", "_deploy"}


def copy_into(source: Path, destination: Path) -> None:
    shutil.copytree(source, destination, symlinks=True, dirs_exist_ok=True)


def main() -> None:
    output = Path("_deploy")
    if output.exists():
        shutil.rmtree(output)
    output.mkdir()

    for entry in sorted(Path(".").iterdir()):
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        if entry.name in SPECIAL_DIRS or entry.name in EXCLUDED_DIRS:
            continue
        copy_into(entry, output / entry.name)

    for name in SPECIAL_DIRS:
        source = Path(name)
        if source.is_dir():
            copy_into(source, output)


if __name__ == "__main__":
    main()
