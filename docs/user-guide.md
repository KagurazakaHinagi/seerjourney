# Using SeerJourney

Guests can browse without signing in. Editors unlock changes in Options using a campaign passphrase.

This guide uses English interface labels. Select **English** under **Options → Language** to match them.

## Game-log images

Editors can attach up to 12 JPEG, PNG, WebP, or GIF images per day, from either the full game log or a tile's day dialog. Choose the image button, wait for the previews, then save the day. Guests can view the saved thumbnails and open full images, but cannot upload or remove them.

Images over 8 MiB (8,388,608 bytes) are compressed in the browser before upload. Large images are resized to a maximum edge of 4096 pixels and encoded as WebP, with JPEG fallback, reducing quality and dimensions further if necessary to meet the limit. Large animated images become a still frame. Images already within the limit keep their original bytes. Inputs are limited to 100 MiB and 100 megapixels; unsupported or undecodable images are rejected with an explanation.

Production uploads go directly to public Vercel Blob storage using short-lived, editor-authorized upload URLs restricted to the campaign path, image type, and 8 MiB size limit. The server verifies the stored object before accepting its reference in a log. Campaign synchronization and session backups contain image references, not embedded image bytes. Removing an attachment or day leaves the stored file available for undo and existing backups. Treat attachments as public campaign content. Local development stores images beside the campaign file in an `images/` directory.

## Participants and character paths

Both day editors include participant tags. Editors can type a name and press Enter or tap the add button, reuse a suggested name, and remove tags with their close buttons. Saving the day also adds a name still in the input. Each day supports up to 32 names of 80 characters; whitespace and Unicode normalization prevent accidental duplicates, and matching ignores letter case. Tags sync with the campaign, remain in session backups, and are read-only for guests.

Search accepts character names alongside notes and places. Choose a name under **Character paths** to show only their mapped days, or **Whole journey** to clear the filter. This filter belongs to the current viewer and resets on reload. The overall explored tally still describes the whole campaign.

A recorded day without the selected character breaks their route, including a day without a map location. Unrecorded day-number gaps still use dashed lines. An older log with no participant tags counts as an unrecorded participant list; add tags to those days to include them in a character's route. A character's last stop displays the camp icon only if it is also the campaign's current mapped camp. See [participant verification](participants.md).

## Adventure notes

The document button beside the game log opens **Adventure notes**, a shared documentation library. On phones, select a title in the vertical list to open its note and use Back to return. Editors can create notes with a title and Markdown body, switch between writing and previewing, save changes, and delete notes. Guests see rendered notes with no editing controls. Help is available in the Options menu.

Notes support headings, emphasis, lists, blockquotes, code blocks, tables, and links. Raw HTML is displayed as text; generated HTML is sanitized. Markdown image references become links rather than embedded images. External links open separately. Names and authored content are not translated; controls support English and Simplified Chinese.

Notes use the campaign's shared synchronization, authorization, revision conflicts, undo history, and session backups. Unsaved title/body edits remain recoverable if access expires or another editor saves. Older clients that omit the note library cannot erase it. Each campaign supports up to 200 notes, each with a title of 1–160 characters and a body of up to 50,000 characters, subject to the existing 2 MiB campaign request limit.

## Food and water

Open **Options → Food & water** for the shared party inventory, or record supplies in either game-day editor. Add each food's name and weight in pounds, fresh water found in gallons, and how much the party consumed that day. Quantities support up to three decimal places. The supplies page can also create a game day or update its supplies while preserving notes, participants, images, and map location.

Food lasts **seven game days including collection day**: Day 0 food is usable through Day 6 and expires at the start of Day 7. Water does not expire. Daily consumption draws from the oldest unexpired food first, including earlier leftovers when nothing was found that day. Expired food remains visible separately and cannot be consumed. Days with no consumption record do not consume supplies automatically.

The page opens at the campaign's current day and can show remaining stock after any selected day's recorded consumption. Each food batch shows its remaining weight, collection day, and expiry day. Historical corrections, day renumbering, and deletion recalculate the inventory; changes that leave a later day consuming unavailable supplies are rejected with the affected day and quantity.

Guests can view the inventory and daily records. Editors can save changes, which synchronize with the public campaign and participate in undo, backups, conflict handling, and draft recovery. Older clients omitting supplies preserve them; intentionally importing an older session clears its supply records. See [supplies verification](supplies.md).


## Map controls and saves

Explore pans the map and opens existing markers. Marker creates a location bookmark. Log records one or more days at a tile; multiple days can share a location. Reveal is a batch reveal/refog brush. Search finds markers, notes, and characters; the campaign name field also updates the map title.

The route follows day numbers. Unrecorded day gaps are dashed; character filters break at a recorded absence. The latest mapped day uses a camp marker. The day in the header is the highest recorded day plus one.

Options → Save session downloads progress as JSON. Editors can use Load session to replace shared progress with a compatible map session. This does not import or switch map artwork. Backups contain image references, so preserve the image store separately.
