# Adventure notes

A shared documentation library, separate from trip-day logs and map markers. Open the document button beside the game log. The map toolbar keeps its established width; Help is now in Options.

## Reading and editing

Desktop uses a note list alongside the document. On phones, the vertical list opens into a full-screen note, with an All notes control to return. Guests see rendered text. Editors can create a titled note, switch between Write and Preview, save it, or remove it with confirmation. Removal participates in the existing Undo history.

Each note has `id`, `title`, `body`, `createdAt`, and `updatedAt`. The optional `session.adventureNotes` array shares the campaign's persistent storage, atomic revision checks, backups, and synchronization. Existing sessions can omit the field. Older clients that omit it during an update preserve the current library; an explicit empty array clears it. New expeditions and explicit session replacement reset the library along with other campaign content.

Unsaved title and body values participate in draft detection and recovery downloads. Authentication loss disables editing while retaining the draft. A newer remote revision cannot silently replace that draft. Clean notes update when shared content changes.

## Markdown

The local browser bundle uses [Marked](https://marked.js.org/using_advanced) and [DOMPurify](https://github.com/cure53/DOMPurify). It supports headings, emphasis, ordered and unordered lists, blockquotes, fenced code, GFM tables, and links. Raw HTML is rendered as literal text, and parsed HTML passes through an allowlist sanitizer. Executable elements, event handlers, inline styles, and DOM-clobbering identifiers are not accepted. Links allow absolute HTTP, HTTPS, and mailto destinations and isolate the opener.

Image syntax becomes descriptive links; opening a note does not fetch arbitrary third-party images. The existing Content Security Policy remains unchanged. The Markdown bundle contains only its two rendering dependencies and the entry point; the real-DOM test dependency is not shipped to browsers.

## Verification

Automated tests exercise schema bounds, real timestamps, CRUD authorization, old-client omission preservation, revision conflicts, Markdown injection attempts, guest controls, mobile list/detail transitions, title validation, dirty-draft recovery, auth expiry, undo/redo, session import/reset, and real-controller synchronization through the app.

Browser verification used an isolated local campaign. An editor created two notes, previewed headings/lists/quotes/tables/code/links, and saved them. A guest's already-open library received the notes automatically with no visible editing controls. Phone checks at 390×844 covered the list, rendered article, editor focus outlines, saving, sign-in/out, and both interface languages. A mobile edit appeared in the other open window. No browser errors were observed.

The local visual proof is `previews/campaign/adventure-notes-phone.jpg` (ignored by Git). Production verification is read-only; the sample notes remain local.
