# Resource library

Source Scraper finds links that match the configured source filters. Matching is
retrieval evidence, not a quality verdict. Users can browse, open and copy these
links without approving anything or using AI.

The default All resources view shows titles, useful descriptions, source domains
and reported access/license information. The title opens the resource directly;
the information button loads its full retained evidence only when requested.
Missing access conditions are labelled Access not checked. Matching scores never
stand in for editorial quality.

Check the concrete resources to Copy links, Keep or Hide. With no selection there
is no review action. Select page is an explicit convenience for the visible page;
it never chooses the rest of the catalogue. Selection persists across pages of
the same query and clears when the view or search changes. Kept is a personal
shortlist, not a certification of quality. Hidden removes a resource and future
canonical duplicates; choose Hidden, select the link and Restore to undo it.
Keeping alone never queues a like or writes a note. Preview drafts is optional
and supports up to 200 selected resources.

The UI renders only 40 rows. A chosen set is submitted in one replay-safe request,
up to 5,000 resources per transaction. Every selected row carries its revision;
changed resources are reported instead of overwritten. Recovery retains the
request identity and never repeats confirmed decisions. This operation bound
is not an inventory limit. Existing imported-result comparison remains available.

## Optional AI workflow

Start with get_resources(projectId, review?, evaluation?, search?, filters?).
The response has total, selectionId and compact records. Reuse selectionId and
offset to page the same selection. Each resource includes any saved AI
recommendation separately from its human review. For actual evidence, call
inspect_resources(projectId, keys) with up to 50 keys. Record the current
fingerprint and independently verify utility, reuse, usable output and free
access before assess_resources(projectId, items). One call accepts up to 50
separate evidence-based evaluations. It does not invent human approvals.

On explicit user instruction, review_resources normally accepts requestId and
changes listing each chosen resource. The compatible selectionId + decision
form is reserved for an explicit instruction about that entire result set; an
agent must never infer it from filter relevance. Reuse the same requestId
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

Automatic resource assessments are scoped to the registered project and current
manifest/feedback profile. Changing criteria makes prior automatic assessments
inactive; their history and explicit human choices are retained. After inspecting,
supply each record's `assessmentProfileHash` as `assessment.profileHash` when using
`assess_resource` or `assess_resources`. Missing or stale hashes are rejected.
