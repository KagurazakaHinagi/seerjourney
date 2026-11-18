# Local deployment

## Requirements

- Node.js 26.x and npm. With nvm: `nvm install` then `nvm use`.
- A browser with JavaScript enabled. Safari, Chromium, and Firefox can use the app; Home Screen installation requires a supported mobile browser.
- No database or cloud account for the local file-store mode.
- Optional Python 3 + Pillow for generating map tiles or app icons. Python is not required to run the app.

Run commands from the project root. Do not use `file://` or a generic static file server: the application needs its API.

## 1. Install and configure

```sh
npm ci
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Only copy `.env.example` on a new checkout. Put the generated random value into `SESSION_SECRET`. Set a private passphrase allowlist as a JSON array:

```dotenv
CAMPAIGN_STORE=file
CAMPAIGN_ID=my-campaign
CAMPAIGN_PASSPHRASES='["replace-with-a-long-private-phrase"]'
SESSION_SECRET=replace-with-your-generated-secret
```

Each phrase must contain 8–512 characters. The secret must contain at least 32 bytes. Do not commit this file. These values are used on the server, never in client JavaScript. See [configuration](configuration.md) for all settings.

## 2. Choose a map

The original geometric demo in `examples/demo-map/` lets a fresh checkout run without external artwork. To use your own map, keep its folder **outside the repository**:

```text
work/
  SeerJourney/                  # source checkout
  campaign-maps/
    my-map/
      map.json
      background.png
      fog.png                  # optional
      tags/                    # optional
      tiles/manifest.json      # optional, recommended for large rasters
```

Stage the map's deployment files, then start the server:

```sh
npm run map:stage -- /absolute/path/to/campaign-maps/my-map
npm run dev
```

The stage operation creates ignored `.campaign-map/` using the manifest's asset allowlist. It is a generated deployment copy, not the canonical source. Unknown files, extraction reports, portable archives, and source images not referenced by the manifest are not copied. Re-stage after editing the external map. For configuration-based selection, set `CAMPAIGN_MAP_DIR` to its absolute directory in `.env`; see [map deployment](map-deployment.md).

**A session is not a map mod.** Options → Load session restores progress after the matching map has been selected at deployment. A portable `.seerjourney-mod.json` contains map assets and metadata, not campaign logs. This single-campaign edition does not expose a map-switcher to guests. See the separate [mod format](map-mod-format.md) and preparation skill for making a compatible mod.

## 3. Open and verify

Open [http://localhost:8780](http://localhost:8780). `npm run dev` builds the static files before starting, so restart it after changing source or replacing a map. Set `PORT` in `.env` to change the port. The listener binds to `127.0.0.1`; it is intended for this computer, not public LAN hosting.

1. Confirm the expected map and initial fog are visible.
2. Open Options and sign in with one configured phrase.
3. Add a day, participant, and optional image; save the entry.
4. Open a private browser window as a guest. Confirm the saved entry appears and editing controls are unavailable.
5. Restart the server. Confirm the entry persists.

Use a disposable campaign data file for experiments, not your live campaign backup. The local server reads `.env`; `npm test` uses isolated synthetic fixtures and does not alter your campaign.

## Persistence and backups

The default file is `.data/campaign.json`. Uploaded images and their metadata are kept in an `images/` folder beside it. `CAMPAIGN_DATA_FILE=/absolute/path/to/campaign.json` can move both outside the checkout. The file adapter's location, not `CAMPAIGN_ID`, selects the local save file; use different paths for independent local campaigns.

Stop the server before copying its data folder for a consistent filesystem backup. Also keep the matching external map folder. The in-app Save session action exports session JSON with image references; it does **not** include image bytes or map artwork. A session exported from local mode will refer to local image API URLs. Moving those attachments to a cloud deployment requires a separate image migration or re-upload, not just Load session.

Deleting an attachment from a log does not immediately delete its stored bytes, allowing existing backups and undo to retain references. Plan image-store retention separately. Never commit `.data/`, `.env`, or campaign exports.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Editing unavailable / 503 | Valid passphrase JSON and secret, `CAMPAIGN_STORE=file`, writable data directory. |
| Wrong map after staging | A configured `CAMPAIGN_MAP_DIR` takes precedence; update it or remove it, then restart. |
| Map fails to load | Valid `map.json`, all referenced rasters present, valid optional tile manifest; inspect server error before changing progress. |
| Existing progress belongs to another map | Restore the intended map or choose a separate data file. Do not relabel the old map ID to bypass validation. |
| Images fail | Supported JPEG/PNG/WebP/GIF, decodable input, writable sibling `images/`; wait for uploads before saving. Images above 8 MiB are compressed before upload. |
| Port already in use | Stop the previous server or set another `PORT`. |
| Cached UI after an update | Close and reopen the app; if needed reload the page. Keep campaign backups before clearing any browser data. |

The file store intentionally refuses `NODE_ENV=production` and Vercel environments. For an internet-facing deployment use the [Vercel/Redis guide](vercel-deployment.md), or adapt and operate a production server with durable storage yourself.
