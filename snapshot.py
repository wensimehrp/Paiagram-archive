#!/usr/bin/env python3
"""Archive new-snapshot into snapshots/YYYYMMDDHHMMSSZ and prune old snapshots."""

import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path

RETENTION = 30


def git(*args: str) -> None:
    subprocess.run(["git", *args], check=True)


def main() -> None:
    incoming = Path("new-snapshot")
    if not incoming.is_dir() or not any(incoming.iterdir()):
        print("No new snapshot.")
        return

    snapshot = Path("snapshots") / datetime.now(UTC).strftime("%Y%m%d%H%M%SZ")
    snapshot.parent.mkdir(exist_ok=True)
    incoming.rename(snapshot)
    print(f"Archived snapshot {snapshot}.")

    redirects_path = Path("http_config/_redirects")
    redirects = {
        line.split()[0]: line.split()[1]
        for line in Path("http_config/_redirects").read_text().splitlines()
    }
    redirects["/latest-snapshot"] = f"{snapshot}"
    redirects["/latest-snapshot/"] = f"{snapshot}"
    redirects["/latest-snapshot/docs"] = f"{snapshot}/docs/"
    redirects["/latest-snapshot/docs/"] = f"{snapshot}/docs/"
    redirects_path.write_text(
        "\n".join([f"{key} {val} 302" for key, val in redirects.items()]) + "\n"
    )

    old_snapshots = sorted(
        (entry for entry in snapshot.parent.iterdir() if entry.is_dir()), reverse=True
    )
    for old in old_snapshots[RETENTION:]:
        shutil.rmtree(old)
        print(f"Removed old snapshot {old}.")

    git("config", "user.name", "github-actions[bot]")
    git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    git("add", "-A")
    git("commit", "-m", f"snapshot: archive {snapshot.name}")
    git("push", "origin", "HEAD:main")


if __name__ == "__main__":
    main()
