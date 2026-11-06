# Source Scraper for Obsidian

A general-purpose review client for [Source Scraper](https://github.com/ibbuilds/source-scraper). Collect or import versioned JSON, inspect entities and evidence, record separate agent recommendations, and prepare Markdown drafts for ChatGPT.

**This development integration never creates or changes user vault notes.** ChatGPT consumes its findings and uses the separate existing Obsidian connector to write only when the user explicitly orders it. A score, recommendation, run, import or staged candidate is not write permission.

The repository retains its original plugin identity, `source-scraper`. This branch extends the published 1.0.0 baseline; it is not a newly published release.

## What works

- A status-bar indicator immediately after ChatGPT, opening an anchored floating panel. No automatic sidebar or workspace tab.
- Bounded entity JSON/NDJSON v1 import and generic evidence browsing, including records without URLs.
- Optional explicit trusted CLI collection, export/import and human engine review; no automatic collection.
- A locally enabled provider exposing 26 namespaced tools through the existing Vault as MCP server and existing tunnel.
- Registered projects, bounded jobs/status/cancel, paginated findings, evidence fingerprints, separate agent assessments, persistent staged references and read-only Markdown previews.
- Source-independent project JSON inspection and note mapping. Remote project creation is limited to the external registered workspace.
- Optional local UI feedback without AI: bounded continuous X windows, public resource evidence, separate local check records and guarded likes. Structural policy checks do not certify aesthetics; unsupported evidence stays pending. See [background feedback](docs/AUTONOMOUS-FEED.md).

There is no save-notes tool, write-permission toggle or create-notes button. Historical writer helpers are retained for compatibility tests but are not imported into the active plugin UI/provider bundle. The old embedded `x-feed-scraper` plugin and its data are not migrated or removed.

## Installation and configuration

Build this development checkout at `<vault>/.obsidian/plugins/source-scraper` with `npm ci`, `npm run check`, `npm test`, and `npm run build`, then enable Source Scraper in Obsidian. Preserve an existing engine checkout before reusing that directory. Import-only use needs neither the CLI nor MCP.

For MCP, use the reviewed provider-API build of the existing Vault as MCP host, locally enable provider ID `source-scraper`, and configure the trusted CLI digest, absolute Node executable, registered external workspace and project manifest digests in plugin settings. Do not place secrets in settings/manifests or commit local `data.json`.

See [MCP integration](docs/MCP-INTEGRATION.md) for exact tools, capabilities, limits, state, restart behavior and compatibility. See [User guide](docs/USER-GUIDE.md) and [Safety](docs/SAFETY.md) for the note ownership boundary.

Click **Source Scraper** in the status bar. Its compact native popover follows the selected source project and shows its readiness and collection action. Generic sources do not require X. **Resources** opens the selectable list; titles open links and separate information buttons load evidence, then **Preview drafts** for a preview. The settings icon opens **Options**, including JSON import, other sources and advanced tools. All controls, typography and colours follow Obsidian's active theme. Initial findings are clearly labeled as examples; loading a session never claims verified X access. See the [user guide](docs/USER-GUIDE.md) for the complete workflow.

## Verification and boundaries

Run `npm run check`, `npm test`, and `npm run build`. The real-engine provider harness is `node --experimental-strip-types scripts/verify-mcp-provider.mjs /absolute/path/source-scraper.mjs`. It uses synthetic data and simulated recommendations, and creates no candidate notes. The real public npm source and a running Obsidian instance require separate live acceptance evidence.

The current provider admits json-file, json-snapshot, rss, public-json, public-product and locally registered x-for-you-local projects. The optional [X feed setup](docs/X-FEED.md) requires a local read grant and an engine advertising `x-for-you-local-v1`. Bounded authenticated reads have [recorded live acceptance](https://github.com/ibbuilds/source-scraper/blob/main/docs/x-local-acceptance.md); each account/session still needs its own successful run. Custom adapters run locally through the engine SDK and export JSON for plugin import; remote tools never load arbitrary executable adapters. See [adapter boundaries](docs/ADAPTER-BOUNDARIES.md). Entity-v1 import compatibility is preserved; the provider also requires the agent-assessment and selected-export CLI capabilities.

The MCP endpoint can advertise new tools while an already open ChatGPT/Codex session retains an older inventory. Refresh/reconnect the existing connector to discover them. No new tunnel or second server is required.

MIT license. Historical release documentation describes historical behavior; this branch's read-only vault boundary is authoritative for this integration.
