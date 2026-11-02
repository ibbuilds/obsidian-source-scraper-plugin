# Status-bar interface and testing readiness

The supplied ChatGPT connection screenshots define the interaction: Source Scraper sits immediately after ChatGPT in the status bar and opens an anchored, non-modal popover on click. No automatic side pane, collection or note writing.

Design brief: domain = provenance, candidate queue, local collection, X session, quality review, explicit selection. Colors come from Obsidian's editor surface, raised surface, soft separators, muted labels, violet action accent, green verified checks and warning/error states. The signature is the status indicator → source readiness → candidate review loop beside the existing MCP indicators. Avoid a sidebar, a full dashboard and raw configuration as the first screen.

Intent: inspect source readiness and review resources without losing the current note. Hierarchy: one current-state heading, four diagnostic rows, project choice, then collection/review actions. Palette/type: native Obsidian semantic tokens and interface font. Depth: one raised surface with a quiet border/shadow. Density: 4px rhythm, 16px panel padding, readable labels and explicit keyboard focus.

1. Replace sidebar entry with accessible status item and anchored popover; preserve command compatibility and migrate only existing Source Scraper leaves. Gate: nothing opens on startup or queue restoration.
2. Reuse candidate import, selection, evidence and draft preview inside the floating panel. Gate: current note/layout and user-file hashes remain unchanged.
3. Provide masked in-memory X session setup; secrets never enter preferences, state receipts, notes or logs. Local session loading does not collect. Gate: disabled grant strips credentials; restart/unload drops in-memory values.
4. Keep job state honest; explicit run/stop, no double submission, source errors visible, and no false X-ready claim while session/live acceptance is missing.
5. Exercise status ordering, click/toggle, keyboard/focus, outside click, resize, long candidates, light/dark appearance, restoration, run/review/drafts and zero-note mutation in isolated Desktop acceptance. Capture actual app screenshots for visual review, then merge passing changes and install only plugin-owned files.
6. Remaining live gate: owner connects X locally, reads a small real For You sample, verifies account/provenance and evaluates actual candidate quality. UI/fixture success does not claim this gate or guarantee 100% availability of an unofficial X client.
