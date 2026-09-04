# Changelog — Histogram Pro

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
