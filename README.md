# Source Scraper for Obsidian

A general-purpose review client for [Source Scraper](https://github.com/ibbuilds/source-scraper). Collect or import versioned JSON, inspect entities and evidence, record separate agent recommendations, and prepare Markdown drafts for ChatGPT.

**This development integration never creates or changes user vault notes.** ChatGPT consumes its findings and uses the separate existing Obsidian connector to write only when the user explicitly orders it. A score, recommendation, run, import or staged candidate is not write permission.

The repository retains its original plugin identity, `source-scraper`. This branch extends the published 1.0.0 baseline; it is not a newly published release.

## What works

- A status-bar indicator immediately after ChatGPT, opening an anchored floating panel. No automatic sidebar or workspace tab.
- Bounded entity JSON/NDJSON v1 import and generic evidence browsing, including records without URLs.
- Optional explicit trusted CLI collection, export/import and human engine review; no automatic collection.
- A locally enabled provider exposing 15 namespaced tools through the existing Vault as MCP server and existing tunnel.
- Registered projects, bounded jobs/status/cancel, paginated findings, evidence fingerprints, separate agent assessments, persistent staged references and read-only Markdown previews.
- Source-independent project JSON inspection and note mapping. Remote project creation is limited to the external registered workspace.

There is no save-notes tool, write-permission toggle or create-notes button. Historical writer helpers are retained for compatibility tests but are not imported into the active plugin UI/provider bundle. The old embedded `x-feed-scraper` plugin and its data are not migrated or removed.

## Installation and configuration

Build this development checkout at `<vault>/.obsidian/plugins/source-scraper` with `npm ci`, `npm run check`, `npm test`, and `npm run build`, then enable Source Scraper in Obsidian. Preserve an existing engine checkout before reusing that directory. Import-only use needs neither the CLI nor MCP.

For MCP, use the reviewed provider-API build of the existing Vault as MCP host, locally enable provider ID `source-scraper`, and configure the trusted CLI digest, absolute Node executable, registered external workspace and project manifest digests in plugin settings. Do not place secrets in settings/manifests or commit local `data.json`.

See [MCP integration](docs/MCP-INTEGRATION.md) for exact tools, capabilities, limits, state, restart behavior and compatibility. See [User guide](docs/USER-GUIDE.md) and [Safety](docs/SAFETY.md) for the note ownership boundary.

Click **SS** in the status bar to inspect readiness, choose a registered project, explicitly collect/stop, or review candidates. **Import findings** also works offline. Candidate details and Markdown previews remain read-only. Escape, the close button or an outside click closes the floating panel; incoming MCP findings update the indicator without opening it. Existing saved Source Scraper sidebar leaves are removed on the next plugin load.

**Connect X locally** accepts masked `auth_token` and `ct0` values only in Obsidian. They stay in memory until disconnect/unload and never enter plugin preferences or MCP responses. Loading them prepares access but makes no X request. See the [test readiness plan](docs/TEST-READINESS-PLAN.md) for acceptance gates and the outstanding real-feed test.

## Verification and boundaries

Run `npm run check`, `npm test`, and `npm run build`. The real-engine provider harness is `node --experimental-strip-types scripts/verify-mcp-provider.mjs /absolute/path/source-scraper.mjs`. It uses synthetic data and simulated recommendations, and creates no candidate notes. The real public npm source and a running Obsidian instance require separate live acceptance evidence.

The current provider admits json-file, json-snapshot, rss, public-json, public-product and locally registered x-for-you-local projects. The optional [X feed setup](docs/X-FEED.md) requires a local read grant and an engine advertising `x-for-you-local-v1`; actual personalized feed access is unverified. Executable/custom adapters remain unavailable through this remote provider. Entity-v1 import compatibility is preserved; the provider also requires the agent-assessment and selected-export CLI capabilities.

The MCP endpoint can advertise new tools while an already open ChatGPT/Codex session retains an older inventory. Refresh/reconnect the existing connector to discover them. No new tunnel or second server is required.

MIT license. Historical release documentation describes historical behavior; this branch's read-only vault boundary is authoritative for this integration.
