# Architecture and project layout

SeerJourney is a vanilla JavaScript web application with CommonJS Node APIs. A deployment selects one map; guest browsers read shared campaign state while editors authenticate with a passphrase. There is no account database or frontend build framework.

```text
api/                              Vercel HTTP entry points
src/client/                       browser shell, app entry point, styles, sync client
src/client/features/map/          map loading, tiles, layers, routes, marker picker
src/client/features/game-log/     daily logs, image attachments and upload bundle entry
src/client/features/adventure-notes/ documents, styles and Markdown bundle entry
src/client/features/participants/ participant tags and character route filters
src/client/features/supplies/     supply forms, inventory page and feature styles
src/client/i18n/                  localization runtime and locales/ dictionaries
src/client/ui/                    shared dialog dismissal behavior
src/client/pwa/                   installation, service worker and web manifest
src/shared/                       geometry, session/mod validation and supply accounting
src/server/                       auth, campaign validation, storage, images, map config
scripts/                          local server, build, map staging/unpacking, audits/export
examples/demo-map/                original redistributable map and optional tile pyramid
tests/client/                     browser behavior, rendering and feature tests
tests/server/                     API, authorization and persistence tests
tests/shared/                     shared geometry, mod and supply data tests
tests/tooling/                    build, staging, unpacking and publication tests
tests/helpers/, tests/fixtures/   isolated harnesses and redistributable fixtures
assets/icons/                     project nautical mark and app icons
assets/iconoir/                   pinned third-party SVGs, source mapping and MIT license
licenses/                         dependency license texts and machine-readable audit
docs/                             deployment, usage, architecture, license documentation
skills/seerjourney-mod/           reusable map-preparation guidance and portable packer
tools/                            optional Python generators for icons/demo/tiles
.github/workflows/                source-only test/build CI; no production secrets
```

The physical source layout is separate from the served URLs. `src/client/index.html` loads the application modules, and `src/client/styles.css` and feature styles share the established design system. The build keeps the existing browser filenames and URLs, such as `/app.js`, `/game-log.js`, `/core.js`, and `/sw.js`, stable for the PWA; the feature folders are not URL prefixes.

`src/shared/core.js` handles geometry/session validation, `src/shared/map-mod.js` validates mod data, and `src/shared/supplies-core.js` accounts for supplies. These modules are used by both the browser and API. `src/client/features/map/campaign-bootstrap.js` loads the selected deployment map; `src/client/campaign-client.js` manages authenticated writes, polling and conflicts. Feature modules provide logs, images, participant paths, Markdown documents, and supplies. `src/client/ui/dialog-dismiss.js` and `src/client/features/map/marker-ui.js` share dialog and icon-picker behavior.

`scripts/build.cjs` checks vendored icons/licenses, bundles upload/Markdown dependencies, and copies an explicit static asset allowlist to `dist/`. Map-specific files come through `scripts/map-assets.cjs` from the selected external/staged map. The service worker caches app assets and versioned map rasters; API calls always use the network.

The browser and API use the same selected map ID/grid. `src/server/campaign.cjs` validates session updates with atomic revision checks. `src/server/storage.cjs` provides a durable local file adapter and Redis REST adapter. `src/server/images.cjs` authorizes uploads and verifies image references. The local server in `scripts/dev.cjs` binds to loopback and serves only `dist/` plus the API handlers.

Generated/private directories are `.campaign-map/`, `dist/`, `.data/`, `.vercel/`, `node_modules/`, and optional `.venv/`. The source export does not copy them or old Git objects. External map sources remain outside the checkout. See [publication](publishing.md) for why the clean copy has a fresh history.
