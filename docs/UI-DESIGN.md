# Source Scraper interface

The working objects are external links, their supporting posts, saved source
profiles and a selection of draft previews. The main question is “what can I
collect and review next?” The panel keeps the current connection, filters,
result count and one primary action together. Results answer “which links do I
want to inspect?”; setup, filters and technical settings each have their own form.

Direction: True-black flat, seed 349720834. Obsidian owns the palette, typography,
native settings window and status bar shell. We retain those instead of adding
a dashboard sidebar or loading a different font. Source Scraper's scan icon,
X feed scope and link/evidence rows identify the product. Primary actions use Obsidian's native CTA accent and contrast tokens, with quiet
section rules and no decorative cards or imagery.

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

Product language: English by default across labels, actions, placeholders, help,
validation, accessibility names, status messages and user documentation. Collected
titles, evidence and user-authored content retain their original language.


## Shared ChatGPT contract

Both popovers use the same marked CSS contract: 400 x 500 px, clamped to the
viewport minus 24 px; matching headers and 32 px icon targets; a central scroll
region and fixed primary-action footer; 38 px inputs and 36 px buttons. Interface
font, surfaces, borders, radii, focus and CTA colours come from Obsidian tokens.
All UI copy is English. Collected content retains its original language.

The joint audit checks 22 screens/states at 1440 x 900, 768 x 700 and 390 x 480,
in light and dark themes (132 combinations). It verifies viewport bounds,
horizontal overflow, visible non-overlapping footers, field labels and identical
computed native header/button metrics. The real ChatGPT controller uses actual
Obsidian controls; network/process state is simulated. No credentials or account
requests are used. The Source Scraper desktop suite separately checks interactions.

Reproduce from the plugin repository:

```powershell
node scripts/build-native-parity.mjs <path-to-obsidian-chatgpt-mcp-tunnel>
Set-Location tests/desktop
$env:OBSIDIAN_VERSIONS='1.14.5/1.14.5'
$env:OBSIDIAN_VERSIONS_URL=([Uri](Join-Path $PWD '.obsidian-cache/obsidian-versions.json')).AbsoluteUri
node node_modules/@wdio/cli/bin/wdio.js run wdio.parity.conf.mts
```

The normal desktop runner provisions its cached Obsidian installation first.
Joint-audit screenshots and detailed measurements are generated under the ignored
`tests/desktop/artifacts` directory. Last run: all 132 combinations passed;
Source Scraper 63 unit checks passed (2 platform skips) and 19 desktop scenarios;
ChatGPT 73 unit checks and 48 browser interaction checks passed.
