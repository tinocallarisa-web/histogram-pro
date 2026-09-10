# Certification Notes — Histogram Pro v1.2.0.0

The short version to paste into Partner Center is
[`CERTIFICATION-NOTES-SHORT.txt`](./CERTIFICATION-NOTES-SHORT.txt), written to fit the
2,500-character limit of that field, which truncates without warning and mid-word. **That
field is cleared on every resubmission** — it has to be pasted again each time.

## What changed in 1.2.0.0

Three correctness defects and the licensing path. The first two were found by running the
visual on a real 500,000-row dataset; neither is visible from reading the code.

### The distribution was drawn from the highest values

The data reduction was `{"top": {"count": 30000}}`. `top` does not truncate: with a
measure bound it selects the highest N by that measure. Past 30,000 rows the histogram
therefore showed only the upper tail, and the shape of the distribution — which is the
entire product — was false. Nothing on screen indicated it.

It is now `window`, which takes the first N in model order, and the visual streams the
remaining segments through `fetchMoreData(true)`. Verified over a 500,000-row model.

Three independent brakes guard the streaming loop, because requesting more data and
returning without rendering is only safe while more data is actually arriving:

- Power BI Desktop runs inside Electron and cannot stream segments at all.
- No growth in row count since the previous round means the same data is being handed
  back. This is the brake that matters, because it does not depend on sniffing the user
  agent.
- A round ceiling, as a last resort.

When streaming cannot continue, the chart says which rows it is drawing and what the
reader can do about it.

### A long tail collapsed the chart into its first bin

The x-axis ran from the minimum to the maximum. On a real dataset — 500,000 rows, median
666, maximum 1.4 million — every row fell in the first of ten bins. The chart did not look
skewed, it looked broken.

The axis is now derived from Tukey's fences, Q1 − 1.5·IQR to Q3 + 1.5·IQR, and applied
only when that actually narrows the range.

**No rows are discarded.** Values beyond the axis are counted in the end bin, and a note
under the chart says so. Trimming the axis is a presentation decision; dropping rows would
change the counts, the mean and the standard deviation, which is precisely what a
histogram cannot afford. Manual outlier trimming (Pro) overrides the automatic axis when
the user sets it.

### Clicking a bar could hang the report

Cross-filtering built one selection ID per row, each carrying a full scope identity. A bin
holding thousands of rows either built thousands of heavy objects or filtered a subset,
leaving the rest of the report showing figures that did not match the bar that was
clicked.

Clicking a bar now applies a `BasicFilter` over the rows in the bin, which carries plain
scalars — the mechanism native slicers use for large value lists. Above `MAX_FILTER_VALUES`
(10,000 distinct values) the visual declines and names the lever that fixes it, rather than
filtering a subset and giving a silently wrong answer. The ceiling was measured on a
500,000-entity model in the Service: 10,000 is fluid on an imported model and slow but
usable over a live connection, 25,000 is unusable, 50,000 hangs the report. The cap follows
the live-connection figure, which is the slower of the two and the one enterprise
deployments use.

When the category's `queryName` does not yield a `table.column` target — drilldown levels
and some model shapes — the visual falls back to selection IDs, capped, so behaviour
degrades rather than breaks. Exactly one dot is required: a hierarchy level arrives as
`table.hierarchy.level`, and splitting on the first dot would build a target for a column
that does not exist, which is a wrong filter rather than no filter.

`objects.general.filter` was added to `capabilities.json`; without it `applyJsonFilter` has
nowhere to persist.

### Licensing

| Problem | Consequence | Fix |
|---|---|---|
| `checkLicense()` resolved asynchronously and never repainted | A paying customer kept the free tier — permanently, in a report that renders once | The chart repaints as soon as the licence resolves |
| Only `Active` accepted | A licence in its payment grace period read as absent | `Warning` is accepted alongside `Active` |
| `isLicenseUnsupportedEnv` / `isLicenseInfoAvailable` ignored | In Publish to Web, embedded, national clouds and PDF export a Pro customer read as Free and could be asked to buy what they own | Both are read; no notification is raised there |
| No purchase path | The in-chart caption was a watermark with nothing to click | Power BI's `notifyFeatureBlocked` / `notifyLicenseRequired`, which carry the link |

`spIdentifier` was already compared, so this visual never had the "any active plan counts"
defect.

The Free caption drawn inside the chart — a black bar reading *"⬆ Unlock Pro: custom bins,
outlier trim, stats, normal curve"* — has been removed. It was licensing UI of the visual's
own, which Microsoft's guidance advises against, and it behaved as a watermark on the free
tier.

`notifyLicenseRequired` stays up while Pro settings are stored without a licence, not only
at the moment of the click. That covers the lapsed trial, where the user changes nothing,
the chart reverts to ten bins with no statistics, and the stored settings make it read as
the visual breaking.

### `allowInteractions`

