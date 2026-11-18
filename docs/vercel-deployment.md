# Deploying to Vercel

This deployment serves one campaign. Visitors can read without signing in; only passphrase holders can edit. Vercel hosts the static app and Node API, Redis stores progress, and a public Blob store holds images. Map artwork is a separate deployment input, never a dependency fetched from the public Git repository.

## 1. Prepare the checkout and map

Use Node.js 26.x and install dependencies:

```sh
npm ci
npm test
npm run licenses:check
```

Use a clean checkout of the published source, not a development repository whose history contains private maps or saves. Install the Vercel CLI using its [official installation instructions](https://vercel.com/docs/cli). Node.js 26 prebuilt deployments require [Vercel CLI 65.8.0 or later](https://vercel.com/changelog/node-js-26-lts-is-now-generally-available-on-vercel). For automated deployments, pin a reviewed CLI version in your pipeline.

For a private campaign map, keep the original editable folder outside the repository and stage it:

```sh
npm run map:stage -- /absolute/path/to/my-map
```

`.campaign-map/` is ignored by Git but intentionally included in the **Vercel CLI upload**. Only validated manifest assets and optional generated tiles are staged. A build copies them into `dist/campaign-map/`. The API function bundle receives the matching metadata through `functions.includeFiles` in `vercel.json`. No developer-machine paths or image-source credentials are needed in Vercel.

For a demo deployment, omit staging and leave `CAMPAIGN_MAP_REQUIRED` unset. For a real campaign, set `CAMPAIGN_MAP_REQUIRED=1` in Production so a missing stage causes a failed build instead of publishing the demo.

## 2. Link the correct project

```sh
vercel login
vercel link
```

Select your intended account/team and create or select the campaign's project. Verify the project in the CLI output before continuing. `.vercel/project.json` is local deployment identity and must remain uncommitted.

The repository supplies `vercel.json` with framework `null`, build command `npm run build`, output directory `dist`, and Node functions in `api/`. Leave the root directory at the repository root. Use Node.js 26.x in Project Settings to match `package.json`. The default function region is `sfo1`; choose a region near your database when adapting this setting.

## 3. Connect persistent storage

In the project's Storage/Marketplace area, create or connect an **Upstash Redis** database. Select the plan and region you intend to use; review billing and eviction settings. Connect it to Production. Either supported credential pair works:

- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`;
- `KV_REST_API_URL` and `KV_REST_API_TOKEN` supplied by the integration.

Do not use `CAMPAIGN_STORE=file` on Vercel. Serverless files are not the durable campaign store. Existing Redis content is retained when the same database and campaign ID are redeployed.

Create and connect a **public Vercel Blob store** for attachments. The application supports the connected store's OIDC authorization with `BLOB_STORE_ID` and integration-provided `BLOB_WEBHOOK_PUBLIC_KEY`; a server-only `BLOB_READ_WRITE_TOKEN` is a fallback. New Blob connections support short-lived OIDC credentials, avoiding a permanent token. See [Vercel's OIDC announcement](https://vercel.com/changelog/vercel-blob-now-supports-oidc-authentication).

The image store must be public because saved attachments are intentionally viewable by guests. `BLOB_WEBHOOK_PUBLIC_KEY` is required by this application's presigned-upload flow, including when using the token fallback; it is not replaced by `BLOB_READ_WRITE_TOKEN`. Editor authorization still controls upload-token issuance and changes to attachment references. The app validates object metadata before saving it in a log.

## 4. Configure Production variables

Set these in Project Settings → Environment Variables for **Production**:

| Name | Value/type |
| --- | --- |
| `CAMPAIGN_STORE` | `redis` |
| `CAMPAIGN_ID` | A stable identifier, for example `my-campaign`. Keep the existing value when updating an established campaign. |
| `CAMPAIGN_MAP_REQUIRED` | `1` for an externally staged map. |
| `CAMPAIGN_PASSPHRASES` | JSON array of private editor passphrases; Secret. |
| `SESSION_SECRET` | Random secret of at least 32 bytes; Secret. |
| Redis REST credentials | From the database integration; token is Secret. |
| Blob configuration | From the connected store; any token is Secret. |

Generate a signing secret locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Enter the resulting value through the dashboard or a stdin prompt; do not put it in command arguments, Git, screenshots, or browser code.

Alternatively, after configuring a local `.env` and linking the project, `node scripts/sync-env.cjs` uploads its selected editor phrases, signing secret, campaign ID, map-required setting, and `CAMPAIGN_STORE=redis` to **Production** through stdin. Review that script before using it: it updates the linked project's configuration. It does not provision Redis/Blob and does not upload `CAMPAIGN_MAP_DIR` or local state. See [Vercel environment management](https://vercel.com/docs/cli/env).

Do not configure a local absolute `CAMPAIGN_MAP_DIR` in Vercel. That path exists only on your machine. Redeploy after environment changes, including passphrase rotation.

## 5. Build and release from the CLI

```sh
npm run map:stage -- /absolute/path/to/my-map
npm run build
vercel deploy --prod --skip-domain
```

The last command creates a production-environment deployment without moving the live domains. Verify its returned URL, then promote that tested deployment:

```sh
vercel promote DEPLOYMENT_URL
```

For a new project you can instead use `vercel deploy --prod` to assign its default domain immediately. CLI deployments upload the staged map even though Git excludes it; `.vercelignore` separately controls the deployment upload. Do not add `.campaign-map` to that file. See [Vercel's ignore-file behavior](https://vercel.com/docs/deployments/vercel-ignore) and [deploy command](https://vercel.com/docs/cli/deploy).

Before promoting, check the displayed map/fog, anonymous API reads, guest read-only controls, and editor login. On a disposable campaign namespace, test adding a day and uploading an image, then view it from a guest browser. Avoid test writes to a live campaign. Verify `/.env`, `/.data/campaign.json`, and `/src/server/campaign.cjs` are not served; map files and `/THIRD_PARTY_NOTICES.md` should be served.

For publicly viewable campaigns, set Vercel Deployment Protection accordingly for the production domain. That platform setting is separate from the app's editor passphrase. Add a custom domain through Vercel's domain settings if desired.

## Git-connected builds and automation

**A Git push cannot include a Git-ignored map folder.** Linking this source repository to automatic Vercel Git deployments will deploy only the demo unless you explicitly provision a map in that build. With `CAMPAIGN_MAP_REQUIRED=1`, an unprovisioned build fails safely.

The supported private-map workflow here is CLI deployment from a machine with the external map staged. The repository does not ship a map URL, download token, private submodule, or automatic map-fetch hook. If you add a private artifact download in CI, download/unpack into a temporary directory, run `map:stage`, validate the map ID, and then build/deploy. Keep artifact credentials in protected CI secrets. Never attach private maps or `.vercel` environment files as public workflow artifacts.

An optional prebuilt workflow is:

```sh
vercel pull --yes --environment=production
npm run map:stage -- /absolute/path/to/my-map
vercel build --prod
vercel deploy --prebuilt --prod --skip-domain
```

Run this from the linked project with the intended Production configuration. Remove `CAMPAIGN_MAP_DIR` from the local `.env` and shell for this workflow so the static build uses the staged map, matching the metadata bundled into the API. A local-only directory override must not select a different map during the prebuilt build. Test the returned deployment and promote it. Do not commit `.vercel/output`; it contains the deployment's map and function artifacts.

Use a separate Preview database and Blob store, or at least a separate `CAMPAIGN_ID`. Never point unreviewed preview code at production credentials or permit public pull requests to access private map artifacts.

## Updating and restoring

- Code update: install locked dependencies, test, re-stage the map, build, deploy, verify, promote.
- Compatible map update: retain its ID/grid meanings, update the revision and assets, regenerate any tiles, re-stage, and redeploy. Stale tile source hashes are rejected.
- Different map: use a new campaign ID/database namespace and compatible saved session. A map mismatch is rejected; it does not reset shared progress.
- Session restore: sign in, then Options → Load session. This changes shared progress and is separate from map selection.
- Backup: save session JSON and retain the map plus all referenced Blob objects. Session exports contain URLs, not uploaded bytes. Local image URLs are not automatically migrated to Blob.
- Rollback: restore a previous code deployment using Vercel's deployment tools. This does not roll back Redis content or images; retain separate data backups.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| Build says no map staged | Re-run `map:stage` locally and deploy with the CLI. A Git-connected build needs a separate artifact-provisioning step. |
| Build cannot find a local map directory | Remove `CAMPAIGN_MAP_DIR` from Vercel; upload the staged map instead. |
| API returns 503 | Confirm Production Redis credentials, `CAMPAIGN_STORE=redis`, and valid auth settings; inspect function logs without printing secrets. |
| API returns map mismatch | Restore the correct map or isolate the new campaign's storage namespace. Do not erase the old save as a shortcut. |
| Upload stays at 0% or times out | Confirm Blob connection, public access, network access, and CSP. Preserve `https://vercel.com/api/blob/` in `connect-src`; the bundled SDK needs that endpoint. |
| Login works locally but not hosted | Confirm Production allowlist/secret and redeploy after changes. Check domain/origin and HTTPS. |
| A guest sees an old UI | Reopen/reload the app after deployment. The service worker versions static assets; API state remains network-only. |
| Map works but images are missing after a restore | Restore the referenced image objects or re-upload them. JSON backups do not carry image bytes. |

Map assets are excluded from the open-source repository, not hidden from deployed visitors. Public map tiles, fog/revealed images, and stored campaign content are retrievable by viewers; fog is a gameplay presentation feature, not a security boundary.
