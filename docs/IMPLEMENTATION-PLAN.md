# Current implementation contract

The 1.2.0 delivery separates post topic feedback, linked-resource relevance and
optional quality. See [the release contract](releases/1.2.0.md) for native/manual
and MCP operations, compatibility and verification limits.

This branch connects the independent review client to the existing MCP host and public Source Scraper CLI. It follows the user's clarified ownership boundary: Source Scraper never creates or changes user vault notes. ChatGPT alone uses the separate existing Obsidian connector to write on explicit user instruction.

The active tools cover registered projects, bounded jobs, findings/evidence, separate agent recommendations, persistent staging and read-only drafts. There is no Source Scraper save-notes tool, write toggle or creation button. New project manifests belong in an external registered workspace, not user-content folders.

See [MCP integration](MCP-INTEGRATION.md), [Safety](SAFETY.md), and [User guide](USER-GUIDE.md) for the current contracts and verification commands. The engine repository's docs/chatgpt-obsidian-integration-plan.md records cross-repository ownership, milestones, limits and rollout requirements. Exact local deployment paths, backup inventories and private acceptance receipts remain outside public repository documentation.

The [1.0.0 implementation history](releases/1.0.0-implementation-history.md) preserves the previously published client plan and its historical create-only writer behavior. That history is not authority to reintroduce vault writes in this integration. Historical helpers/tests remain for compatibility; the active UI and provider do not import their mutation functions.

Delivery requires the exact host/provider/CLI candidate checks, real public or offline collection through the existing MCP endpoint, visible candidates in the running review UI, restart recovery, and unchanged pre-existing user content. A server tools/list result and a cached ChatGPT connector's tool inventory are separate acceptance facts. The optional [X source integration](X-FEED.md) has its own local read grant and live-acceptance gate; it is not a verified personalized read. Remote executable/custom sources remain unsupported.
