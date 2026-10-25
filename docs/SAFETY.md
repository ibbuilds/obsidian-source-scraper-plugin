# Safety and non-destructive contract

The user specifically required that existing material must never be deleted or broken. Treat the vault as someone else's protected workspace.

## What the initial plugin can write

- Only selected note paths after a **direct user click** on **Create new notes only**.
- Only Markdown files inside a user-entered vault-relative folder and validated project subfolder.
- New paths produced from a SHA-256 digest of project ID + entity identity.
- Settings JSON when the user explicitly changes plugin preferences.

The importer, detail/preview views, and `onload`/startup **do not write notes**. CLI source collection (if explicitly requested) runs independently and returns JSON; its normal `run`/`export` do not implicitly send Obsidian notes or webhooks.

## What the plugin must never do

- Call Vault API `modify`, `process`, `rename`, `delete`, `trash` or `append` on pre-existing vault notes.
- Overwrite a prior generated note even if it has the same key, unchanged content or a previous plugin-managed marker.
- Import the old `x-feed-scraper` ledger/ownership metadata and claim old notes as new-plugin-owned.
- Write directly to `References.md`, `Sources.md`, arbitrary user project notes or hidden `.obsidian` paths.
- Auto-download executable files, scrape authenticated X UI, or collect personal cookies/sessions.

## Input boundaries

Reject oversized files and arrays, invalid `schemaVersion`, incompatible datasets, project mismatch, repeated entity identity, dangerous JSON attribute names, unsafe/credential-bearing entity links and oversized/deep nested fields. Render Markdown-sensitive text as escaped text and attributes/evidence as indented JSON, not executable HTML or Obsidian embeds.

Path validation refuses `..`, leading slashes, backslash traversal, hidden directories and unbounded lengths. For local Desktop vault adapters the writer checks every ancestor for symlinks (including broken targets) before a create. Existing files cause a conflict, not an overwrite.

## Regression gates

Unit tests create a disposable filesystem vault, add sentinel `References.md` and unrelated personal notes, run writes and duplicate writes, then compare originals byte for byte. Symlink attacks, file/directory collisions, and Markdown injection are tested.

The actual Obsidian Desktop E2E suite uses a separate synthetic vault, imports entities, creates one selected note, manually edits it, retries the import and ensures the manual edit survives and original references remain unchanged.

**The real owner's Obsidian vault is NEVER a CI test target.** The earlier MCP-created `Source Scraper/Acceptance Test.md` remains an existing user note, not a file owned by this plugin.
