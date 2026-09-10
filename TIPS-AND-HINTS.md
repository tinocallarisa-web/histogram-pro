# Histogram Pro — Tips & Hints (v1.2.0.0)

A histogram answers one question: **where does my data actually sit?** Not the total, not
the ranking — the shape. This page is the short version of everything worth knowing.

---

## Quick start

1. Drag a numeric measure or column into **Values**.
2. Drag the row-level field into **Detail (rows)** — the customer id, the order id, the
   ticket number. This is what makes each row count individually and what makes clicking a
   bar filter the report.
3. That is it. Mean and median lines are on by default.

> **The single most common mistake** is leaving *Detail (rows)* empty. Without it Power BI
> hands the visual one aggregated number instead of your rows, and there is no
> distribution to draw.

---

## Field wells

| Well | Kind | What it does |
|---|---|---|
| **Values** | Measure | The numeric field to distribute. Required. |
| **Detail (rows)** | Grouping | The row-level field. Enables per-row counting, cross-filtering and drill-down. |
| **Tooltips** | Measure | Extra measures on hover, shown as averages over the bin. |

---

## Format pane

- **Histogram** — bin count *(Pro)*, outlier trimming *(Pro)*, bar colour, opacity, border
  and gap *(Pro)*
- **Axes** — axis text colour, grid colour, font size, X and Y axis titles
- **Statistics** — mean, median, P25, P75, IQR shading and their colours; statistics panel
  *(Pro)*; normal curve *(Pro)*
- **Legend** — show, position, and the label of each line
- **Benchmark** — a target or SLA line with its value, colour and label
- **IBCS** — monochrome presentation following the IBCS notation
- **Value labels (Pro)** — the count printed above each bar

---

## What it handles

| | |
|---|---|
| Rows | **Your whole table.** Power BI hands a visual 30,000 rows at a time; the visual asks for the following segments and combines them. Verified at 500,000. |
| Bins | 10 in Free, **2 to 100** with Pro |
| Cross-filter | **Up to 10,000 distinct values in one click** |
| Tooltips | Up to 10 measures |

**Power BI Desktop is the exception on row count.** It runs inside Electron and cannot
stream segments, so it draws the first 30,000 and says so on the chart. Publish the report
to the Service for the full distribution.

---

## Reading a skewed distribution

Most business measures are skewed: amounts, response times, consumption, basket sizes. A
few very large values and a long tail of small ones.

**The axis handles this for you.** If it ran from the minimum to the maximum, one extreme
value would stretch it and every other row would land in the first bar — the chart would
look broken rather than skewed. So the axis focuses on where the data lives, using Tukey's
fences, and only when that changes anything.

**Every row is still counted.** Values beyond the axis go into the end bar, and a note
under the chart says so. The counts, the mean and the standard deviation are computed over
all your rows, never over what happens to fit on screen.

If you want the range yourself, use **Exclude top / bottom %** *(Pro)*: it overrides the
automatic axis entirely.

> **A distribution that steps down from left to right is not a bug.** For a right-skewed
> measure that is the true shape. Raise the bin count to see the structure inside that
> first stretch.

---

## Choosing a bin count

- **Fewer bins** → the overall trend. Good for a summary tile.
- **More bins** → micro-patterns, gaps and double peaks that a coarse histogram hides.
- **Rule of thumb:** √n bins for n rows. 10,000 rows → about 100.

Bin count also decides how much one click filters: more bins means fewer rows per bar.

---

## Cross-filtering

Clicking a bar filters the report by **every row behind it** — not a sample — up to 10,000
distinct values at once, which is the practical ceiling for a Power BI filter over a live
connection to a semantic model.

When a bar holds more than that, the visual says so instead of filtering part of it.
Filtering a subset would leave the rest of the report showing figures that do not match
the bar you clicked, and nothing on screen would reveal it. Raise the bin count so each
bar covers fewer rows.

Keyboard: **Tab** to a bar, **Enter** or **Space** to filter, **Escape** to clear.

---

## Free and Pro

The free tier is the histogram itself, over your whole dataset, with no watermark and no
row limit of ours:

| | Free | Pro |
|---|---|---|
| The distribution, over the whole table | ✓ | ✓ |
| Mean and median lines | ✓ | ✓ |
| Quartiles and IQR shading | ✓ | ✓ |
| Benchmark line, legend, IBCS mode | ✓ | ✓ |
| Cross-filtering, keyboard, high contrast | ✓ | ✓ |
| Bin count | 10 | **2 to 100** |
| Outlier trimming | — | **✓** |
| Statistics panel (n, μ, M, σ, min, max) | — | **✓** |
| Normal curve overlay | — | **✓** |
| Value labels on bars | — | **✓** |
| Bar colour, opacity, border and gap | — | **✓** |

Every paid setting says **(Pro)** in the format pane and is never hidden: you can see what
the paid tier offers before deciding. Turning one on without a licence leaves the free
result on screen and raises Power BI's own notification, with the link to obtain one — and
the setting is kept, so it applies the moment the licence is active.

Every install starts with a 30-day Pro trial. No card required.

---

## Troubleshooting

- **"Add a numeric field to get started"** — the *Values* well is empty.
- **Everything is in one bar** — you are looking at a heavily skewed measure. Raise the bin
  count, or use *Exclude top %* to set the range yourself.
- **The chart says it is showing the first 30,000 rows** — you are in Power BI Desktop,
  which cannot stream data segments. Publish to the Service.
- **A click says the bar holds too many values** — that bar covers more than 10,000
  distinct values. Raise the bin count.
- **The bin count does nothing** — the free tier is fixed at 10; Power BI shows the licence
  notification when you change it.
- **The statistics are not what my report shows** — check that *Detail (rows)* holds a
  field that is unique per row. If it groups, the visual distributes the grouped values.

---

## Privacy

All processing happens inside Power BI. The visual makes no network requests of any kind
and stores nothing outside the report.
