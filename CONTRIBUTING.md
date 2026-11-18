# Contributing

Use Node.js 26.x, run `npm ci`, and follow the [local guide](docs/local-deployment.md). A fresh checkout uses an original demo map; no private campaign content is needed.

Browser features live under `src/client/features/`; shared browser/server data logic belongs in `src/shared/`, and API implementation belongs in `src/server/`. Keep Vercel entry points in `api/` and development/build commands in `scripts/`. Tests follow the `client`, `server`, `shared`, and `tooling` groups. See [architecture](docs/architecture.md) for the source-to-URL boundary; moving source files does not require changing served filenames.

Keep changes focused and describe the resulting behavior and validation in a pull request. Preserve guest read-only access, editor authorization, revision conflicts, older-session compatibility, and mobile map performance. New UI text needs English and Simplified Chinese coverage, accessible names, keyboard access, and visible focus. Use the existing Iconoir assets and design tokens.

English is the canonical language for all project documentation. Use the English interface labels in instructions, while preserving localized application strings and original third-party attribution.

Run `npm test`, `npm run licenses:check`, and `npm run build`. Add a behavioral regression test for persistence, access-control, geometry, or data-format changes. Use synthetic fixtures and isolated file stores; never write tests against a real shared campaign. Do not commit screenshots containing private maps or player data.

Add reviewed distributable source files to `scripts/release-files.json`. Keep generated output, map deployment inputs, local state, and secrets excluded. New third-party resources need their source, version, license, and complete attribution recorded. When updating npm dependencies, review changed licenses, run `node scripts/check-licenses.cjs --write`, and inspect the resulting inventory.

Contributions are submitted under the project's Apache-2.0 license, except clearly identified third-party material under its own compatible terms. Do not submit material you are not authorized to distribute. See [licenses](docs/licenses.md) for the current resource audit.
