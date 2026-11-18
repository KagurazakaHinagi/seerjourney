# Participant tags and character paths

Implemented in the separate campaign edition. No changes to the original SeerJourney app or existing live game days are required.

## Data and access

- `tripDays[].participants` is an optional array, limited to 32 nonempty names of at most 80 UTF-16 code units each. Names are normalized to NFC, trimmed, and have repeated whitespace collapsed. Matching is case-insensitive; duplicates retain the first display spelling. Control and formatting characters are rejected.
- Legacy entries without the field retain their shape. The authenticated update endpoint preserves existing tags when an older client omits the field for the same day ID. Sending `[]` explicitly clears the tags.
- Tags share the existing editor authorization, revision checks, synchronization, undo, and session backup boundaries. Guests have no tag input or removal buttons and cannot update the campaign API.
- Both editors include pending input in dirty-state checks and recovery downloads. Saving commits valid pending text. Authentication loss preserves drafts and disables editing.

## Route semantics

The selected character is a personal, in-memory view filter. Selection enables journey visibility without sending a campaign write. Search still finds place markers. The complete journey drives the explored counter.

Mapped days with the selected character become stops. Any recorded absence resets the connection, including notes-only entries and legacy entries without tags. Missing day numbers preserve the existing dashed connection behavior. Notes-only days with the character allow a connection between the surrounding mapped days. A historical final stop never becomes a false current camp.

## Verification

Automated coverage exercises normalization, invalid input, schema roundtrips, old-client preservation, editor-only writes, pending-input saves, IME handling, both dialog drafts, deferred startup, absence and numeric-gap semantics, safe name rendering, filter focus, live roster changes, correct camp pins, and guest app integration.

Local browser checks used a disposable five-day campaign with two initial characters, one recorded absence, and one missing calendar day. A guest's open log picked up a newly saved tag automatically. The editor added and removed tags in the full log and saved another tag from the map-stop dialog. The filtered SVG contained stops 0, 1, 3, and 5, a solid 0→1 segment, a dashed 3→5 segment, and no bridge across day 2. Clearing the filter restored all five stops. Guest controls remained read-only, and the campaign's explored count remained 9.

Phone checks at 390×844 confirmed wrapping tags, 44px add/remove/filter targets, unobscured input focus outlines, and a usable search sheet. Desktop checks confirmed keyboard focus survives filter rerendering. Local proof images are in ignored `previews/campaign/participant-tags-phone.jpg`, `participant-path-phone.jpg`, and `participant-path-desktop.jpg`.

The new search helper text uses Expedition Ink to maintain contrast over translucent glass. The design detector also reports 17 inherited warnings from the existing shell; its aggregate color checks do not identify the actual glass ancestor, and some older caption warnings may be real. They remain unsuppressed rather than applying a broad file-wide contrast exception during this feature change.

Production verification is read-only. Test names and logs remain in the isolated local fixture.
