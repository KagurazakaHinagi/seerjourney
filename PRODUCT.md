# SeerJourney

<!-- impeccable:product-schema 1 -->

## Platform

Web app, hosted on Vercel. Preserve phone/iPad Home Screen support and the existing map-first Liquid Glass design described in DESIGN.md.

## Purpose and audience

One public campaign map for players and the DM: show the selected campaign expedition, discoveries, markers, daily notes, and route. Guests arrive directly on the map without logging in. Editors unlock changes with an allowed passphrase. The reusable campaign edition uses independently supplied map mods.

## Confirmed behavior

- Ship only the original demo in the open-source repository. Select one external map during deployment, preserving its grid, fog, labels, and stable map identity. Keep maps and campaign data out of source history.
- Guests can pan, zoom, search, toggle the route, read marker notes and all game days, and export a session backup. Hide modification controls; enforce authorization at every server write endpoint.
- Editors can reveal/refog, add/edit/delete markers and game days, rename the campaign, and load/reset shared progress. Stored changes are public.
- Game days accept image attachments in both log editors. Compress images over 8 MiB before upload; preserve smaller originals. Store files in Vercel Blob and sync their verified references with daily notes. Guests can view images without modification controls.
- The Adventure notes feature provides a separate shared documentation library with titled Markdown notes. Use the game log's desktop list/detail layout and phone list-to-note navigation. Guests read rendered notes; editors create, edit, preview, and delete them. Keep the existing map toolbar dimensions by moving Help into Options.
- The Food & water page tracks one shared party inventory from game-day records: named food in lbs, fresh water in gals, and manually entered daily consumption. Food collected on Day 0 expires at the start of Day 7; water never expires. Consume the oldest unexpired food first, reject shortages, and preserve the same records in both log editors and the supplies page in Options. Guests can view historical balances; only editors change records.
- Public viewers refresh every five seconds while visible, thirty seconds in the background. Camera and route visibility remain browser-local.
- Store campaign state durably in Redis. Check revisions atomically; keep a local draft recoverable when a remote edit conflicts. No silent last-writer-wins replacement.
- Passphrase allowlist lives in server-only environment configuration. Use signed, HttpOnly, expiring cookies, origin checks, bounded JSON inputs, and persistent login rate limits. No passphrases in frontend assets or browser storage.
- Simplified Chinese is the initial interface language. Visitors may select English locally; map artwork retains its supplied language.
- The local development server uses an explicitly selected, persistent file store. Production must never fall back to process memory or filesystem storage.

## Design commitments

Inherit the SeerJourney nautical sigil, Canopy Green, Expedition Ink, Mist Glass, existing typography, and aligned controls. The map commands attention. Guest controls stay light; login, synchronization, conflicts, and lost connection must be understandable on phones and tablets.

## Operational details

README.md documents local startup, environment configuration, Vercel deployment, and validation. Public files are explicitly copied into dist/; server files, credentials, local sessions, development artifacts, and other map mods remain outside it.
