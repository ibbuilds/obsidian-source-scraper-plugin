# Source Scraper user guide

Open **Source Scraper** from the status bar, immediately after ChatGPT. The panel
uses Obsidian colors, typography and controls. It is 400 × 500 px, clamps to small
windows and scrolls internally. Product UI, validation and help use English by
default. Collected titles, evidence and user-authored content keep their original
language.

The home screen shows the X connection, **Search filters**, **Resources** and one
primary action: connect, collect, stop or retry. Missing engine/reader setup links
to settings. Loading a session is not itself a live access verification.

Open **Resources** to filter the review inbox. **Approve N** and **Reject N**
apply to all matching resources; check rows to act on specific resources instead.
The count states the scope. No selection or comparison dialog is required.
Select a resource title to inspect its provenance. **Preview drafts** shows previews without writing files. Ask
ChatGPT to evaluate the selection or save notes through your separate Obsidian
connector when you want it to. The back arrow returns to collection.

Starter data is labelled **Local example**; it is not your X feed. **Options**
contains imports, session management, other sources and **Advanced tools**. The
main action uses the registered X source. Generic sources remain available under
**Other sources**. Advanced tools retain project editing and draft formatting.

Importing explicitly opens results. MCP updates the review queue without opening
the panel. Escape, Close or an outside click dismisses the panel. Startup never
opens a panel or begins collection automatically.

## Connect X

1. Select **Connect X**. **Where do I find these values?** explains how to obtain
   `twid`, `auth_token` and `ct0` from your own browser session.
2. Enter the full twid or numeric account ID and the two masked cookie values.
   Do not send them in chat. **Connect** loads the session without calling X.
3. Open **Search filters** from the home screen. Set include/exclude terms,
   any/all matching, maximum age in days and minimum likes/reposts. Empty fields
   add no restriction. **Profile limits and rules** contains pages per collection,
   the existing keyword match-score threshold and advanced rules. Start with one
   page. Saving changed filters retains previous manifests/data in a separate
   external profile and never changes vault notes.
4. Select **Find resources**. A real sample verifies access and retained evidence.
   There is no paid API or automatic commercial fallback.

Windows encrypts the session with DPAPI for the current user, outside the vault,
and restores it when Obsidian or the plugin restarts. **Disconnect X** deletes
the saved copy. Cookies never enter notes, project files or preferences. Expired
or revoked X sessions require renewal. Editing filters never requests cookies.
When renewing, blank cookie fields retain the loaded session; reconnecting the
same account preserves the entire source profile. Other operating systems keep
the memory-only session behavior. See [X-FEED](X-FEED.md).

## Forms and settings

Normal dialogs are 560 × 600 px; JSON and preview editors are 720 × 640 px. Each
clamps to the available window. Titles and actions remain visible; central
content and long code scroll internally. Inputs have consistent visible labels,
help and sizing. Results render up to 40 rows per page while preserving focus.

**Plugin settings** groups **Connection** and **Drafts**. Paths, fingerprints and
the trusted project registry sit under **Engine settings**. Editing a field does
not restart the provider. **Save settings** commits edited fields and preserves
session or format changes made meanwhile in other screens.

## Use from ChatGPT

The optional connector exposes 26 Source Scraper tools to validate sources,
start bounded jobs, read findings, record AI recommendations separately from
human decisions and maintain a persistent selection. Recommendations include
evidence and references; they are not independent verification or permission to
write notes. Only ChatGPT, through the separate Obsidian connector and on your
explicit instruction, creates or updates final notes.

## Limits

Imports: 5,000 records / 8 MB. MCP queries: up to 500 records per page.
Selections: 1–200 keys. One engine command runs at a time. Cancellation retains
committed work. Interrupted jobs do not restart automatically. Review queues
persist without collecting sources again.


Background cycles, persistent rejections and the separate like permission are
documented in [AUTONOMOUS-FEED](AUTONOMOUS-FEED.md). Review resources directly in the plugin, or use a compatible AI through MCP.
MCP access is optional; no additional model is installed.


## Imported results and comparison without AI

In Resources, use Select page to select the visible page of up to 40 resources.
Selections stay checked across pages and filters, up to 200 per batch. Clear selection
clears the whole selection. Review selected shows the complete selection, eight
resources per page in a two-column view that stacks on narrow windows.

Compare descriptions, access/license information and the original links. Missing
access or licensing evidence is explicitly Not verified. Open Evidence and match
reasons for retained source data. These fields are source evidence, not a quality guarantee.
Choose a different My decision for each resource, or Apply to all selected. The
optional reason applies to this batch. Nothing is saved until Save reviews.

Saving shows counts and individual errors. Stop saving finishes the current
resource and leaves the rest unprocessed; closing while saving has the same effect.
Saved reviews are retained. Retry saves only failed or unprocessed decisions.
Batch approval never queues a like. Selected links and full Markdown drafts remain
available through Copy links and Preview drafts. No AI calls or note writes are needed.


The scalable inbox is the default for registered projects. See [Resource inbox](RESOURCE-INBOX.md) for filter-wide actions and the four optimized MCP entry points. The selection/comparison flow below remains available for imported/offline results.