Checked before selecting, clearing and opening the context menu, on the bars and on the
background, with mouse and keyboard. Power BI sets it to false during export and in some
read modes, where selecting would change the report behind the user's back.

## Repository

- Certification branch: `certification` (public, GitHub)
- https://github.com/tinocallarisa-web/histogram-pro/tree/certification

**The repository slug is `histogram-pro`**, lowercase and hyphenated — not `HistogramPro`,
which is the local folder name and the GUID prefix.

## Public URLs

| Page | URL |
|---|---|
| Privacy Policy | https://tinocallarisa-web.github.io/histogram-pro/privacy.html |
| Terms of Use | https://tinocallarisa-web.github.io/histogram-pro/terms.html |
| Support | https://tinocallarisa-web.github.io/histogram-pro/support.html |
| Case study | https://tinocallarisa-web.github.io/histogram-pro/use-case.html |
| Demo video | https://www.youtube.com/watch?v=qL9luDsg3h8 |

All four pages verified with a real request: HTTP 200.

## Licence validation

- The official Power BI `IVisualLicenseManager` API exclusively
  (`host.licenseManager` / `getAvailableServicePlans()`).
- No external server, no custom auth, no payment processing performed by the visual.
- Resolution is asynchronous and never blocks the initial render. The visual renders in
  Free mode first and repaints once the licence resolves.
- Nothing is notified before the licence resolves, because `isPro` is false at start for a
  licensed customer too.
- No watermark and no artificial limits in the free tier.

## Data access & privacy

- Reads only the standard categorical `dataView` (Values, Detail rows, Tooltips).
- No `fetch` / `XMLHttpRequest`, no local file access, no telemetry, no CDN.
- Nothing is persisted outside the `.pbix` beyond the visual's own formatting properties
  and the filter it applies through `applyJsonFilter`.

## Feature summary

### Free
- The distribution over the whole table, with segment streaming
- Mean and median lines, P25, P75 and IQR shading
- Benchmark line with its own value, colour and label
- Legend, at the side or along the bottom, with editable labels
- IBCS monochrome mode
- Axis text and grid colours, font size, X and Y axis titles
- Cross-filtering by the bar, cross-highlighting, drill-down
- Report page tooltips and standard tooltips
- Keyboard focus and activation, ARIA labels, high contrast

### Pro
- Bin count from 2 to 100 (Free is fixed at 10)
- Outlier trimming, lower and upper percentage
- Statistics panel: n, mean, median, standard deviation, min, max
- Normal curve overlay
- Value labels on the bars
- Bar colour, opacity, border colour and width, and the gap between bars

## Certification requirements checklist

- [x] `renderingStarted` / `renderingFinished` / `renderingFailed` on every `update()` path,
      including the early return while a data segment is being fetched
- [x] `privileges: []` present in `capabilities.json`
- [x] `objects.general.filter` declared, for the filter the visual applies
- [x] Context menu on a bar and on empty space
- [x] Tooltips via `host.tooltipService`, plus report page tooltips
- [x] `host.allowInteractions` checked before selecting
- [x] Privacy Policy and Terms of Use are separate pages, both reachable
- [x] Support page documents field wells, format pane, tiers and FAQ
- [x] No watermark and no artificial limits in the free tier
- [x] No licensing UI of the visual's own
- [x] `package.json` declares `typescript`, per policy 1200.1.1.4
- [x] Version in `pbiviz.json` (1.2.0.0) is above the published 1.1.0.0

### Known gaps, declared openly

- **Bookmarks.** The visual persists a filter but does not yet restore its state from an
  applied filter, so a bookmark can leave the chart and the filter out of step. The build
  tooling flags this.
- **Localization.** `stringResources/en-US` exists and is declared, but the format pane
  properties carry no `displayNameKey`, so the pane is English only.

## Testing instructions

### Free tier
1. Import the visual with no licence assigned.
2. Bind a numeric measure to **Values** and the row-level field to **Detail (rows)**.
3. The histogram renders with ten bins, mean and median lines.
4. Change the bin count under **Histogram → Bins**. The chart keeps ten bins and Power BI
   raises its own licence notification, carrying the link to obtain one. The setting is
   kept.
5. Turn on **Statistics → Show stats panel** or **Show normal curve**. Same behaviour.
6. Remove those settings and the notification clears.
7. Right-click a bar and empty space — the context menu appears in both.
8. Tab to a bar and press Enter — the report is filtered by the rows behind it.
9. With a heavily skewed measure, confirm the axis stops before the maximum and the note
   under the chart says the end bar accumulates the tail.

### Pro tier
1. Assign a plan with the corresponding service plan entitlement.
2. Repeat step 4 — the bin count now applies, from 2 to 100.
3. Repeat step 5 — the statistics panel and the normal curve render.
4. Set **Exclude top %** to 1 and confirm the axis follows the manual range instead of the
   automatic one.
