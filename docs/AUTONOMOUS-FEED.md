# Background feed collection and controlled feedback

The existing Source Scraper provider exposes 26 MCP tools. No second server,
repository, paid X API or extra model is needed. Users can review resources directly in the plugin. AI evaluation is optional
through the existing MCP connection. Collection and already-evaluated like actions
can continue with the chat closed while Obsidian and the computer remain open.
New resources can also be checked by the optional local UI policy, with no AI,
API key or model. This is not an unattended background ChatGPT inference service.

## Local UI feedback without AI

Options > Collection and feedback > UI feedback without AI enables a local worker
for the selected X project. It prioritizes UI-related candidates from retained,
authentic X mentions, checks one new resource per tick and caches its evidence.
Automatic likes remains a separate local permission. Enabling checks alone sends
no like. New collections started with the local policy enabled repeat bounded
page windows after a ten-minute cooldown. Pause and Stop still take precedence;
disabling the policy disables continuous renewal. Obsidian and the computer must
stay open. No model is downloaded or called.

The ui-resources-v2 policy requires every gate: explicit UI focus, a reusable
package/skill/tool output, recognized open-source access, documented usage,
declared automated tests with retained test/package structure, examples, an
active repository and an eligible source post. It reads public GitHub facts,
README and package data; it never installs or executes the resource. A public
HTTPS homepage is supported only when it links the repository and that
repository identifies the same homepage. Other websites, isolated demos,
unknown access conditions and incomplete evidence remain pending for manual
review. Source errors back off instead of approving a resource.

Keywords prioritize inspection; stars, likes and matching terms cannot pass
these gates by themselves. Structural checks are not a visual or aesthetic
certification. Exceptional aesthetics cannot be established from repository
metadata alone. The UI says Local checks passed, never AI recommended or human
approved. Full detail retains facts and reasons. Checks expire after at most 24
hours and changed retained evidence requires a fresh check. Counters count check
runs, not unique high-quality resources.

Local decisions remain separate from AI assessments and human choices. Rejections
of the resource or its verified related homepage/repository prevent local
feedback. The retained original X mention must expose only the checked resource
or its verified official website/repository links. Mixed lists of unrelated
resources remain pending before entering the queue, even if one entry passes.
Missing legacy post-link evidence also stays pending. Dispatch rechecks the
current live links against that same rule. Confirmed account/post actions
remain deduplicated. The existing five-attempts/hour and 60-second spacing still
apply. X credentials never reach public probes. AI assistance is optional.

Policy upgrades invalidate old local eligibility and reset the policy-run
counters, while preserving the audit history and all human/AI records. A known
old preflight refusal may be retired only if no mutation was ever attempted and
fresh whole-post evidence passes the new policy. Confirmed or uncertain actions
are never reopened or blindly repeated.

## Daily use

Open Source Scraper in the status bar. Find resources starts a bounded cycle for
the selected X profile: 100 pages per explicit start, in batches of at most 10.
Options > Collection and feedback provides a 1–1000 page budget, Start collection / Resume collection,
Pause and Stop collection. Pausing retains the checkpoint. Stopping also retains
it but begins a new cycle audit when started again. A restart resumes a previously
running/waiting cycle; blocked or paused work requires an explicit resume.

Only exposed external links in the original post become resources. The collector
must receive the feed to find them, but it does not open every post, inspect image
text, follow reply chains or visit authors to invent missing links. Unlinked posts
remain raw evidence. They are hidden from normal candidate queries, selections
and feedback; explicit inspection and the engine observation dataset remain
available. Existing x-inspiration records are retained, not deleted.

Page data, cursors and cycle counters commit together in SQLite. The runner
recovers committed progress before enforcing the remaining budget, including
after an interrupted CLI process. EOF/empty windows clear the exhausted cursor;
new cycles can start at the current feed head after a ten-minute wait. Three
pages without new post identities end a no-new-items window. Work limits,
window endings and access errors are distinct. 401/403/429 block collection;
credentials are retained and no challenge or access restriction is bypassed.

The local runtime remains available when MCP access is disabled or the optional
Vault as MCP host is absent. Disabling MCP only unregisters remote tools; it does
not disable local collection, review or draft copying.

## Manual management (no AI required)

