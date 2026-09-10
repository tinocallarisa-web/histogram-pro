# AppSource Listing — Histogram Pro v1.2.0.0

Copy ready to paste into Partner Center. **The marketplace description is the
documentation most people read and the one that goes stale fastest** — update it on every
release, not only when the code changes.

---

## Short description (max 100 characters)

```
Distribution histogram with mean, median, quartiles and a normal curve. No DAX.
```

*(78 characters)*

---

## Long description

```
Every other visual on the page tells you how much. A histogram tells you how it is spread
— where the mass sits, how far the tail runs, whether there are two populations hiding
inside what looks like one.

An average is a single number standing in for thousands of rows, and it hides everything
that matters. Power BI has no native histogram, so the usual answer is a calculated column
of bins in DAX: it fixes the bin count at design time, has to be rewritten to change it,
and gives you no mean, no median and no quartiles.

Drop a numeric measure into Values and the row-level field into Detail (rows). That is the
whole setup.

WHAT YOU GET

• The distribution over your whole table, not a sample — Power BI hands a visual 30,000
  rows at a time, and Histogram Pro asks for the following segments and combines them.
  Verified at 500,000 rows.
• An axis built for skewed data. Amounts, response times and consumption have long tails:
  with the axis running from minimum to maximum, one extreme value pushes every other row
  into the first bar. The axis focuses on where the data lives instead — and every row is
  still counted, with values beyond the axis going into the end bar.
• Mean and median lines, quartiles and IQR shading, without a line of DAX
• A benchmark line for a target or SLA
• IBCS monochrome mode for standards-based reporting
• Cross-filtering by the bar: one click filters the report by every row behind it, up to
  10,000 distinct values at once
• Drill-up and drill-down when Detail (rows) holds a hierarchy
• Report page tooltips as well as standard tooltips
• Keyboard focus and activation on every bar, with descriptive ARIA labels, and high
  contrast support

PRIVACY

No network calls of any kind: no telemetry, no analytics, no CDN, no endpoints. All
calculation and rendering happens inside Power BI, on your machine or your tenant.

FREE AND PRO

The free tier is the histogram itself, over your whole dataset, with no watermark and no
row limit of ours: the distribution, mean and median, quartiles and IQR, the benchmark
line, the legend, IBCS mode, axis controls, cross-filtering, keyboard navigation and high
contrast.

Pro adds the analysis: the bin count anywhere from 2 to 100, outlier trimming, the
statistics panel (n, mean, median, standard deviation, min, max), the normal curve
overlay, value labels on the bars, and full control of bar colour, opacity, border and
gap.

Every paid setting says (Pro) in the format pane and is never hidden — you can see what
the paid tier offers before deciding.

30-day free trial on AppSource. No card required.
```

---

## What's new — v1.2.0.0

```
• The distribution is now computed over your whole table. Power BI hands a visual 30,000
  rows at a time; the visual asks for the following segments and combines them. Verified
  at 500,000 rows.
• Fixed: past 30,000 rows the histogram drew only the rows with the highest values, so the
  shape of the distribution was wrong and nothing on screen said so.
• An axis built for skewed data: it focuses on where the data lives instead of following a
  single extreme value, which used to push every row into the first bar. No row is
  discarded — values beyond the axis are counted in the end bar and the chart says so.
• Cross-filtering by the bar: one click filters the report by every row behind it, up to
  10,000 distinct values at once.
• Fixed: a paying customer could be shown the free tier in a report that renders once. The
  licence now repaints the chart as soon as it resolves.
• Power BI's own licensing notifications replace the caption that used to be drawn inside
  the chart, which had nothing to click.
• allowInteractions is honoured, and a licence in its payment grace period keeps working.
```

---

## Keywords (max 3)

```
Histogram · Distribution · Statistics
```

`Histogram` is the search term; `Distribution` catches the people who do not know the
chart is called a histogram, which is a real share of the audience.

---

## URLs to keep in sync

| Field | Value |
|---|---|
| Support / documentation | https://tinocallarisa-web.github.io/histogram-pro/support.html |
| Privacy policy | https://tinocallarisa-web.github.io/histogram-pro/privacy.html |
| Terms of use | https://tinocallarisa-web.github.io/histogram-pro/terms.html |
| Case study | https://tinocallarisa-web.github.io/histogram-pro/use-case.html |
| Repository (certification branch) | https://github.com/tinocallarisa-web/histogram-pro/tree/certification |
| Demo video | https://www.youtube.com/watch?v=qL9luDsg3h8 |

**The repository slug is `histogram-pro`, lowercase and hyphenated** — not `HistogramPro`,
which is the local folder name and the GUID prefix. A URL built from the folder name 404s.

**The certification notes field caps at 2,500 characters** and truncates without warning,
mid-word. Paste `CERTIFICATION-NOTES-SHORT.txt`, which is written to fit at 2,499. That
field is cleared on every resubmission.

**`privacyTermsLink` does not travel inside the `.pbiviz`.** The privacy URL shown to users
comes from Partner Center, so correcting it in `pbiviz.json` alone changes nothing.

---

## Before submitting

- [ ] Long description pasted into the offer, replacing the previous one
- [ ] "What's new" pasted
- [ ] Support, privacy and terms URLs checked with a real request, not assumed
- [ ] Certification notes pasted from `CERTIFICATION-NOTES-SHORT.txt`
- [ ] Version 1.2.0.0 is above the published 1.1.0.0
- [ ] Screenshots show the visual, not the whole Power BI Desktop window — the current
      captures in `assets/` include the ribbon, the format pane and the signed-in user's
      name
- [ ] Sample `.pbix` includes a Tips & Hints page, updated for this version
