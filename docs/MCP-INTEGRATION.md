# ChatGPT integration

Source Scraper produces findings, evidence, agent recommendations and optional Markdown drafts. It never creates or changes user vault notes. ChatGPT consumes those results and uses the separate existing Obsidian connector to write only when the user explicitly orders it. Source text, scores and recommendations are never write authorization.

## Components

- The existing Vault as MCP server owns the authenticated MCP endpoint and note ACLs.
- The existing tunnel carries MCP traffic. It is not replaced or extended into a second server.
- This plugin registers a trusted local provider through host provider API version 1. Tool names use the `source_scraper_` prefix.
- The engine is invoked through its public JSON CLI. The plugin does not open SQLite or import engine internals.
- Existing note read/create/edit tools remain a separate connector capability controlled by the user and ChatGPT.

## Local configuration

Install this development checkout at `<vault>/.obsidian/plugins/source-scraper`, build its root main.js, and enable it in Obsidian. Preserve any old engine checkout occupying that directory before installation. Do not install the legacy embedded collector over this client.

The MCP host must have the reviewed provider-API build and local `enabledToolProviders: ["source-scraper"]` configuration. Registration cannot be performed through a remote tool call. Upstream host releases without that API show an explicit compatibility diagnostic; they are not silently patched at runtime.

The exact host source patch, pinned upstream revision, checksum and build/rollback procedure are included in [Host provider API](HOST-PROVIDER-API.md). This makes the local extension reproducible without creating another repository or server.

Configure the plugin's trusted CLI path, its SHA-256, an absolute trusted Node executable, and an external project workspace. Configure `mcpProjectsJson` as an array of `{id, configPath, manifestHash}` objects. Hashes are SHA-256 of the actual file bytes. Editing a manifest or rebuilding the CLI requires locally verifying and updating the matching digest. Enable `mcpEnabled`. Do not store credentials in these settings or manifests. Local `data.json` is ignored by Git.

The CLI must advertise entity schema v1, `agent-assessments-v1`, and `selected-entity-export-v1`. Basic JSON import remains usable without the CLI or provider. The current MCP adapter admits json-file, json-snapshot, rss, public-json, public-product and locally registered x-for-you-local sources. X runs additionally require `x-for-you-local-v1` and the off-by-default local read grant; see [X setup](X-FEED.md). Stored X findings remain readable with the grant disabled. Remote project creation cannot register X/account sources or enable the grant. Executable/custom sources remain rejected. File-source paths must stay inside the workspace; project creation never writes inside the vault.

## Tools

The current inventory contains 28 tools. `src/mcp-provider.ts` exports the same definitions used by the runtime; regression tests check names, isolation and external-action annotations.

All names below have the `source_scraper_` prefix. Inputs reject unknown fields. Project IDs resolve through the local registry; no tool accepts a shell command, arbitrary executable, extension path or database path.

| Tool | Main input | Result/effect |
| --- | --- | --- |
| capabilities | none | Supported surface, limits, local availability; noteWritesSupported is always false |
| get_resources | projectId, optional search/review/evaluation/selectionId/offset/limit/filters | Compact stable resource page and outstanding review recovery |
| inspect_resources | projectId, keys (up to 50) | Retained evidence and current fingerprints in one call |
| review_resources | projectId, requestId, explicit changes or explicitly requested whole selection | Replay-safe human choices; up to 5,000 per transaction, zero likes/notes |
| assess_resources | projectId, items (up to 50) | Separate evidence-based AI records, never human approvals |
| research_packet | projectId, optional selectionId/offset/limit | Screened research batches, configured category policy, reference baseline and fingerprints |
| qualify_resources | projectId, items (up to 50) | Evidence-based category qualification, separate from human choices and AI recommendations; zero notes/likes |
| cycle_status | none | Saved X cycle progress, budget and waiting reason |
| control_cycle | projectId, action, optional maxPages | Start/resume, pause or stop the X connections only |
| resource_decision | projectId, key, action | Explicit human decision, rejection, restore or alias |
| list_rejected | projectId | Canonical persistent user rejections |
| assess_resource | projectId, key, assessment | Separate resource evaluation; verified X provenance required for likes |
| feedback_status | none | Like requests, confirmations, errors and local permission |
| control_feedback | enabled | Stop feedback, or enable it only with the separate local like permission |
| list_projects | none | Configured project IDs |
| validate_project | projectId | Structural validation without collection |
| create_project | manifest | Create-only project JSON outside the vault; no source execution |
| run_project | projectId, requestId, optional pageSize/maxPages/sourceIds | Engine job ID; no vault notes |
| get_run_status | jobId | State, available result, safe error/partial-result information |
| cancel_run | jobId | Cancel the owned current job; retain committed data |
| list_findings | projectId, optional limit/offset/search/type/minScore/filters | Globally filtered entity page in engine score/key order |
| inspect_finding | projectId, key | Evidence, existing reviews/history and fingerprint |
| reprocess_project | projectId, requestId | Explicit offline engine reassessment |
| record_ai_assessment | projectId, key, assessment | Separate agent record; no human review |
| list_assessments | projectId, key, optional limit/offset | Agent history and engine/reference freshness |
| stage_findings | projectId, keys | Existing review view populated; zero notes created |
| get_review_queue | projectId | Current data for persistent staged references |
| preview_selected_notes | projectId, keys, folder | Read-only Markdown drafts and existing-path indicators; no save token or write operation |