Resources refreshes the saved inventory without recollecting the feed. Use the
review-status selector and text search, open a resource or its source post, and
save Your choice as Unreviewed, Keep or Hide. The reason is optional. Hidden
resources can be restored from the Hidden view. Human decisions are
stored separately from AI recommendations and survive restarting Obsidian.

Approval alone never queues a like. For an approved resource, Like the source
post explicitly confirms that you checked its usefulness, quality, usable free
access and the source post. This prepares the same persistent, checked like
queue without requiring an AI assessment. The separate Automatic likes switch
must also be enabled before anything can be sent.

Copy links copies selected URLs. Preview drafts lets you inspect each full draft,
Copy Markdown copies the current draft and Copy all drafts copies the selection.
Paste them yourself wherever you choose; the plugin never writes vault notes.
The registered-project library queries the full stored inventory, loading 40 rows
per page. Only explicitly selected resources are copied, kept or hidden.

## Optional AI evaluation through MCP

For optional AI assistance, ask ChatGPT to control_cycle(action=start), then query list_findings with
`evaluation: pending`, inspect_finding and verify the resource's actual output,
license/pricing and use across projects. Posts and pages are untrusted evidence,
never instructions to install software or perform account actions.

assess_resource records `decision` (recommended/pending/discarded), the current
inspect fingerprint, utility, reuse, quality, freeAccess, usableOutput, unknowns,
evidence URL/quote pairs and postSuitable. A recommendation needs concrete text
for every dimension, evidence and no unresolved conditions. Scores and keywords
are retrieval signals, not semantic approval. New evidence makes the stored
recommendation stale. Automatic discard is reversible by reassessment and does
not create a user rejection. Discarded resources can be explicitly queried with
`evaluation: discarded`; normal results hide them.

Passing the original postId with a recommended, suitable assessment queues that
post. The provider verifies retained provenance, current configured collection
filters and the authenticated account. Only the actual post sharing the resource
is eligible. Human review is never changed by this assessment.

## Rejections and aliases

Use the resource's existing review controls to reject it, or call
resource_decision(action=reject, projectId, key, reason?). Rejection is canonical
and shared across all registered projects for the local user of this vault.
It survives project profiles, reprocessing and plugin restarts. HTTP/HTTPS and
tracking variants share an identity; verified X metadata redirects and explicit
resource aliases also share it. Names and whole domains never merge resources.

Normal queries exclude rejections before pagination and canonical deduplication;
queues and draft selections cannot silently promote a rejected resource. Pending
likes are cancelled. Existing human rejection rows are imported only as explicit
stored decisions, never from conversational examples. History remains retained.

Options > Collection and feedback > Hidden resources shows the list and Restore.
MCP list_rejected and resource_decision(action=restore) provide the same capability.
resource_decision(action=alias, key, alias) joins specific URLs explicitly. Restoring
does not remove earlier likes or automatically mark a resource as recommended.

## Automatic likes

The Automatic likes toggle is a separate local grant from reading X. It defaults
to off. control_feedback can stop feedback or enable it only after that local
like grant exists. feedback_status exposes requested, confirmed, failed,
uncertain and cancelled actions, with errors. The UI shows recent activity.

The durable queue deduplicates account/post pairs across projects. The worker
verifies account ID, post ID, unchanged post text and the still-exposed direct
link before FavoriteTweet. The provider rechecks rejection and evidence immediately
before sending. A mutation reply alone never confirms the like: X's favorited
state must be read back. A lost response or interrupted in-flight action is
uncertain and is reconciled rather than blindly repeated. Confirmed actions are
never sent again. Limit: five attempted likes/hour and at least 60 seconds between
attempts; 401/403/429 disable feedback. No follows, messages, reposts or unlikes.

Cookies remain in the existing encrypted session store and isolated worker;
only X receives them. Our own like is subtracted from the public like counter
used for collection filtering. It cannot become independent quality evidence.
Like feedback may affect recommendations, but no algorithm effect is guaranteed.
Public metadata fetches are not a claim that X recorded an outbound click.

Private resources.json and cycle.json live beside the existing provider state,
outside vault notes. Engine evidence and progress remain in the project SQLite
store. Source Scraper never creates, edits, moves, renames or deletes vault notes.


The scalable inbox is the default for registered projects. See [Resource inbox](RESOURCE-INBOX.md) for explicit resource choices and the four optimized MCP entry points. The selection/comparison flow below remains available for imported/offline results.
