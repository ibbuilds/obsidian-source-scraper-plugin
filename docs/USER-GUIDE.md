# Source Scraper review workflow

Source Scraper collects evidence and presents candidates. ChatGPT decides how to use them. Only ChatGPT, through the separate existing Obsidian connector and on the user's explicit instruction, creates or changes vault notes. Source Scraper never owns existing notes or their lifecycle.

## Import or collect

Open Source Scraper from the ribbon or command palette. Import a version-1 entities JSON/NDJSON export, or configure a trusted local CLI and explicitly run a project. Collection persists engine data and loads the candidate view. It does not write notes or invoke external output adapters.

Inspect an entity's original mentions, attributes, heuristic scores, human review and evaluator history. Agent recommendations are displayed separately in the evidence dialog when the matching provider/project is connected. Missing evidence remains missing; source license claims are not independent verification.

Use Project JSON editor to inspect, edit in memory and validate generic manifests. Existing vault project files can be read without alteration. New remotely requested manifests are created only in the registered external project workspace, never in user-content folders. Note mapping controls draft rendering, not automatic note creation.

## Use from ChatGPT

Ask ChatGPT to validate a registered project, start a bounded collection, inspect findings, and compare them with explicitly selected reference notes read through the existing Obsidian connector. The source_scraper tools can record recommendations with a rubric, reasons, evidence fingerprints and reference revisions. These are agent judgments, not human decisions.

Ask ChatGPT to stage selected findings. They appear in the review panel with their evidence. Staged references survive plugin restart; sources are not collected again automatically. If a manifest or binary changes, reverify and update its local trusted digest before running it.

For the optional account-personalized X source, see [X feed setup](X-FEED.md). The setup screen prepares a project outside the vault and does not collect. Local X reads remain disabled until the local read grant, Python runtime and private session setup are complete. Live personalized access must still be verified.

For selected entries, Preview selected drafts shows proposed paths and Markdown. It writes nothing, creates no save authorization token, and performs no note creation. The MCP preview tool likewise returns drafts and existing-path indicators only.

When ready, explicitly instruct ChatGPT to write the chosen content through the existing Obsidian connector. ChatGPT must respect that connector's permissions and the exact requested scope. Source Scraper does not invoke that connector, approve a write, or provide a save-notes tool. Existing notes remain under the user's control.

## Limits and recovery

Imports accept at most 5,000 entities/8 MB; tool queries accept at most 500 records per page; staged/draft selections accept 1–200 keys. Request smaller batches if a byte limit is reached. The engine runs one CLI command at a time; status and cancellation remain available while collection runs.

Repeated job request IDs return the existing job and reject changed parameters. Cancellation preserves previously committed engine pages. An interrupted job is reported after restart and is not restarted silently. Reprocessing is offline and does not change human reviews. Partial source failures remain visible in job results.

Disabling Source Scraper unregisters its tools and cancels its owned command; existing notes are unaffected. If the host lacks provider API version 1, basic JSON review still works and MCP compatibility is reported in settings. A cached ChatGPT tool inventory may need an existing-connector refresh after installation.