There is no `source_scraper_save_selected_notes` tool, write toggle or create-notes button. Only the existing Obsidian connector can perform the user's later requested write. The old standalone writer helpers remain covered by historical compatibility tests but are not imported into the active UI/provider bundle.

## State and errors

Engine SQLite remains authoritative for findings and histories. Lightweight provider state stores registered project references, job receipts and staged entity keys in private application state outside note folders. It is not a second findings database. Restart restores candidates without collecting sources. Interrupted jobs are reported; they are not restarted silently. Reusing a job request ID returns its existing receipt and rejects a changed request with the same ID.

Uncertain resource reviews retain their original request identity and input.
`get_resources` reports outstanding recovery; replay `review_resources` with that
projectId/requestId to reconcile it. Until reconciliation, new batch and individual
human decisions fail with `REVIEW_RECOVERY_REQUIRED`. A rejected request with a
definite validation error is terminal and does not block corrected new work.
The library exposes Retry operation and never invents a new identity for a retry.
Expired page selections refresh and discard stale checked rows. Failed queries
offer Retry loading without closing the library.

The optional locally enabled, user-configured feedback worker requires
`public-resource-evidence-v1` and `x-post-resource-urls-v1`. It runs without MCP or AI and reports its own
status through capabilities and feedback_status. Remote tools cannot enable
local checks, edit private feedback criteria, or grant like permission. Profiles are
configured in the local UI, with no built-in topics. The current profile fingerprint
is checked before queueing and again before dispatch. Local checks, human reviews
and AI recommendations remain different records. No tool name was removed.

Capabilities do not probe X. The legacy `xFeed.liveVerified: false` is accompanied
by `liveVerification: "not-probed"`; it is not a failed access check. Inspect a
successful collection result for live evidence. The evaluation owner is the user
or optional AI through MCP; no background model is installed.

Queries return at most 500 records; staged/draft selections accept 1–200 keys; imports/drafts are bounded to 8 MB. The CLI bridge caps stdout at 9 MB, uses fixed argument vectors without a shell, preserves UTF-8 chunk boundaries, serializes subprocess use and redacts stderr. Nonzero engine exits retain valid structured partial results. A busy engine operation does not prevent reading its local job status or requesting cancellation.

Agent inputs and serialized key selections through the provider are each limited to 12 KB of JSON; agent records accept at most 25 reference revisions. These budgets leave room for portable Windows subprocess argument encoding. The standalone engine's assessment-record input has its own 64 KB limit. Smaller batches or shorter rubrics preserve compatibility rather than attempting an oversized process launch.

Reference paths are checked through host note ACLs. The provider verifies supplied reference hashes against actual readable note content without saving full private note bodies into the engine. Changed or unavailable references mark recommendations stale. Such reads do not authorize writes.

## Verification

Run `npm run check`, `npm test`, and `npm run build`. Build the matching engine, then run `node --experimental-strip-types scripts/verify-mcp-provider.mjs /absolute/path/source-scraper.mjs`. This harness exercises actual collection, exact export, evidence, separate simulated recommendations, staging, denied unknown/write tools, read-only drafts and queue recovery in a synthetic vault. It creates zero candidate notes.

Host tests additionally verify authenticated HTTP tools/list and tools/call, namespacing, local enablement, class-instance dispatch, revocation and disposal. Live acceptance must distinguish a loopback MCP harness from a cloud ChatGPT connector session. An already open ChatGPT/Codex session can retain its old tool inventory: refresh/reconnect the existing connector to discover newly registered tools. A tools/list response proves server availability, not that a cached client has refreshed.

No real vault-note creation is part of development acceptance. Compare pre-existing user-content hashes after installation and keep backups/rollback data private. Do not run CI against the personal vault.


Generic deterministic filters use `collection-filters-v1`; see [the filter contract](COLLECTION-FILTERS.md). Project profiles and per-request filters combine with AND. The core owns matching and pagination; the plugin accepts only bounded declarative data, never code. Source selection cannot authorize an unregistered source. ChatGPT editorial quality is outside this feature.
