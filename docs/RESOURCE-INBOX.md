# Resource inbox

The local workflow does not require AI. Open Resources, filter the inbox and use
Approve N or Reject N. The count explicitly names the scope: all matching
resources, or the checked resources across pages. No selection or comparison
dialog is needed for the normal action. The inbox renders 40 rows and queries
only the requested page. Pagination reuses a stable selection rather than
rescanning the catalogue. Needs review is the default view. Approved resources
can be marked Pending; the Rejected view has Restore.

A submitted action affects the captured selection, never later matches. Resources
changed since that selection are reported separately. Actions support up to
5,000 resources per transaction; a larger result must be narrowed or explicitly
selected. This is an operation budget, not a 5,000-resource inventory limit.
Review writes use one engine process and one transaction instead of repeated
inspect/review/inspect processes. Persistent request receipts and the local
journal reconcile an interrupted commit without duplicating history. Ledger
updates are coalesced into one private-file write. Human rejections always win.

Opening a title retains the detailed manual review and original evidence. Copy
page links states its scope; checking rows changes this to the selected links.
Preview drafts remains a copy-only operation, with a 200-draft output bound.
Reviewing and approving resources never sends likes or writes vault notes.

## Optional AI workflow

Start with get_resources(projectId, review?, evaluation?, search?, filters?).
The response has total, selectionId and compact records. Reuse selectionId and
offset to page the same selection. Each resource includes any saved AI
recommendation separately from its human review. For actual evidence, call
inspect_resources(projectId, keys) with up to 50 keys. Record the current
fingerprint and independently verify utility, reuse, usable output and free
access before assess_resources(projectId, items). One call accepts up to 50
separate evidence-based evaluations. It does not invent human approvals.

Only on explicit user instruction, review_resources accepts requestId with
selectionId + decision, or changes for mixed decisions. Reuse the same requestId
and arguments after an uncertain result. A new requestId is a new decision.
Refreshing after new evidence or preference changes creates a current selection;
an old selection fails safely. A request receipt reports saved and failed counts
and individual errors; it never claims that failed or stale resources were saved.
Existing individual tools remain available for compatibility.

No extra model, paid X API, second MCP server or note writer is added. The new
inbox requires the resource-batch-v1 engine capability. Upgrade the tested engine
and Obsidian plugin together, preserving project manifests, sessions and reviews.

## Performance evidence

A Windows/Node 24.15 synthetic offline catalogue of 5,000 resources measured three
20-review samples: the previous three-process path took 6,791 / 6,619 / 6,710 ms;
the single-process batch took 120 / 119 / 115 ms. Initial 40-row queries took
214 / 220 / 218 ms; next-page reads 108 / 108 / 113 ms. The engine-only 5,000-review
sample took 371 ms. The corpus has short metadata and no attached post history;
these figures do not measure X, network latency, an AI model or all UI/ledger
work. Reproduce with the engine scripts/bench-resource-workflow.mjs script.

If a review outcome remains uncertain, the inbox shows Retry operation and temporarily disables further decisions. Reconciliation reuses its durable request ID. A restart also tries each unresolved operation once.
