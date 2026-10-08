# Changelog — Histogram Pro

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.4.0.0] — 2026-10-08

### Added

- **Value zones (Pro).** Two cut points split the axis into three shaded zones — small, medium and large deals, fast, normal and slow tickets. Each zone is labelled, in front of the bars, with its **share of rows** and its **share of total value**: *"> 50K: 8% of rows · 46% of value"* states the concentration a histogram only implies. The share of value can be turned off for measures where a sum means nothing. A value equal to a cut belongs to the lower zone. The zone also appears in the tooltip.
- **Small multiples (Pro).** A new *Small multiples* field draws one histogram per value. Every panel shares the same bins and the same vertical scale, so bar heights compare across panels; mean, median, quartiles, zones and the statistics panel are computed per panel. Columns can be fixed or left automatic; titles have their own size and colour; the legend is drawn once for the grid, on top or at the bottom.
- **Cumulative frequency line (Pro).** A 0–100% line on its own right-hand axis — the share of rows up to each bin — with its value in the tooltip and an entry in the legend.
- **Bar colouring by benchmark.** The bars on each side of the benchmark take their own colour, and the benchmark line now has an editable label. Free.
- **Visible selection, Ctrl+click and bookmarks.** The selected bars stay highlighted while the others dim. Ctrl+click adds a bar to the selection or takes it out. The selection is stored with the report, so bookmarks bring back both the filter and the highlighted bars.
- **Conditional formatting on bar colour.** *Bar color* now has a working **fx** button (rules and field values). Before, the visual asked for it in the format pane but `capabilities.json` did not declare the rule, so Power BI never offered it.
- **Formatting.** Background colour and opacity for the statistics panel and for the labels of the reference lines and zones; legend font size and colour; legend at the bottom.
- **Localization.** The format pane and every text drawn on the chart are available in English and Spanish, following Power BI's language.
- New icon.

### Fixed

- **Drill-down did not work.** With a hierarchy in *Detail (rows)*, clicking a bar applied a filter, and Power BI only drills on a selection. When the field can be drilled the visual now selects, and drill-down works as in a native chart. Without a hierarchy it still filters by every row behind the bar.
- **Numbers did not follow the report.** Values below one thousand were shown as *0.0K*. Numbers now use the measure's format string and the report's locale, and only large values are scaled to K / M.
- **X-axis labels overlapped** on narrow charts. The number of labels now adapts to the width.
- **Labels of reference lines and zones were drawn behind the bars.** They are now in front, on a configurable background, in a band reserved at the top of the plot: the bars are scaled to stop below it, so the tallest bar and its value label are never covered by μ, M, Q1 or Q3. The labels stack only in the rows in use.
- **A normal distribution was reported as a clipped long tail.** Tukey's fences always leave about 0.7% of a normal outside them, so the axis was clipped and the chart announced a long tail that did not exist. The axis is now clipped only when the full range is at least 1.5 times the fenced range.
- **A flat normal curve looked like a broken line.** With a long tail, σ is far wider than the clipped axis and the bell is flat over the visible range — correct, but unreadable. When its peak is below a fifth of the tallest bar, a label next to the curve says so: *"Normal curve flat: data far from normal (σ = …)"*.
- **Value labels were missing on short bars.** Every bar with at least one row shows its count.
- **The legend disappeared in small panels**, and the *bottom* position was ignored. Both fixed.
- **After a mouse click, the first bar showed a focus ring.** Focus is now restored after a repaint only while navigating with the keyboard.
- **Desktop detection** used the browser's user agent; it now reads Power BI's host environment.

---

## [1.3.0.0] — 2026-09-23

### Added

- **Pro preview.** Until now a free user who turned on the statistics panel, the normal curve, value labels, a custom bin count, outlier trimming or bar styling saw **nothing happen**: the setting was silently reverted to its default and the chart carried on as before. That does not read as "there is something here to buy", it reads as a visual that ignores you. The feature is now drawn *working*, under a "Pro preview" watermark that names it, while you edit a report without a licence. In reading view — and anywhere the licence cannot be read, such as Publish to Web, embedding or export — the free result renders with no watermark and no prompt, so a published report never uses a feature nobody paid for. The preview is granted **per feature**, never in bulk: inserting the visual hands out nothing, because nothing has been asked for yet.

### Fixed

