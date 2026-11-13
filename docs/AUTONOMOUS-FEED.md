# Background feed collection and controlled feedback

The existing Source Scraper provider exposes 27 MCP tools. No second server,
repository, paid X API or extra model is needed. Users can review resources directly in the plugin. AI evaluation is optional
through the existing MCP connection. Collection and already-evaluated like actions
can continue with the chat closed while Obsidian and the computer remain open.
New resources can also be checked against explicit local criteria, with no AI,
API key or model. This is not an unattended background ChatGPT inference service.

## User-owned feedback criteria

The application has no built-in topics or mandatory quality preferences. Each
user configures a profile per project in Options > Collection and feedback >
Feedback criteria > Edit criteria. Profiles live in private plugin preferences,
not the shared repository or vault notes. A fresh installation has no profiles;
without a profile, no new local checks or local-policy likes are generated.
Previous fixed-policy records are retained as stale audit history, not migrated
into preferences for other users.

The native form accepts topic keywords, optional reusable-output keywords,
excluded resource/post keywords, and required evidence checks: reusable output,
recognized open-source license, usage documentation, a declared package test
suite with test structure, examples, and an active repository. These requirements
are individually selected by the user. Blank topic keywords explicitly allow all
topics when the user saves the form. Terms are literal words/phrases, not executable
code or regular expressions. Saving criteria never enables likes or local checks.
Changing/removing a profile invalidates its local eligibility and pending actions;
results and actions are bound to the project and a fingerprint of the criteria.

Automatic resource checks enables the worker for the selected X project. It
checks one new resource per tick and caches evidence. Automatic likes remains a
separate local permission. The separate **Continuous collection** toggle repeats
bounded windows after a ten-minute cooldown. Resource checks do not control
collection renewal. Pause and Stop take precedence. Obsidian and the computer must stay
open. No model is downloaded or called.

The generic evidence reader gathers public GitHub facts, README and package data;
it never installs or executes resources. A public HTTPS homepage is supported
only when it links the repository and the repository identifies the same homepage.
Unsupported sources, unknown access conditions and missing required evidence stay
pending. A declared test script is evidence of test structure, not a claim that
upstream tests passed. Structural checks do not certify aesthetics. Keywords
select candidates; they cannot replace the configured evidence requirements.

Every automatic like still requires a verified original X mention whose complete
link set refers only to the checked resource or its verified homepage/repository.
Mixed lists of unrelated repositories and missing original links stay pending.
Live dispatch rechecks those links, the profile fingerprint and rejection state,
including after asynchronous preflight. Confirmed/uncertain mutations are never
blindly repeated. Human reviews, AI recommendations and local checks remain
separate. Rejecting a resource or its verified related URL blocks local feedback.

Checks expire within 24 hours; changed source evidence or criteria require a fresh
check. The UI shows actual local check runs, not a count of unique high-quality
resources. Public-source rate limits pause network probes while local checks and
cached records can continue. Missing individual pages defer only that source.
Source cooldowns survive policy/profile updates. X credentials never reach public
probes. Existing five-attempts/hour and 60-second spacing apply.

## Daily use

### Reference-based research

Feedback criteria can include local reference note paths. These are private per-project
preferences, with no built-in topic or vault path. When any references are configured,
the local structural worker cannot queue likes. A separate reviewer must examine actual
rendered examples; no vision model is installed or called by the collector.

`source_scraper_research_packet(projectId, selectionId?, offset?, limit?)` returns a
stable selection in packets of at most 50, capped at 500 candidates per selection pass.
Reuse selectionId and nextOffset. It includes evidence, configured reference links grouped
by note heading, note revision hashes, and prior explicit rejections. It writes no notes,
evaluations or likes. Collection limits still apply independently; 500 candidates does not
mean 500 verified libraries or 500 new publishers. Source failures remain visible.

For a recommended assessment, supply `visualReview: {baselineHash, comparisons}`.
Each comparison has referenceUrl, sampleUrl, composition, typography, interaction,
usefulness and verdict. At least two distinct configured references and two distinct
HTTPS examples of the actual resource (or its verified related site) are required.
Each dimension needs concrete observations. Below/unknown verdicts cannot qualify.
The provider checks note revisions before saving and again during like preflight.
Changed/unavailable references and missing comparisons block dispatch. Legacy metadata-only
recommendations cannot qualify under a reference profile.

These checks validate the review evidence contract, not the truth of the reviewer's
judgment. They do not certify aesthetics, accessibility or test execution. Calibrate the
separate reviewer against accepted references and explicit negative examples before
enabling feedback. Keep recommendations private and independent from human approvals.

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
window endings and access errors are distinct. 401/403 block collection; 429 schedules a bounded cooldown;
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

Passing the original postId with a recommended, suitable assessment can request
that post only after a separate, current full-post topic review exists and
feedback is locally granted and enabled. Resource checks alone never queue a
like. Legacy resource-only actions cannot dispatch; reviewed post actions use the
whole-post snapshot and topic decision. The provider verifies retained provenance, current configured collection
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


## Temporary read failures

A possible temporary X read failure (HTTP 404, 500, 502, 503 or 504) schedules at
most two automatic retries: after 30 seconds and then 120 seconds. The retry
counter and deadline survive an Obsidian restart. A successful batch clears the
counter; Pause/Stop take precedence. Checkpoints, committed pages and the work
budget remain authoritative, so a retry does not restart the feed from scratch.
A third consecutive failure blocks collection with an explicit recovery message.
Manual Resume begins a new temporary-failure retry budget. HTTP 401/403, other access errors and
unsupported operations still block without automatic retry. HTTP 429 uses a separate
persisted cooldown: 15, 30 and 60 minutes, or longer when a validated server
Retry-After/reset deadline requires it. A fourth consecutive 429 blocks for manual
recovery. Pause/Stop and restarting collection cannot bypass an unexpired cooldown.
Successful work-limit batches read at most one feed page, at least two minutes
apart. These are conservative application limits, not a guarantee of X access. This policy applies
to collection reads only; it never retries likes or changes account permissions.

**Require topic review** is optional per project. When enabled, the normal
resource query and its counter include only current pertinent decisions. Choose
**Topic review pending** or **All topic candidates** to inspect uncertain evidence.
This is independent of quality qualification and can be completed manually.
