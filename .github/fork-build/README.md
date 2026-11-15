<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 The RadioFoundry Authors -->

# Fork build API (fork only, not for upstream)

The web flasher of this fork builds custom firmware like the project's flasher does, but through GitHub Actions:

1. The flasher calls the Worker (`worker.js`) with the radio and the ticked features.
2. The Worker starts `.github/workflows/build-on-demand.yml` through the GitHub API.
3. The workflow builds the image and publishes it as the pre-release `build-<id>`.
4. The flasher asks the Worker how it goes, then takes the manifest and the image through it.

## Setup, once

1. GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token.
   Repository access: only this repository. Permissions: Actions (read and write), Contents (read). Copy the token.
2. Cloudflare dashboard > Workers & Pages > Create > Create Worker, name it `rfoundry-build`, Deploy, then Edit code:
   replace the code with `worker.js` and Deploy.
3. The Worker > Settings > Variables and Secrets > Add: type Secret, name `GH_TOKEN`, value the token. Deploy.
4. Note the Worker's address (`https://rfoundry-build.<account>.workers.dev`).
5. GitHub > this repository > Settings > Secrets and variables > Actions > Variables > New repository variable:
   name `BUILD_API`, value the Worker's address followed by `/v1/`.
6. Actions > Pages (fork) > Run workflow, to rebuild the site with it.

The Worker accepts requests only from the site's address (`ORIGIN` in `worker.js`) in a browser, refuses more than
three builds at once and checks every name it passes on.
