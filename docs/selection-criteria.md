# Category selection

Source Scraper separates discovery, topic screening, evidence qualification, human Keep/Hide decisions, and AI recommendations. A like count or keyword score does not certify resource quality.

## Configure a project

Open **Options → Selection criteria**. Choose **Use preset** for design and frontend, enter your reference note paths, then **Save criteria**. The preset is optional, editable project data; other projects and adapters retain their own scope. No notes are edited.

The preset accepts either design or frontend usefulness. Categories cover UX research, UI inspiration, design systems, components, interaction/effects/3D, typography/color/assets, frontend tools, and accessibility/performance. A frontend utility does not need an aesthetic typography review; a gallery does not need to be an open-source repository.

**Advanced category rules** lets you edit criteria, reference heading names, freshness (1–90 days), and candidate filters. Reference headings must match configured sections. At least two appropriate reference links are needed for qualification; they are benchmarks, not an automatic whitelist.

## Browse and review without AI

- **Qualified** is the default with category review enabled. It contains only current evidence reviews meeting configured requirements.
- **To review** contains admitted candidates whose quality is not established. Admission rules apply automatically to every result view, evidence decision and direct-key staging/export route before pagination.
- **All matches** contains only resources satisfying admission rules that have not failed current qualification. It cannot recover mismatches or failed sources. Raw observations remain private engine provenance, outside the working library.
- Failed qualification is automatically discarded from ordinary results, even when previously kept. Explicit MCP quality=excluded remains available for diagnostics, separate from human Hide.
- **Kept / Hidden** remain explicit human organization choices.

Select up to 50 resources, choose **Review quality**, and open the resources you want to review. Choose a category and decision for each resource. The dialog shows eight resources per page and saves explicit decisions as one batch. There is no inferred whole-selection qualification. Qualification requires:

1. The useful design **or** frontend task it supports.
2. Evidence that its useful core works free indefinitely, without trials, expiring credits or a metered viewing wall.
3. Evidence meeting every category criterion.
4. Comparisons with two distinct configured references from that category and two distinct sample pages within the resource or its verified related homepage.

Paid optional MCP/API and premium add-ons are allowed when the relevant core stays useful and unmetered for free. A teaser before a core paywall does not qualify. Code and assets need appropriate usage rights; inspiration and public research do not require a repository license merely to be read.

Unknown access, incomplete evidence and stale reviews remain pending. Reviewers must inspect the actual resource and make honest judgments: the program validates the evidence contract, not the truth or aesthetics of supplied prose. Changing source data, policy or reference notes invalidates old qualification; evidence also expires.

## Use the existing MCP

**source_scraper_research_packet** returns stable bounded batches, policy/profile hashes, reference sections, fingerprints, and the qualification input shape. With category review enabled, it reads screened pending candidates. Quality set to **all** still enforces admission and discards failed qualification; it never means an unfiltered capture list.

After inspecting resources and references, submit up to 50 reviews to **source_scraper_qualify_resources**. The server validates every item before one ledger transaction. Invalid or stale evidence cannot partially qualify the batch. This tool never changes human reviews, writes notes or queues likes.

**get_resources** supports quality values **qualified / pending / excluded / all** separately from human review and AI evaluation. Filtering happens before indexed selection pagination. Reuse the selection with the same inputs; refresh after changing criteria or decisions. **inspect_resources** returns full qualification evidence and freshness.

AI **assess_resources** remains a separate recommendation operation. Recommended decisions under category review require matching current qualification. X feedback additionally retains original-post provenance, local permission, explicit intent, and preflight checks. Other adapters do not inherit X likes.

## Compatibility

Category-enabled projects require an engine advertising **resource-quality-v1** and **resource-admission-v1**. Earlier engines fail with an explicit update error rather than showing an unfiltered qualified list. Unconfigured projects retain the prior workflow. Private reviews are project-scoped and survive restart; raw engine records remain intact.
