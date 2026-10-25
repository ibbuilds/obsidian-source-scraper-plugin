# Source Scraper for Obsidian

**Independent, general-purpose Obsidian Desktop client for [Source Scraper](https://github.com/ibbuilds/source-scraper).** Import versioned JSON, examine entities and provenance, preview Markdown and explicitly create new notes without changing existing files.

Source Scraper remains a separate JSON-first engine. This repository does not duplicate source adapters, SQLite, research/evaluation rules or any specific X/React/design workflow.

## Features implemented in 0.1.0

- Import `schemaVersion: 1`, `dataset: entities` JSON or NDJSON (paste or select a JSON file already inside your vault).
- Search and inspect generic source entities, including original evidence, review decisions, history and attributes; entries without URLs are valid.
- Select which records to export, inspect paths and generated Markdown before choosing **Create new notes only**.
- Use a user-chosen vault-relative folder. Reimports and manually edited notes are **never overwritten or deleted**. File collisions are reported.
- Optional explicit CLI integration: user configures the trusted local `source-scraper.mjs`, Node executable and project JSON, and clicks a confirmation to run. Import-only works without the separate Node CLI.
- No background collection, auto-approval, webhooks, external analytics or automatic vault writes.

**MVP scope:** note import/export is for **entity exports**. Other Source Scraper datasets and automatic synchronization may be added in later releases. Imported session data lives in memory; created Markdown notes persist normally in Obsidian. Review decisions can be saved only by an explicit human action through the configured matching Source Scraper CLI; the plugin never edits SQLite tables directly.

## Installation

**This repository is a plugin, not the Source Scraper CLI. It does not have to be installed unless you want an interface in Obsidian.**

After the CI-validated GitHub release is published, download `main.js`, `manifest.json` and `styles.css` from the **same** release tagged `0.1.0`. Place them in:

```text
<your-vault>/.obsidian/plugins/source-scraper/
    main.js
    manifest.json
    styles.css
```

Enable **Source Scraper** under Settings → Community plugins (manually installed plugin). Obsidian Desktop 1.9.2+ required. This plugin has **not** been submitted to or approved for the official Community directory, so do not expect it to appear in directory search.

The old optional `Discovery Engine` plugin with ID `x-feed-scraper` is not replaced or deleted. Its files and settings stay untouched.

## First run

1. Open **Source Scraper** from the ribbon icon or Command Palette → Open Source Scraper.
2. Use **Import JSON / NDJSON**. Paste the output of `source-scraper export` or choose an existing JSON/NDJSON file in the vault. This only loads a local preview.
3. Inspect the imported items and evidence. Select only records to convert to Markdown.
4. Press **Preview and create selected notes**, choose a specific vault folder (for example `Source Scraper/Imported`) and check the exact paths/content.
5. Press **Create new notes only**. Existing notes, including `References.md`, are not changed.

To create an export with the engine:

```sh
node source-scraper.mjs init --dir ./demo
node source-scraper.mjs run --config ./demo/project.json
node source-scraper.mjs export --config ./demo/project.json --out ./entities.json
```

Copy `entities.json` into your vault or paste its content into the plugin. Alternatively, configure the trusted local CLI in plugin Settings and explicitly use **Run local CLI (optional)**; no engine, background server, scripts or extensions are executed on Obsidian startup.

## Guarantees and limits

- No existing user note is automatically deleted, renamed, modified or overwritten. A path collision is skipped and reported.
- No `References.md` or `Sources.md` integration runs by default. Your original vault contents are not treated as plugin-owned.
- A human review imported from JSON remains an *engine-supplied value*. With a trusted CLI configured, the Inspect dialog can explicitly save a reasoned review to the matching engine project; local UI changes only after the engine confirms it. The plugin never edits SQLite directly.
- The plugin assumes Obsidian Desktop and Node built-ins available within Obsidian; the **external Source Scraper CLI** is entirely optional.
- Local JSON may contain sensitive data: review the preview before creating notes. Plugin settings contain only filesystem paths, not browser credentials.
- A real X For You personalized feed is **not** provided by this plugin. Source acquisition remains the responsibility of authorized Source Scraper adapters.

More: [User guide](docs/USER-GUIDE.md) · [Safety model](docs/SAFETY.md) · [Compatibility](docs/COMPATIBILITY.md) · [Migration plan](docs/IMPLEMENTATION-PLAN.md).

## Development and tests

```sh
npm ci
npm run check
npm test
npm run build
```

Cross-platform CI runs strict TypeScript, safety/unit tests and the bundled `main.js` build. Real Obsidian Desktop acceptance tests run in a synthetic isolated vault, including import, create-only output, attempted re-import and unchanged pre-existing notes.

## License

MIT, with original contributor credit for reused ideas. See [LICENSE](LICENSE).