- **The banner naming the Pro feature was never readable.** Power BI shows one notification at a time and the last call replaces the previous one; `notifyFeatureBlocked` and `notifyLicenseRequired` were raised back to back, so the persistent Upgrade bar wiped out the banner immediately. The banner now comes first and the Upgrade bar follows 10.5 seconds later, once the banner has gone. The timer is cancelled in `destroy()`, because Power BI recreates the visual on every page change.
- **The notice never cleared.** Whether a Pro feature had been "attempted" was read from the *presence* of the property in `metadata.objects`. Power BI keeps a property there forever once it has been written — even after the user returns the setting to its free value — so the prompt stayed up for good. It now compares the **value** against the free default. A legitimate value can never be a sentinel.
- **The preview never appeared, and vanished on returning to the page.** The visual only repainted when the licence resolved to Pro. The first render happens before the licence resolves, so on the free branch the preview was computed as false and never drawn again. It now repaints on both branches.

### Changed

- **The clipped-axis notice is in English.** It was the only Spanish string the visual drew — in a visual whose format pane and every other label are in English — and it had no accents either. It now reads *"Axis clipped to the long tail · the last bar holds everything above X"*.
- **Four `fetch` calls were being shipped inside the package.** They come from `d3-fetch`, which the visual never calls: `tsconfig.json` had `module: "commonjs"`, which turns the imports into `require()` and defeats webpack's tree-shaking, so all of d3 was bundled. With `module: "esnext"` the dead code never enters. This matters beyond housekeeping — accessing external services is the first thing on the certification "not allowed" list, and `pbiviz package --certification-audit` now reports no external requests where it previously reported four. Fixing the build is the right answer here rather than `--certification-fix`, which only strips the calls from the output.
- **The toolchain was failing certification requirements.** Lint had no configuration in the format `pbiviz` expects, so every build skipped it silently — and that is where the certification rules are checked. Tools are now 7.2.1, the API 5.11.1, TypeScript 5.5.4 with `@types/node` pinned to 22, plus the `qs`/`uuid` overrides: `npm audit` reports 0 vulnerabilities and lint runs clean.

---

## [1.2.1.0] — 2026-09-14

### Fixed

- **A paying customer could stay on Free.** `getAvailableServicePlans()` returns each plan's
  `spIdentifier` as the full Partner Center **Service ID** (`publisher.offer.plan`), as the
  licensing API documentation states. The visual compared it with the bare plan ID
  `histogram-pro-tcviz` using `===`, which never matches the full Service ID. It now accepts a
  Service ID ending in `.histogram-pro-tcviz`, and the bare plan ID as well.
- **A failed licence lookup could ask a paying customer to buy.** When
  `getAvailableServicePlans()` threw, the visual fell back to Free but still treated the licence
  information as available, so purchase notifications could appear. It now marks the licence as
  unreadable and shows no purchase prompt, as it already did when Power BI reports the
  information unavailable.

---

## [1.2.0.0] — 2026-09-10

### Fixed

- **The distribution was drawn from the 30,000 rows with the highest values.** The data
  reduction was `top`, which does not truncate: with a measure bound it selects the highest
  N by that measure. Past 30,000 rows the histogram showed only the upper tail, and the
  shape of the distribution — which is the whole product — was false. Nothing on screen
  said so. It is now `window`, which takes the first N in model order, and the visual
  streams the remaining segments.

- **A long tail collapsed the chart into its first bin.** The x-axis ran from the minimum
  to the maximum, so a single extreme value stretched it and buried everything else. On a
  real dataset of 500,000 rows with a median of 666 and a maximum of 1.4 million, all
  500,000 fell in the first bin: the chart did not look skewed, it looked broken. The axis
  is now derived from Tukey's fences (Q1 − 1.5·IQR to Q3 + 1.5·IQR), applied only when it
  actually narrows the range.

  **No rows are dropped.** Values beyond the axis are counted in the end bin, and the chart
  says so. Trimming the axis is a presentation decision; discarding rows would change the
  counts, the mean and the standard deviation, which is precisely what a histogram cannot
  afford. Manual outlier trimming (Pro) still overrides this when set.

- **Clicking a bar could hang the report.** Cross-filtering built one selection ID per row,
  each carrying a full scope identity, so a bin holding thousands of rows either built
  thousands of heavy objects or filtered a subset — leaving the rest of the report showing
  figures that did not match the bar the user clicked.

