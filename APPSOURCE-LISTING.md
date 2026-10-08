# AppSource Listing — Histogram Pro v1.4.0.0

Copy ready to paste into Partner Center. **The marketplace description is the
documentation most people read and the one that goes stale fastest** — update it on every
release, not only when the code changes.

---

## Short description (max 100 characters)

```
Histogram with value zones, small multiples, mean, median and quartiles. No DAX.
```

*(80 characters)*

---

## Long description

*(3176 characters; limit 5,000)*

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
• An axis built for skewed data: one extreme value no longer pushes every other row into
  the first bar. The axis focuses on where the data lives, and every row is still counted.
• Mean and median lines, quartiles and IQR shading, without a line of DAX
• A benchmark line for a target or SLA, with the bars coloured by which side they fall on
• Cross-filtering by the bar: one click filters the report by every row behind it, up to
  10,000 distinct values at once. Ctrl+click adds bars; the selection stays visible and
  bookmarks restore it.
• Drill-up and drill-down when Detail (rows) holds a hierarchy
• Report page tooltips, number formats from your model, English and Spanish
• Keyboard navigation with ARIA labels, high contrast support, IBCS mode

READ THE CONCENTRATION, NOT JUST THE SHAPE (PRO)

• Value zones: two cut points split the axis into three zones, each labelled with its
  share of rows and its share of total value. "> 50K: 8% of rows · 46% of value" says
  what the bars only imply.
• Small multiples: one histogram per region, year or segment, on the same bins and the
  same vertical scale, so a taller bar really means more rows.
• Cumulative frequency line on its own 0–100% axis
• Bin count from 2 to 100, outlier trimming, normal curve, statistics panel (n, mean,
  median, standard deviation, min, max), value labels, bar colour with conditional
  formatting

FREE AND PRO

The free tier is the histogram itself, over your whole dataset, with no watermark and no
row limit of ours: ten bins, mean and median, quartiles and IQR, the benchmark, the
legend, cross-filtering, bookmarks, drilldown, IBCS mode, keyboard and high contrast.

Turn on a Pro feature while editing and it is drawn working on your own data, under a
"Pro preview" watermark that names it. Every paid setting says (Pro) in the format pane
and is never hidden.

PRIVACY

No network calls of any kind: no telemetry, no analytics, no CDN, no endpoints. All
calculation and rendering happens inside Power BI.

GETTING STARTED

1. Put the field that identifies one row (Order ID, Customer, Ticket) in Detail (rows).
2. Put the number to distribute in Values.
3. Open the Format pane for bins, zones, benchmark and statistics.

Documentation: https://tinocallarisa-web.github.io/histogram-pro/support.html
Support: support@tcviz.com
```

---

## What's new — v1.4.0.0

```
• Value zones (Pro): three zones from two cut points, each with its share of rows and of
  total value.
• Small multiples (Pro): one histogram per group, on shared bins and a shared scale.
• Cumulative frequency line (Pro) on its own 0–100% axis.
• Bars coloured by the benchmark, and an editable benchmark label.
• The selected bars stay visible; Ctrl+click adds bars; bookmarks restore the selection.
• Drill-down on a bar now works when Detail holds a hierarchy.
• Conditional formatting (fx) on bar colour.
• Number formats follow your model and locale; English and Spanish.
• Configurable backgrounds for the statistics panel and labels; legend font, colour and
  bottom position.
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
| Demo video | https://www.youtube.com/watch?v=elLjSnxd8tw |

**The repository slug is `histogram-pro`, lowercase and hyphenated** — not `HistogramPro`,
which is the local folder name and the GUID prefix. A URL built from the folder name 404s.

**The certification notes field caps at 2,500 characters** and truncates without warning,
mid-word. Paste `docs/CERTIFICATION-NOTES-SHORT.txt`, which is written to fit. That
field is cleared on every resubmission.

**`privacyTermsLink` does not travel inside the `.pbiviz`.** The privacy URL shown to users
comes from Partner Center, so correcting it in `pbiviz.json` alone changes nothing.

---

## Before submitting

- [ ] Long description pasted into the offer, replacing the previous one
- [ ] "What's new" pasted
- [ ] Support, privacy and terms URLs checked with a real request, not assumed
- [ ] Certification notes pasted from `CERTIFICATION-NOTES-SHORT.txt`
- [ ] Version 1.4.0.0 is above the published 1.3.0.0
- [ ] Screenshots show the visual, not the whole Power BI Desktop window — the current
      captures in `assets/` include the ribbon, the format pane and the signed-in user's
      name
- [ ] Sample `.pbix` includes a Tips & Hints page, updated for this version
