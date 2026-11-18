# Preparing a public GitHub repository

The publication workflow deliberately creates a source-only copy with no inherited Git objects. A development repository that once committed private map art is not safe to publish merely because those files are later deleted or added to `.gitignore`.

## Create a clean source copy

Review `scripts/release-files.json`, the explicit publication allowlist. It includes application source, original demo/test fixtures, documentation, project artwork, and third-party license texts. It excludes personal maps, campaign saves/uploads, environment files, deployment identity, caches, generated bundles, and Git history.

```sh
npm test
npm run licenses:check
npm run release:prepare -- --check
npm run release:prepare -- /absolute/path/to/new-publication-folder
```

The exporter refuses an existing destination, copies only allowlisted regular files, rejects symlinks/private paths, and verifies every copied SHA-256. `release-manifest.json` records those hashes for your review and is itself ignored by Git. It is an inventory, not proof of legal clearance or absence of every possible secret.

Run the documented clean-install workflow **inside the new copy**:

```sh
npm ci
npm test
npm run licenses:check
npm run build
```

No private map or cloud credentials are needed for these checks. Inspect the file list and demo build. Do not copy `.env`, `.data`, `.vercel`, `.campaign-map`, or an old `.git` directory into the publication copy. Add only source files to `scripts/release-files.json` when evolving the export workflow.

## Initialize and publish when ready

If the clean copy has not already been initialized, run `git init -b main` there. Review `git status --short` before staging. The application's Apache-2.0 license, NOTICE, Iconoir MIT license, and all dependency notices must remain present.

Create an initial commit only after reviewing the copy. Then create a new, empty GitHub repository and add its remote. Push the fresh history from this directory, never the old development repository. The workflow under `.github/workflows/ci.yml` runs tests, license verification, publication validation, and a demo build; it needs no secrets and performs no deployment.

Enable GitHub private vulnerability reporting if you want to accept confidential reports. Configure branch protection and required checks to suit your collaborators. This repository does not contain deployment credentials or an automatic production release workflow.

## What is intentionally separate

- External map source and staged deployment artwork: owner-managed files outside the public source distribution.
- Session progress, Markdown documents, participant names, attachments: application data, not test fixtures.
- Vercel project/team identity and environment configuration: set independently for each operator.
- Historical development Git objects: retained privately for reference, not copied into the new repository.

The old development repository can continue to serve an existing deployment using its external map. It should remain private because its historical commits still contain the former map assets. No history rewrite is performed by the export script.
