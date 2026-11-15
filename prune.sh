#!/usr/bin/env bash

set -euo pipefail

# use the bot email :-)
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git checkout --orphan prune-history
git add -A

if git diff --cached --quiet; then
  echo "No files to commit after prune."
  exit 0
fi

git commit -m "prune: crush history"
git push --force origin prune-history:main
