# Resource UX review

## Product direction

- Product: find useful links and let a person inspect, choose and reuse them.
- Character: quiet, precise, native to Obsidian.
- Context: an index of references in an existing vault, without automatic note writing.
- Content: real link identity, what the resource offers, access conditions and source evidence.
- Consistent detail: title, description, domain and reported access share one content column.

The review uses existing Obsidian colors, type, controls and bounded panel sizes.
Visual craft guidance follows [Unslop](https://heydamir.design/unslop) by Damir Sokolovsky (CC BY 4.0), applied to
the native application rather than replacing its design language.

## Verified problems and corrections

- The previous default implicitly targeted every filtered result when no row was
  selected. Matching terms do not justify a human choice. Removed that default;
  the UI now always submits concrete changes for the chosen resources.
- Approval vocabulary suggested a quality verdict. The visible states are now
  All resources, Unreviewed, Kept and Hidden. Keeping is optional organization.
- Opening a title previously opened an internal form. Titles now open the actual
  resource; a separate labelled information button retrieves evidence on demand.
- The detail was built from compact query data, which can omit original post text
  and provenance. The detail now hydrates the retained evidence before showing
  editable choices, and ignores late responses after dismissal.
- Four form selectors contained duplicated class suffixes and never matched
  native Setting elements. Native row padding/dividers still won the cascade:
  measured 16 px vertical padding and approximately 1 px borders. Corrected
  wrapper selectors and scoped form geometry; rows now have no extra divider or
  padding and use 16 px inter-field spacing.
- Header icon centers and the search/status box edges were already aligned in
  the measured baseline. Retained header geometry. Standardized the search glyph,
  per-row information icon and external-link icon boxes; test actual centers.
- Native measuring selects are hidden implementation controls; exclude them
  from layout styling and from visible-control audits.
- Collection actions now reflect running/paused/stopped state. Static status
  text no longer rewrites the DOM every second.

## Acceptance evidence

Use genuine isolated Obsidian, not personal desktop capture. Audit dark/light
at 1440, 768 and 390 px; inspect forms, fields, first-line icon/checkbox centers,
scrolling, footer bounds, keyboard focus and long content. Exercise selection,
copy, keep, hide, restore, late detail responses, failure and recovery. The source
and ChatGPT native screens retain their common panel, header and button contract.
The efficient engine/MCP batch operations remain available; AI recommendations
stay separate from explicit human choices. No extra model or note writer is added.

Closing detail and draft dialogs returns to the same view, search, page and
selection. A saved detail choice removes that resource from the retained
selection to avoid sending an old revision. Empty final pages clamp safely.
Dialog return is deferred until native modal cleanup finishes; a genuine desktop
regression test covers Escape, drafts, save and late evidence responses.

Measured on isolated Obsidian Desktop: six viewport/theme combinations for the
library and forms; 132 additional Source Scraper/ChatGPT screen states with no
frame, overflow, footer, label or native-primary-button parity failures. Search
and view control top/height deltas were 0 px. Header and first-line row icon/
checkbox center deltas were within 1 px. Synthetic acceptance fixtures exercise
10,000 catalogue entries while mounting at most 40 rows; these are rendering and
workflow checks, not a claim about live network or editorial quality.
