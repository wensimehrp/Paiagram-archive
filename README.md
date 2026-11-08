# Paiagram Archive

File archive for <https://paiagram.com>. This repository is a deployment repository for the website.
It contains the data for legacy versions, redirection definitions, documentation, the main site,
and so on and so forth.

## Organization and Deployment

Some folders are special:

- `http_config` stores http headers and redirect definitions; its contents will be moved to the root
  when deployed.
- `site` contains the contents of the site; its contents will be moved to the root when deployed.

Other folders will be deployed as-is.

The contents in the workspace root will be first cleared during a deployment.

## Snapshotting

Paiagram has a lot of snapshot versions. Each snapshot version will create a new snapshot folder
in the form of `snapshots/YYYYMMDDHHMMSSZ` (UTC), e.g. `snapshots/20261101223742Z`. In addition,
<https://paiagram.com/latest-snapshot> will always point to the latest snapshot using `_redirects`
from `http_config`.

The repository keeps a maximum of 30 snapshot builds under the `snapshots` directory. Old snapshots
will be deleted.

`wensimehrp/Paiagram` will push new snapshots to the `new-snapshot` directory. `new-snapshot` will
not be deployed. The content of `new-snapshot` will be moved to `snapshots/YYYYMMDDHHMMSSZ` and
commited.

## Pruning

The repository is pruned weekly. All Git history will be removed.
