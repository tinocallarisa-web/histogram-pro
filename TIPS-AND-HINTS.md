# Histogram Pro — Tips & Hints (v1.4.0.0)

A histogram answers one question: **where does my data actually sit?** Not the total, not
the ranking — the shape. This page is the short version of everything worth knowing.
Full documentation, with search: https://tinocallarisa-web.github.io/histogram-pro/support.html

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
| **Values** | Measure | The numeric field to distribute. Required. Its format string is used everywhere. |
| **Detail (rows)** | Grouping | The row-level field. Enables per-row counting, cross-filtering and drill-down. |
| **Small multiples** *(Pro)* | Grouping | One histogram per value, on shared bins and a shared vertical scale. |
| **Tooltips** | Measure | Extra measures on hover, shown as averages over the bin. |

---

## Format pane

- **Histogram** — bin count *(Pro)*, outlier trimming *(Pro)*, bar colour with **fx**
  conditional formatting, opacity, border and gap *(Pro)*
- **Axes** — axis text colour, grid colour, font size, X and Y axis titles
- **Statistics** — mean, median, P25, P75, IQR shading and their colours; background of the
  line labels; statistics panel and its background *(Pro)*; normal curve *(Pro)*;
  cumulative frequency line *(Pro)*
- **Value zones (Pro)** — two cuts, three colours, labels with share of rows and of value
- **Small multiples (Pro)** — columns (0 = automatic), title size and colour
- **Legend** — show, bottom position, font size and colour, the label of each line
- **Benchmark** — a target or SLA line with value, colour and label; colour the bars by side
- **IBCS** — monochrome presentation following the IBCS notation
- **Value labels (Pro)** — the count above each bar, optionally with its percentage

---

## Value zones — say what the shape implies *(Pro)*

A histogram of deal sizes shows a long right tail. It does not say how much of the revenue
lives in that tail. Set **First cut** and **Second cut** in the units of *Values* — 10000 and
50000 for euros — and each zone is labelled with two numbers:

> **> 50K: 8% of rows · 46% of value**

That is the sentence for the slide: eight percent of the deals bring almost half the
revenue. Turn **Show share of total value** off for measures where a sum means nothing,
such as scores or durations.

---

## Comparing groups — small multiples *(Pro)*

Drop Region, Year or Segment into **Small multiples**. Every panel uses **the same bins and
the same vertical scale**, so a taller bar really is more rows, and a shifted hump really is
a shifted distribution. Mean, median, quartiles, zones and the statistics panel are computed
per panel. The legend is drawn once, on top or at the bottom.

---

## The cumulative line *(Pro)*

A 0–100% line on its own right-hand axis. Read across from 80% and down to the value axis:
that is the value 80% of rows stay under. Combined with the benchmark it answers "what share
meets the SLA" without counting bars.

---

## What it handles

| | |
|---|---|
| Rows | **Your whole table.** Power BI hands a visual 30,000 rows at a time; the visual asks for the following segments and combines them. Verified at 500,000. |
| Bins | 10 in Free, **2 to 100** with Pro |
| Cross-filter | **Up to 10,000 distinct values in one click** |

**Power BI Desktop is the exception on row count.** It cannot stream data segments to a
custom visual, so it draws the first 30,000 and says so on the chart. Publish the report to
the Service for the full distribution.

---

## Reading a skewed distribution

Most business measures are skewed: amounts, response times, consumption, basket sizes. A
few very large values and a long tail of small ones.

**The axis handles this for you.** If it ran from the minimum to the maximum, one extreme
value would stretch it and every other row would land in the first bar. So the axis focuses
on where the data lives, using Tukey's fences, and only when that changes anything.

**Every row is still counted.** Values beyond the axis go into the end bar, and a note
under the chart says so. The counts, the mean and the standard deviation are computed over
all your rows.

If you want the range yourself, use **Lower trim % / Upper trim %** *(Pro)*: it overrides
the automatic axis, and the trimmed rows leave the statistics too.

> **A mean well to the right of the median** means a few large values are pulling the
> average up. That gap is the fastest read of skew there is.

---

## Choosing a bin count

- **Fewer bins** → the overall trend. Good for a summary tile.
- **More bins** → micro-patterns, gaps and double peaks that a coarse histogram hides.
- **Rule of thumb:** move it until the shape stops changing character.

Bin count also decides how much one click filters: more bins means fewer rows per bar.

---

## Selection, cross-filtering and bookmarks

- **Click a bar** — the report is filtered by **every row behind it**, not a sample, and the
  bar stays highlighted. Click it again, or empty space, to clear.
- **Ctrl+click** — adds a bar, or takes it out. In small multiples, within one panel.
- **Bookmarks** — the selection is saved with the report: a bookmark restores the filter and
  the highlighted bars. In Desktop, Ctrl+click a bookmark button while editing.
- **Drill-down** — with a hierarchy in *Detail (rows)*, enable drill mode and click a bar.
- **Keyboard** — Tab into the chart, arrows to move, Enter or Space to select, Ctrl+Enter
  to add, Escape to clear, Shift+F10 for the context menu.

When a bar holds more than 10,000 distinct values the visual says so instead of filtering
part of it. Raise the bin count so each bar covers fewer rows.

---

## Free and Pro

| | Free | Pro |
|---|---|---|
| The distribution, over the whole table | ✓ | ✓ |
| Mean, median, quartiles and IQR shading | ✓ | ✓ |
| Benchmark line and bar colouring by benchmark | ✓ | ✓ |
| Legend, IBCS mode, high contrast, keyboard | ✓ | ✓ |
| Cross-filtering, Ctrl+click, bookmarks, drill-down | ✓ | ✓ |
| Bin count | 10 | **2 to 100** |
| Outlier trimming | — | **✓** |
| Value zones | — | **✓** |
| Small multiples | — | **✓** |
| Cumulative frequency line | — | **✓** |
| Statistics panel (n, μ, M, σ, min, max) | — | **✓** |
| Normal curve overlay | — | **✓** |
| Value labels on bars | — | **✓** |
| Bar colour, fx, opacity, border and gap | — | **✓** |

Every paid setting says **(Pro)** in the format pane. Turn one on while editing without a
licence and it is drawn working on your data, under a **"Pro preview"** watermark that names
it, with Power BI's own notification and its link. In reading view the free chart is shown.

---

## Troubleshooting

- **"Add a numeric field to get started"** — the *Values* well is empty.
- **Everything is in one bar** — a heavily skewed measure. Raise the bin count, or use the
  trim settings to set the range yourself.
- **The chart says it is showing the first 30,000 rows** — you are in Power BI Desktop,
  which cannot stream data segments. Publish to the Service.
- **A click says the bar holds too many values** — more than 10,000 distinct values. Raise
  the bin count.
- **The zones do not appear** — both cuts start at 0; zones draw only when they differ.
- **Ctrl+click in another panel replaced the selection** — by design: a selection lives in
  one panel of the small multiples.
- **The statistics are not what my report shows** — check that *Detail (rows)* holds a
  field that is unique per row. If it groups, the visual distributes the grouped values.

---

## Privacy

All processing happens inside Power BI. The visual makes no network requests of any kind
and stores nothing outside the report.
