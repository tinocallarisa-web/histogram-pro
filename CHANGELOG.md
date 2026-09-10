# Changelog — Histogram Pro

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
