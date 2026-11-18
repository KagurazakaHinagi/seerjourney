# Shared food and water

`tripDays[].supplies` is optional for older sessions. A current daily record contains `foods: [{id, name, amount}]`, `water`, `foodConsumed`, and `waterConsumed`. Food amounts are in pounds; water is in gallons. Names are bounded to 100 characters and each day supports up to 100 food batches. Each quantity is bounded to 1,000,000 with up to three decimal places. Food batch IDs are unique across the campaign.

`src/shared/supplies-core.js` is shared by browser and server. It uses integer thousandths for exact accounting, processes days chronologically, adds the day's acquisitions before consumption, and consumes food FIFO. Food from day D expires at the start of D+7. Expired leftovers remain in the batch history but are excluded from available food. Water never expires. Future acquisitions cannot cover earlier shortages. Only recorded consumption is deducted.

The game log, tile day dialog, and Options → Food & water edit the same records. The supplies page can upsert a day without changing its other fields. It starts at the current campaign day and lets every viewer inspect historical balances. Editors alone see mutation controls; the server still enforces authentication, origin checks, revision comparison, and full-ledger validation. Editing or deleting an earlier acquisition cannot invalidate a later consumption silently.

Older clients that omit supplies preserve existing records. Explicit empty records clear them. Import normalizes missing supplies to empty records so session replacement is intentional. Undo explicitly clears supply fields when restoring a day that predates its first supply record, without changing unrelated legacy days. Unsaved supply fields join existing conflict protection, auth-loss recovery, and local draft downloads.

## Verification

Automated coverage includes exact decimal math, FIFO, Day 6/7 expiry, permanent water carryover, gaps, future exclusion, invalid quantities/IDs, retroactive edits/deletion, guest write rejection, legacy omission preservation, undo/redo, imports/resets, raw draft recovery, authentication loss, both day editors, supplies-page upserts, and refresh focus/text-selection stability.

Browser verification used an isolated local campaign, never production campaign content. An editor recorded Day 0 harvest and consumption, then a Day 1 with no harvest that consumed leftovers. A separate guest window updated automatically. Day 7 moved the Day 0 food into expired history while keeping water available. A later food batch appeared in both the inventory and game log. Phone checks at 390×844 verified stacked fields, visible focus rings, and no horizontal overflow; desktop checks at 1280×900 verified the two-column inventory/history view. Both languages rendered correctly, with no browser console errors.

Local screenshot: `previews/campaign/supplies-phone.jpg` (ignored by Git; illustrative local records). The existing design hook continues to report earlier contrast findings against inferred glass backgrounds; no new ignore rules were added. New surfaces reuse the game log's denser glass and text colors and were visually checked in both sizes.
