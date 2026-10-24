# User guide — general-purpose Obsidian import

## Concepts

Source Scraper **engine** collects information and exports structured JSON. This **plugin** reads the resulting JSON and optionally creates Obsidian Markdown notes. Both are independent. You can use this plugin without any connected X account, Node command or locally installed Source Scraper engine.

## Import data

1. Generate a `dataset: "entities"` export with `source-scraper export`. Version must be `schemaVersion:1`.
2. Open the **Source Scraper** view in Obsidian and click **Import JSON / NDJSON**.
3. Paste JSON in the modal, **or** choose an existing `.json`/`.ndjson` file already in your vault.
4. Click **Import without writing notes**. Read the record list and inspect evidence. No directory or note was created.

The importer enforces an **8 MB / 5,000-entity limit** per import, bounded nested fields and valid identity. For larger collections use `source-scraper export --offset ... --limit ...` to create smaller pages. It rejects unrelated `dataset: observations/alerts/changes` rather than fabricating an entity shape. It does not infer provenance absent from the source export. Entities without URLs are supported.

## Preview and create

1. Select the desired records using the per-row toggle. The view shows 40 per page and searches across title/key/type/category.
2. Click **Preview and create selected notes**, and enter a vault-relative folder such as `Source Scraper/Imported`.
3. Verify exact destination names and the first note content. A path is a stable hash of project ID and record key, preventing strange input text from becoming a filesystem path.
4. Click **Create new notes only**. At most 200 selected entities are written in a batch.
5. Existing files are **never** overwritten. If the same path is present, it is counted as a conflict. Personal edits always win.

Generated Markdown contains YAML frontmatter (project/identity/type/score/confidence/review), original structured attributes in indented JSON, and source provenance if supplied. A machine score never implies human approval. Licenses remain source claims, not independently verified.

## Optional Source Scraper CLI

If you installed the independent CLI (for example the standalone `source-scraper.mjs` release from the engine repo):

1. Set its **absolute local file path** under Plugin Settings → Trusted standalone Source Scraper CLI.
2. Set your trusted Node 22.16+ executable and explicit project JSON manifest path.
3. Click **Run local CLI (optional)**, review the warning (the configured project can contact its own sources or invoke configured trusted MCP extensions), and click **Run source collection and preview JSON**.
4. The plugin checks `source-scraper version`, runs the normal engine command, imports `export --format json` into memory and **does not write any vault notes until you explicitly confirm a create-only export**.

The bridge uses fixed argument arrays with `shell:false`, a timeout, cancellation and bounded output; no hidden downloads or external output adapters. Imported records in memory are cleared on Obsidian/app restart, while notes previously created remain.

## Recovery and coexistence

The old plugin `x-feed-scraper` may remain installed. The new plugin uses ID `source-scraper`, saves only its own settings and does not read/migrate `~/.x-feed-scraper` data or delete old files.

To stop using the new plugin, disable it. Its generated notes remain ordinary Markdown. Deleting the plugin directory is a **manual user action** and does not automatically remove notes.

Backup important vault material before any unrelated later migration; no automatic migration is part of this release.