- **A paying customer could be shown the free tier.** The licence check ran in the
  constructor, resolved asynchronously and only assigned a flag — it never repainted. If
  Power BI did not call `update()` again, the customer kept ten fixed bins and no
  statistics. In a report that renders once, permanently.

### Added

- **Exact cross-filtering.** Clicking a bar applies a `BasicFilter` over the rows in the
  bin, which carries plain scalars — the mechanism native slicers use for large value
  lists. Above 10,000 distinct values the visual declines and says which lever fixes it,
  rather than filtering a subset and giving a silently wrong answer. Measured ceiling: at
  25,000 values a report is unusable and at 50,000 it hangs.

- **Segment streaming.** When Power BI signals there are more rows, the next segment is
  requested and combined. Power BI Desktop runs in Electron and cannot stream segments, so
  it stops at the first 30,000; the chart says so and names the fix.

- **Power BI's own licensing notifications**, which carry the purchase path.
  `notifyFeatureBlocked` when a Pro setting is changed without a licence, and
  `notifyLicenseRequired` while Pro settings are stored without one — which covers the
  lapsed trial, where the user changes nothing, the chart quietly reverts, and the stored
  settings make it read as the visual breaking.

- **`host.allowInteractions`** is checked before selecting, clearing and opening the
  context menu, on the bars and on the background, with mouse and keyboard.

### Changed

- **A licence in the `Warning` state is honoured.** Only `Active` was accepted; per the
  licensing API "only the active and warning states represent a usable license". `Warning`
  is a payment grace period, so a paying customer no longer loses features while a billing
  problem is resolved.

- **`isLicenseUnsupportedEnv` and `isLicenseInfoAvailable` are honoured.** In Publish to
  Web, embedded, national clouds, PDF/PPT export, or when the user is offline, a Pro
  customer reads as Free. The visual renders the free experience there without prompting
  anyone to buy what they may already own.

### Removed

- **The Free caption drawn inside the chart** — a black bar along the bottom reading
  "⬆ Unlock Pro: custom bins, outlier trim, stats, normal curve". It was licensing UI of
  the visual's own, which Microsoft's guidance advises against, it behaved as a watermark
  on the free tier, and there was nothing to click. Power BI's notifications replace it.

---

## [1.1.0.0] — 2026-07-27

### Added
- **Report page tooltips** — `tooltips.supportedTypes.canvas: true` enables custom report page tooltips in addition to default tooltips
- **Drilldown support** — add a category to *Detail (rows)* to enable Power BI's drill-up/drill-down hierarchy controls
- **Conditional formatting** — Bar Color now supports Power BI's native conditional formatting rules (data-driven color via Format pane)
- **High contrast mode** — visual automatically adapts all colors (bars, axes, grid, stat lines) when Power BI's high contrast theme is active, using `host.colorPalette.isHighContrast`
- **`allowInteractions` capability** — registered so Power BI correctly enables mouse interactions in all report modes

### Changed
- Support page contact email updated to `support@tcviz.com`
- Support page now includes demo video embed and links to case study and issue tracker

### Documentation
- Added `docs/use-case.html` — retail sales distribution case study
- Added `CHANGELOG.md` (this file)

---

## [1.0.0.6] — 2026-07

### Fixed
- Stability and rendering improvements
- Incremented for AppSource resubmission after certification review

---

## [1.0.0.5] — 2026-06

### Fixed
- Resolved rendering event timing issue (`renderingFinished` called before async operations settled)

---

## [1.0.0.4] — 2026-06

### Fixed
- Context menu (`showContextMenu`) now works correctly on right-click on bars and background

---

## [1.0.0.3] — 2026-05

### Added
- Value labels on bars (Pro) — count or percentage, configurable font size and color

### Fixed
- Normal curve scaling corrected for non-uniform bin widths

---

## [1.0.0.1] — 2026-05

### Fixed
- License check guard for environments where `host.licenseManager` is unavailable
- Landing page now renders correctly when no data is connected

---

## [1.0.0.0] — 2026-04

### Initial release
- 10-bin histogram (Free tier)
- Configurable bins 2–100, outlier trimming, normal curve, stats panel (Pro)
- Mean and median reference lines
- Cross-filtering and context menu
- Standard tooltips with range, count, and % of total
- Rendering events (`renderingStarted` / `renderingFinished` / `renderingFailed`)
- Landing page when no data is connected
