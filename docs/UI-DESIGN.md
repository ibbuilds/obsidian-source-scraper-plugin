# Source Scraper interface

The working objects are external links, their supporting posts, saved source
profiles and a selection of draft previews. The main question is “what can I
collect and review next?” The panel keeps the current connection, filters,
result count and one primary action together. Results answer “which links do I
want to inspect?”; setup, filters and technical settings each have their own form.

Direction: True-black flat, seed 349720834. Obsidian owns the palette, typography,
native settings window and status bar shell. We retain those instead of adding
a dashboard sidebar or loading a different font. Source Scraper's scan icon,
X feed scope and link/evidence rows identify the product. One inverted primary
action, quiet section rules, no decorative cards or imagery.

Geometry: the anchored panel is 400 × 500 px. Ordinary dialogs are 560 × 600 px;
code/preview editors are 720 × 640 px. Each clamps to the viewport minus 24 px.
Dialog titles/actions remain fixed; one central region scrolls. Review search,
selection actions and pagination stay visible while the bounded list scrolls.
Settings use the available native window with a dedicated body scroll and footer.
Fixed panel height is intentional even for small result sets, as requested.

Forms use 38 px inputs, 36 px buttons, 16 px field spacing, visible labels and
accessible names/descriptions. Keyword fields use the interface face; only JSON,
keys and evidence use monospace. Empty text fields do not rely on placeholders
as labels. Cookie fields remain masked and clear when dismissed.

Filters are separate from connection. The form edits deterministic term, age,
likes/reposts and page controls, while preserving other domains, source scopes,
absolute-date boundaries and counter maxima. Profiles remain create-only. A
legacy keyword-score threshold is visible in advanced settings and is described
as a match threshold, never an editorial-quality check.

Verification uses genuine Obsidian rather than a browser facsimile. Screenshots
cover 1440, 768 and 390 px widths, dark/light themes, expanded help, imported and
empty results, long titles, setup, detail, filters, draft mapping and settings.
Geometry checks cover bounds, overflow, accessible field names and fixed action
visibility. Interaction checks include keyboard focus, current selection, explicit
settings commit, asynchronous settings merging, reload of encrypted sessions,
filter behavior and zero vault-note writes. The 4,000-record review workload still
retains the same input and checkbox nodes.

The skill's source lint has no failures; its shadow warning is accepted only for
the real floating popover. The URL-based marketing inspector does not open the
native app:// Obsidian surface; real-app geometry and screenshot checks cover it.
