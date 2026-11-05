# Source and adapter boundaries

Source Scraper collects configured sources, applies deterministic filters,
retains evidence and exposes resources for human review or optional AI review.
The engine is independent of X, Obsidian and a running AI model. The Obsidian
plugin consumes the public JSON CLI and never opens its SQLite database.

## Responsibilities

- The engine owns collection execution, page checkpoints, validation, filtering,
  deduplication and storage. Scores and engagement do not certify quality.
- Each adapter owns its source connection, authentication, paging, limits and
  source-specific behavior. Common term/date/domain filters work without X.
- The X adapter adds feed collection and optional post likes. Likes/reposts are
  X-specific visual controls, not requirements for RSS, JSON or another source.
- The plugin selects the active project and presents only relevant controls.
  Generic projects do not require Python, X cookies or X permission. Mixed
  projects collect every configured source through normal project jobs; an
  explicit X feed cycle only collects their X connections.
- Human choices, optional AI assessments and external account actions remain
  separate. Keep alone never queues a like or writes a vault note.

X actions require an active retained mention with a connection ID registered as
x-for-you-local, the matching post ID/URL and its configured account. An X URL
in arbitrary JSON, a title or an entity attribute is insufficient. Invalid like
requests fail before saving a human choice or AI assessment. Common filters
preserve existing source metrics; non-X filter edits never invent X metrics or
change records into an X-specific type. Generic AI assessments can omit
postSuitable; it safely defaults to false. The post-suitability assertion belongs
only to the optional X like policy.

## Adding a source

Reuse a built-in adapter when it fits: json-file, json-snapshot, RSS, public JSON
or structured public products. An end user configures an existing adapter.
The native Add source form registers RSS feeds and structured public product
pages through the same existing provider policy, without AI or manual registry
JSON. Configuration alone performs no source request. Other admitted adapters
remain available through registered manifests.
A developer implements a missing adapter through the engine's SourceAdapter SDK;
its collect method returns observations, hasMore and an optional next cursor.
No rewrite of collection, persistence, review or UI is required.

Trusted local .cjs extensions load explicitly through the public CLI run command
with --extension. Export their results as entity JSON and import them in the
plugin. Export is read-only and does not load the extension again. See the
[engine SDK](https://github.com/ibbuilds/source-scraper/blob/main/docs/sdk.md).

The MCP provider deliberately admits a fixed reviewed adapter list. It does not
accept arbitrary extension paths or executable adapters from a remote tool call.
Custom adapters work through local CLI execution and JSON import; automatic
remote execution of custom code is not part of this integration.

## Compatibility and verification

No persisted schema, saved session, engine command or existing tool is removed.
The previous X-first home requirement is intentionally corrected: selecting a
generic project now selects its own prerequisites, collection and filter editor.
The original manifest and data survive filter edits; external derived profiles
retain adapter identities and resolve relative local input paths correctly.

verify-adapter-boundaries.mjs executes generic and custom SDK sources with the
real packaged CLI, deterministic filters and plugin JSON parsing. It checks
that invalid X actions do not first write a generic approval/assessment. Native
Obsidian tests cover generic collection, filter edits and hidden X-only controls.
These offline checks establish the adapter boundary; live access still depends
on each source's availability and credentials.
