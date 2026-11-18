# Configuration

Secrets belong in ignored `.env` for local use or Vercel server environment variables. Never add `NEXT_PUBLIC_`/`VITE_` prefixes or put credentials in a map manifest. Environment changes on Vercel require a new deployment.

| Variable | Purpose |
| --- | --- |
| `CAMPAIGN_STORE` | `file` for the local development server; `redis` for Vercel. File storage is rejected in production. |
| `CAMPAIGN_ID` | Stable Redis and image-storage namespace, 1–80 ASCII letters, digits, `_` or `-`. Use a distinct ID for each campaign and environment. Set it explicitly for hosted campaigns. |
| `CAMPAIGN_PASSPHRASES` | JSON array of 1–100 editor passphrases, each 8–512 characters. Server secret. |
| `SESSION_SECRET` | Random signing secret, at least 32 bytes. Server secret. Changing it invalidates all editor sessions. |
| `CAMPAIGN_DATA_FILE` | Local file-store path; default `.data/campaign.json`. Images are stored beside this file. |
| `CAMPAIGN_MAP_DIR` | Absolute external map directory for local builds/staging. Never set a developer-machine path in Vercel. |
| `CAMPAIGN_MAP_REQUIRED` | Set to `1` when a real external/staged map is mandatory; fail instead of accidentally building the demo. Set in Vercel Production for a private-map deployment. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Redis REST endpoint and secret. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Alternative names supplied by a Vercel integration. Used if the corresponding Upstash-prefixed values are absent. |
| `BLOB_STORE_ID` | Connected public Blob store ID for Vercel OIDC authorization. |
| `BLOB_WEBHOOK_PUBLIC_KEY` | Blob integration callback verification key; required for this app's hosted presigned uploads, including with the token fallback. |
| `BLOB_READ_WRITE_TOKEN` | Optional server-only Blob token fallback; not needed with a correctly connected OIDC store. |
| `PORT` | Local HTTP port; default `8780`. |

## Three separate identities

- **Map ID** in `map.json` identifies geometry and the meaning of cell coordinates. Keep it stable when updating compatible artwork; change it if grid semantics change.
- **Campaign ID** is the durable Redis key/image prefix namespace. Keep it stable across redeploys of the same campaign. Different IDs can share one map, but must not unintentionally share state.
- **Campaign name** is editable in the UI and displayed in the header. Renaming it changes neither ID nor storage namespace.

Do not point a new incompatible map at an existing campaign's data. Test code upgrades with a separate database/namespace and matching map. Loading a session is an explicit editor action; deploying new code does not intentionally reset saved progress.

## Authorization and synchronization

Guests can read the campaign and its attachments. Passphrases grant editing, not privacy for the public content. The server signs HttpOnly, SameSite=Strict cookies with a 12-hour lifetime and checks the credential against the current allowlist on requests. Removing a phrase revokes its sessions after the updated environment is deployed. Origin checks, body limits, and rate limits guard mutation endpoints.

Sessions use atomic revision checks. A stale editor receives a conflict instead of overwriting a newer save; the client provides draft recovery. Visible clients poll every five seconds, background clients every thirty seconds. Camera position and character-path filters remain personal. Campaign/auth responses are not service-worker cached.
