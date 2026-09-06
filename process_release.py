import json
import os
import subprocess
import sys
import urllib.request


def main():
    repo = "wensimehrp/Paiagram"
    url = f"https://api.github.com/repos/{repo}/releases/latest"

    # Using the standard GitHub Actions token to prevent rate-limiting
    headers = {"User-Agent": "GitHub-Actions"}
    token = os.getenv("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, headers=headers)

    try:
        with urllib.request.urlopen(req) as response:
            release_data = json.loads(response.read().decode())
    except Exception as e:
        print(f"Failed to fetch latest release: {e}")
        sys.exit(1)

    tag_name = release_data.get("tag_name")
    if not tag_name:
        print("No tag name found in the latest release.")
        sys.exit(1)

    print(f"Latest release identified: {tag_name}")

    # 1. Check if a folder with the release tag already exists
    if os.path.isdir(tag_name):
        print(f"Folder '{tag_name}' already exists. Ending subroutine.")
        sys.exit(0)

    # 2. Look for example.paia in the release assets
    assets = release_data.get("assets", [])
    example_asset = next((a for a in assets if a.get("name") == "example.paia"), None)

    if example_asset:
        download_url = example_asset.get("browser_download_url")
        download_path = "example.paia"
        print(f"Found example.paia. Downloading from {download_url}...")
        urllib.request.urlretrieve(download_url, download_path)

        # 3a. Run fork script with file and tag
        print(f"Running fork script for {tag_name} with example file...")
        subprocess.run(["bash", "./fork", download_path, tag_name], check=True)

        # 4. clean up the file
        os.remove(download_path)
        print(f"Cleaned up temporary {download_path}.")
    else:
        # 3b. Run fork script with tag only (passing empty string for $1 so it falls back gracefully)
        print(
            f"No example.paia found in the release. Running fork script for {tag_name}..."
        )
        subprocess.run(["bash", "./fork", "", tag_name], check=True)


if __name__ == "__main__":
    main()
