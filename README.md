# SeerJourney

A map-focused tabletop campaign journal. Share discoveries, routes, daily logs, Markdown documents, and party supplies with your players. Visitors browse without an account; editors unlock changes with a passphrase. Progress synchronizes between open pages.

The application supports calibrated hexagonal and square maps, English and Simplified Chinese controls, and iPhone/iPad Home Screen use. One deployment serves one map and campaign. A small, original demo map is included; campaign artwork is supplied separately.

## Start locally

Use Node.js **26.x** (see `.nvmrc`).

```sh
npm ci
cp .env.example .env
# Edit .env: choose private editor passphrases and a random SESSION_SECRET.
npm run dev
```

Open [localhost:8780](http://localhost:8780). The default demo works without a map download or cloud services. Local progress and uploaded images are stored in `.data/`.

For a supplied map mod, keep its editable folder outside this repository and stage it before starting:

```sh
npm run map:stage -- /absolute/path/to/my-map
npm run dev
```

See the [local deployment guide](docs/local-deployment.md) for the complete setup, map preparation, persistence, and backup instructions. Never overwrite an existing `.env` or campaign file to follow the quickstart.

## Documentation

- [Local deployment](docs/local-deployment.md): install, map selection, editor access, images, and backups.
- [Vercel deployment](docs/vercel-deployment.md): project setup, Redis, Blob, secrets, external maps, previews, and updates.
- [Configuration](docs/configuration.md): environment variables and the data model.
- [Map loading and deployment](docs/map-deployment.md) and [mod format](docs/map-mod-format.md).
- [User guide](docs/user-guide.md): logs, attachments, participants, documents, supplies, and controls.
- [Architecture and project layout](docs/architecture.md).
- [Licenses and resource audit](docs/licenses.md), [third-party notices](THIRD_PARTY_NOTICES.md).
- [Publication procedure](docs/publishing.md) and [contributing](CONTRIBUTING.md).

## Development

```sh
npm test
npm run licenses:check
npm run build
```

Tests use redistributable fixtures and do not read your campaign map or shared progress. `npm run build` writes a static allowlist into ignored `dist/`; the API stays server-side. A Vercel deployment needs both the static output and the root `api/` functions. Uploading `dist/` to a static-only host does not provide authentication or synchronization.

Use [Vercel deployment instructions](docs/vercel-deployment.md) to deploy with durable Redis state and public Blob image storage. A private map folder is excluded from Git, but its rendered artwork must be delivered to visitors by the deployed app. Only deploy maps you are authorized to serve.

## License

Application code, documentation, the original demo, and project-authored graphics are offered under [Apache License 2.0](LICENSE). Third-party components retain their own licenses and attribution; see [NOTICE](NOTICE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). External campaign maps and user-authored campaign content are not part of this source distribution or its license grant.
