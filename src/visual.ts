"use strict";

import powerbi from "powerbi-visuals-api";
import * as d3 from "d3";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ITooltipService = powerbi.extensibility.ITooltipService;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ServicePlanState = powerbi.ServicePlanState;
import DataView = powerbi.DataView;

// ─── Constants ────────────────────────────────────────────────────────────────

const FREE_MAX_BINS = 10;
const PLAN_ID = "histogram-pro-tcviz";

const DEFAULTS = {
    bins: 10, trimLower: 0, trimUpper: 0,
    barColor: "#00E5FF", barOpacity: 80, borderColor: "#0B1437", borderWidth: 1, barGap: 2,
    axisColor: "#B0BEC5", gridColor: "#263238", axisFontSize: 10,
    showXLabel: true, showYLabel: true,
    showMean: true, meanColor: "#FF4081",
    showMedian: true, medianColor: "#69F0AE",
    showP25: false, p25Color: "#FFD740",
    showP75: false, p75Color: "#FFD740",
    showIQR: false, iqrColor: "#FFD740",
    showBenchmark: false, benchmarkValue: 0, benchmarkColor: "#FF6B6B", benchmarkLabel: "Target",
    showLegend: false, legendBottom: false,
    legendMeanLabel: "Mean", legendMedianLabel: "Median", legendP25Label: "P25", legendP75Label: "P75", legendNormalLabel: "Normal",
    ibcsMode: false,
    showNormal: false, normalColor: "#7C4DFF",
    showStats: true, statsColor: "#B0BEC5",
    showValueLabels: false, vlFontSize: 9, vlColor: "#E0E6FF", vlShowPercent: false,
};

// ─── IBCS palette ─────────────────────────────────────────────────────────────
// International Business Communication Standards for finance reporting

const IBCS = {
    bar:        "#404040",   // actual — dark gray
    axis:       "#404040",
    grid:       "#D0D0D0",   // very light, almost invisible
    mean:       "#000000",   // solid black — primary reference
    meanDash:   "",          // solid in IBCS (no dasharray)
    median:     "#606060",   // dashed dark gray
    medianDash: "4,3",
    p25:        "#A0A0A0",
    p75:        "#A0A0A0",
    iqr:        "#F0F0F0",   // very light fill
    benchmark:  "#000000",   // target line — bold black
    normal:     "#808080",
    stats:      "#000000",
    label:      "#000000",
};

// ─── Settings ─────────────────────────────────────────────────────────────────

interface Settings {
    bins: number; trimLower: number; trimUpper: number;
    barColor: string; barOpacity: number; borderColor: string; borderWidth: number; barGap: number;
    axisColor: string; gridColor: string; axisFontSize: number;
    showXLabel: boolean; showYLabel: boolean;
    showMean: boolean; meanColor: string;
    showMedian: boolean; medianColor: string;
    showP25: boolean; p25Color: string;
    showP75: boolean; p75Color: string;
    showIQR: boolean; iqrColor: string;
    showBenchmark: boolean; benchmarkValue: number; benchmarkColor: string; benchmarkLabel: string;
    showLegend: boolean; legendBottom: boolean;
    legendMeanLabel: string; legendMedianLabel: string; legendP25Label: string; legendP75Label: string; legendNormalLabel: string;
    ibcsMode: boolean;
    showNormal: boolean; normalColor: string;
    showStats: boolean; statsColor: string;
    showValueLabels: boolean; vlFontSize: number; vlColor: string; vlShowPercent: boolean;
}

function getColor(obj: powerbi.DataViewObjects, o: string, p: string, fb: string): string {
    return obj?.[o]?.[p]?.["solid"]?.["color"] || fb;
}
function getValue<T>(obj: powerbi.DataViewObjects, o: string, p: string, fb: T): T {
    const v = obj?.[o]?.[p]; return v == null ? fb : v as T;
}

function parseSettings(dv: DataView): Settings {
    const obj = dv?.metadata?.objects;
    return {
        bins: getValue<number>(obj, "histogram", "bins", DEFAULTS.bins),
        trimLower: getValue<number>(obj, "histogram", "trimLower", DEFAULTS.trimLower),
        trimUpper: getValue<number>(obj, "histogram", "trimUpper", DEFAULTS.trimUpper),
        barColor: getColor(obj, "histogram", "barColor", DEFAULTS.barColor),
        barOpacity: getValue<number>(obj, "histogram", "barOpacity", DEFAULTS.barOpacity),
        borderColor: getColor(obj, "histogram", "borderColor", DEFAULTS.borderColor),
        borderWidth: getValue<number>(obj, "histogram", "borderWidth", DEFAULTS.borderWidth),
        barGap: getValue<number>(obj, "histogram", "barGap", DEFAULTS.barGap),
        axisColor: getColor(obj, "axes", "axisColor", DEFAULTS.axisColor),
        gridColor: getColor(obj, "axes", "gridColor", DEFAULTS.gridColor),
        axisFontSize: getValue<number>(obj, "axes", "fontSize", DEFAULTS.axisFontSize),
        showXLabel: getValue<boolean>(obj, "axes", "showXLabel", DEFAULTS.showXLabel),
        showYLabel: getValue<boolean>(obj, "axes", "showYLabel", DEFAULTS.showYLabel),
        showMean: getValue<boolean>(obj, "statistics", "showMean", DEFAULTS.showMean),
        meanColor: getColor(obj, "statistics", "meanColor", DEFAULTS.meanColor),
        showMedian: getValue<boolean>(obj, "statistics", "showMedian", DEFAULTS.showMedian),
        medianColor: getColor(obj, "statistics", "medianColor", DEFAULTS.medianColor),
        showP25: getValue<boolean>(obj, "statistics", "showP25", DEFAULTS.showP25),
        p25Color: getColor(obj, "statistics", "p25Color", DEFAULTS.p25Color),
        showP75: getValue<boolean>(obj, "statistics", "showP75", DEFAULTS.showP75),
        p75Color: getColor(obj, "statistics", "p75Color", DEFAULTS.p75Color),
        showIQR: getValue<boolean>(obj, "statistics", "showIQR", DEFAULTS.showIQR),
        iqrColor: getColor(obj, "statistics", "iqrColor", DEFAULTS.iqrColor),
        showBenchmark: getValue<boolean>(obj, "benchmark", "show", DEFAULTS.showBenchmark),
        benchmarkValue: getValue<number>(obj, "benchmark", "value", DEFAULTS.benchmarkValue),
        benchmarkColor: getColor(obj, "benchmark", "color", DEFAULTS.benchmarkColor),
        benchmarkLabel: getValue<string>(obj, "benchmark", "label", DEFAULTS.benchmarkLabel),
        showLegend: getValue<boolean>(obj, "legend", "show", DEFAULTS.showLegend),
        legendBottom: getValue<boolean>(obj, "legend", "bottom", DEFAULTS.legendBottom),
        legendMeanLabel:   getValue<string>(obj, "legend", "meanLabel",   DEFAULTS.legendMeanLabel),
        legendMedianLabel: getValue<string>(obj, "legend", "medianLabel", DEFAULTS.legendMedianLabel),
        legendP25Label:    getValue<string>(obj, "legend", "p25Label",    DEFAULTS.legendP25Label),
        legendP75Label:    getValue<string>(obj, "legend", "p75Label",    DEFAULTS.legendP75Label),
        legendNormalLabel: getValue<string>(obj, "legend", "normalLabel", DEFAULTS.legendNormalLabel),
        ibcsMode: getValue<boolean>(obj, "ibcs", "mode", DEFAULTS.ibcsMode),
        showNormal: getValue<boolean>(obj, "statistics", "showNormal", DEFAULTS.showNormal),
        normalColor: getColor(obj, "statistics", "normalColor", DEFAULTS.normalColor),
        showStats: getValue<boolean>(obj, "statistics", "showStats", DEFAULTS.showStats),
        statsColor: getColor(obj, "statistics", "statsColor", DEFAULTS.statsColor),
        showValueLabels: getValue<boolean>(obj, "valueLabels", "show", DEFAULTS.showValueLabels),
        vlFontSize: getValue<number>(obj, "valueLabels", "fontSize", DEFAULTS.vlFontSize),
        vlColor: getColor(obj, "valueLabels", "color", DEFAULTS.vlColor),
        vlShowPercent: getValue<boolean>(obj, "valueLabels", "showPercent", DEFAULTS.vlShowPercent),
    };
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function fmtNum(v: number): string {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1) + "B";
    if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (a >= 1e4) return (v / 1e3).toFixed(1) + "K";
    if (a >= 100) return v.toFixed(0);
    if (a >= 1) return v.toFixed(1);
    return v.toFixed(2);
}

// Dynamic format strings — respects the measure's Power BI format setting
function formatValue(v: number, fmt: string): string {
    if (!fmt) return fmtNum(v);
    // Percentage: multiply by 100 (PBI stores percentages as fractions)
    if (fmt.includes("%")) {
        const dec = fmt.match(/0\.(0+)%/)?.[1]?.length ?? 1;
        return `${(v * 100).toFixed(dec)}%`;
    }
    const sym = fmt.match(/[$€£¥₹]/)?.[0] ?? "";
    const dec = fmt.match(/0\.(0+)/)?.[1]?.length ?? -1;
    const a = Math.abs(v);
    let n: string;
    if (a >= 1e9) n = (v / 1e9).toFixed(1) + "B";
    else if (a >= 1e6) n = (v / 1e6).toFixed(1) + "M";
    else if (a >= 1e4) n = (v / 1e3).toFixed(1) + "K";
    else if (dec >= 0) n = v.toFixed(dec);
    else if (a >= 100) n = v.toFixed(0);
    else if (a >= 1) n = v.toFixed(1);
    else n = v.toFixed(2);
    return sym + n;
}

// ─── Visual ───────────────────────────────────────────────────────────────────

export class Visual implements IVisual {
    private host: IVisualHost;
    private container: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private events: IVisualEventService;
    private tooltipService: ITooltipService;
    private selectionManager: ISelectionManager;
    private isPro: boolean = false;
    private currentSettings: Settings = { ...DEFAULTS } as Settings;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.tooltipService = options.host.tooltipService;
        this.selectionManager = options.host.createSelectionManager();

        this.container = d3.select(options.element)
            .append("div")
            .classed("histogram-pro-container", true)
            .style("width", "100%").style("height", "100%").style("position", "relative");

        this.svg = this.container.append("svg");
        this.checkLicense();
    }

    // ── License ───────────────────────────────────────────────────────────────

    private async checkLicense(): Promise<void> {
        if (this.isPro) return; // dev override — skip license check when isPro is hardcoded true
        try {
            const lm = this.host.licenseManager;
            if (!lm) { this.isPro = false; return; }
            const result = await lm.getAvailableServicePlans();
            this.isPro = result?.plans?.some(
                p => p.spIdentifier === PLAN_ID && p.state === ServicePlanState.Active
            ) ?? false;
        } catch { this.isPro = false; }
    }

    // ── Update ────────────────────────────────────────────────────────────────

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);
        try {
            this.render(options);
            this.events.renderingFinished(options);
        } catch (e) {
            this.events.renderingFailed(options, String(e));
            console.error("[HistogramPro]", e);
        }
    }

    private render(options: VisualUpdateOptions): void {
        const dataView = options.dataViews?.[0];
        const width = options.viewport.width;
        const height = options.viewport.height;

        this.svg.selectAll("*").remove();
        this.svg.attr("width", width).attr("height", height);

        if (!dataView?.categorical?.values?.[0]) {
            this.showLandingPage(width, height);
            return;
        }

        const settings = parseSettings(dataView);
        this.currentSettings = settings;

        // Dynamic format string — read from the measure's Power BI format setting
        const formatStr = dataView.categorical.values[0].source.format ?? "";

        const effectiveBins = this.isPro
            ? Math.max(2, Math.min(100, settings.bins || DEFAULTS.bins))
            : FREE_MAX_BINS;

        // Extract values + selection IDs + highlights
        const raw: number[] = [];
        const rawWithIds: Array<{ value: number; selId: powerbi.extensibility.ISelectionId; origIndex: number }> = [];
        const mainValueCol = dataView.categorical.values.find(v => v.source.roles?.["measure"]) ?? dataView.categorical.values[0];
        const tooltipCols = dataView.categorical.values.filter(v => v.source.roles?.["tooltips"]);
        const rawValues = mainValueCol.values;
        const highlightValues = mainValueCol.highlights;
        const hasHighlights = highlightValues != null;
        const highlightedRaw: number[] = [];
        const categories = dataView.categorical.categories?.[0];

        for (let i = 0; i < rawValues.length; i++) {
            const v = rawValues[i];
            if (v != null && isFinite(+v)) {
                const builder = this.host.createSelectionIdBuilder();
                if (categories) builder.withCategory(categories, i);
                const selId = builder.createSelectionId();
                raw.push(+v);
                rawWithIds.push({ value: +v, selId, origIndex: i });
                if (hasHighlights && highlightValues[i] != null && isFinite(+highlightValues[i])) {
                    highlightedRaw.push(+v);
                }
            }
        }
        if (raw.length < 2) return;

        raw.sort((a, b) => a - b);
        const n = raw.length;

        const loVal = this.isPro && settings.trimLower > 0 ? percentile(raw, settings.trimLower) : raw[0];
        const hiVal = this.isPro && settings.trimUpper > 0 ? percentile(raw, 100 - settings.trimUpper) : raw[n - 1];

        const data = raw.filter(v => v >= loVal && v <= hiVal);
        if (data.length < 2) return;
        const highlightedData = highlightedRaw.filter(v => v >= loVal && v <= hiVal);

        const nFiltered = data.length;
        const mean = data.reduce((s, v) => s + v, 0) / nFiltered;
        const median = percentile(data, 50);
        const p25 = percentile(data, 25);
        const p75 = percentile(data, 75);
        const std = Math.sqrt(data.reduce((s, v) => s + (v - mean) ** 2, 0) / nFiltered);
        const dMin = data[0], dMax = data[data.length - 1];

        // Reserve extra margin for the horizontal legend so it never overlaps the plot
        const legendFs  = Math.max(8, settings.axisFontSize - 1);
        const legendRowH = settings.showLegend ? legendFs + 12 : 0;  // line height + padding
        const marginL = settings.showYLabel ? 52 : 38;
        const marginR = 16;
        const marginT = 16 + (settings.showLegend && !settings.legendBottom ? legendRowH + 16 : 0);
        const marginB = (settings.showXLabel ? 46 : 32) + (settings.showLegend && settings.legendBottom ? legendRowH + 16 : 0);
        const plotW = Math.max(20, width - marginL - marginR);
        const plotH = Math.max(20, height - marginT - marginB);

        const xScale = d3.scaleLinear().domain([dMin, dMax]).range([0, plotW]).nice();
        const xDomain = xScale.domain();

        const binner = d3.bin()
            .domain(xDomain as [number, number])
            .thresholds(d3.range(xDomain[0], xDomain[1], (xDomain[1] - xDomain[0]) / effectiveBins));
        const bins = binner(data);
        const maxCount = d3.max(bins, b => b.length) || 1;
        const yScale = d3.scaleLinear().domain([0, maxCount]).range([plotH, 0]).nice();

        // Selection IDs per bin
        const binSelectionIds: powerbi.extensibility.ISelectionId[][] = bins.map(bin =>
            rawWithIds.filter(d => d.value >= (bin.x0 ?? -Infinity) && d.value < (bin.x1 ?? Infinity)).map(d => d.selId)
        );

        // Highlighted bins for filter-in
        const highlightBinner = d3.bin()
            .domain(xDomain as [number, number])
            .thresholds(d3.range(xDomain[0], xDomain[1], (xDomain[1] - xDomain[0]) / effectiveBins));
        const highlightBins = hasHighlights ? highlightBinner(highlightedData) : [];

        // Effective colors: user settings → IBCS override → high contrast override
        const isHighContrast = this.host.colorPalette.isHighContrast;
        const ibcs = settings.ibcsMode;

        const _userBarColor    = this.isPro ? settings.barColor    : DEFAULTS.barColor;
        const _userBorderColor = this.isPro ? settings.borderColor : DEFAULTS.borderColor;

        const barColor = isHighContrast
            ? (this.host.colorPalette.foreground?.value ?? _userBarColor)
            : (ibcs ? IBCS.bar : _userBarColor);
        const borderColor = isHighContrast
            ? (this.host.colorPalette.foregroundSelected?.value ?? _userBorderColor)
            : (ibcs ? IBCS.bar : _userBorderColor);
        const borderWidth = ibcs ? 0 : (this.isPro ? settings.borderWidth : DEFAULTS.borderWidth);
        const effectiveAxisColor = isHighContrast
            ? (this.host.colorPalette.foreground?.value ?? settings.axisColor)
            : (ibcs ? IBCS.axis : settings.axisColor);
        const effectiveGridColor = isHighContrast
            ? (this.host.colorPalette.backgroundLight?.value ?? settings.gridColor)
            : (ibcs ? IBCS.grid : settings.gridColor);

        // Pre-compute benchmark color so it's available for the legend
        const bmColor = isHighContrast
            ? (this.host.colorPalette.foregroundSelected?.value ?? settings.benchmarkColor)
            : (ibcs ? IBCS.benchmark : settings.benchmarkColor);

        const gap = this.isPro ? Math.max(0, settings.barGap) : 1;
        const barOpacity = (this.isPro ? Math.min(100, Math.max(0, settings.barOpacity)) : 80) / 100;

        const g = this.svg.append("g").attr("transform", `translate(${marginL},${marginT})`);

        // Grid
        g.append("g").call(
            d3.axisLeft(yScale).tickSize(-plotW).tickFormat(() => "").ticks(5)
        ).call(sel => {
            sel.select(".domain").remove();
            sel.selectAll("line").attr("stroke", effectiveGridColor).attr("stroke-dasharray", "2,3").attr("opacity", 0.5);
        });

        // IQR shading — drawn before bars so bars render on top
        if (settings.showIQR) {
            const iqrX = xScale(p25);
            const iqrW = xScale(p75) - xScale(p25);
            if (iqrW > 0) {
                const iqrFill = isHighContrast
                    ? (this.host.colorPalette.foreground?.value ?? settings.iqrColor)
                    : (ibcs ? IBCS.iqr : settings.iqrColor);
                g.append("rect")
                    .attr("x", iqrX).attr("y", 0)
                    .attr("width", iqrW).attr("height", plotH)
                    .attr("fill", iqrFill).attr("fill-opacity", ibcs ? 0.08 : 0.12)
                    .attr("pointer-events", "none");
            }
        }

        // Context menu on empty space
        this.svg.on("click", () => { this.selectionManager.clear(); });
        this.svg.on("contextmenu", (event: MouseEvent) => {
            event.preventDefault();
            this.selectionManager.showContextMenu(null, { x: event.clientX, y: event.clientY });
        });

        // Bars
        const barsG = g.append("g").attr("class", "bars");
        bins.forEach((bin, binIndex) => {
            if (bin.x0 == null || bin.x1 == null) return;
            const bx = xScale(bin.x0) + gap / 2;
            const bw = Math.max(0, xScale(bin.x1) - xScale(bin.x0) - gap);
            const by = yScale(bin.length);
            const bh = plotH - yScale(bin.length);
            if (bw <= 0 || bh <= 0) return;

            const ids = binSelectionIds[binIndex] || [];
            const dimmedOpacity = hasHighlights ? barOpacity * 0.25 : barOpacity;

            barsG.append("rect")
                .attr("x", bx).attr("y", by).attr("width", bw).attr("height", bh)
                .attr("fill", barColor).attr("fill-opacity", dimmedOpacity)
                .attr("stroke", borderColor).attr("stroke-width", borderWidth)
                .attr("tabindex", 0)
                .attr("role", "button")
                .attr("aria-label", `Bin ${formatValue(bin.x0!, formatStr)} to ${formatValue(bin.x1!, formatStr)}, count ${bin.length}, ${((bin.length / nFiltered) * 100).toFixed(1)}%`)
                .style("cursor", "pointer")
                .on("keydown", (event: KeyboardEvent) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        this.selectionManager.select(ids, event.ctrlKey);
                    } else if (event.key === "Escape") {
                        this.selectionManager.clear();
                    }
                })
                .on("click", (event: MouseEvent) => {
                    event.stopPropagation();
                    this.selectionManager.select(ids, (event as MouseEvent).ctrlKey);
                })
                .on("contextmenu", (event: MouseEvent) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const selId = ids.length > 0 ? ids[0] : null;
                    this.selectionManager.showContextMenu(selId, { x: event.clientX, y: event.clientY });
                })
                .on("mouseover", (event: MouseEvent) => {
                    if (!this.tooltipService.enabled()) return;
                    // Extra tooltip measures — average per bin
                    const binItems = rawWithIds.filter(d =>
                        d.value >= (bin.x0 ?? -Infinity) && d.value < (bin.x1 ?? Infinity)
                    );
                    const extraItems: powerbi.extensibility.VisualTooltipDataItem[] = tooltipCols.map(tc => {
                        const vals = binItems
                            .map(d => tc.values[d.origIndex])
                            .filter(v => v != null && isFinite(+v!))
                            .map(v => +(v!));
                        const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
                        return {
                            displayName: tc.source.displayName,
                            value: avg != null ? formatValue(avg, tc.source.format ?? "") : "(blank)"
                        };
                    });
                    this.tooltipService.show({
                        dataItems: [
                            { displayName: "Range", value: `${formatValue(bin.x0!, formatStr)} – ${formatValue(bin.x1!, formatStr)}` },
                            { displayName: "Count", value: String(bin.length) },
                            { displayName: "% of total", value: `${((bin.length / nFiltered) * 100).toFixed(1)}%` },
                            ...extraItems,
                        ],
                        identities: ids,
                        coordinates: [event.clientX, event.clientY],
                        isTouchEvent: false,
                    });
                })
                .on("mousemove", (event: MouseEvent) => {
                    if (!this.tooltipService.enabled()) return;
                    this.tooltipService.move({ coordinates: [event.clientX, event.clientY], isTouchEvent: false, identities: ids });
                })
                .on("mouseout", () => {
                    if (!this.tooltipService.enabled()) return;
                    this.tooltipService.hide({ immediately: false, isTouchEvent: false });
                });

            // Value labels (Pro only)
            if (this.isPro && settings.showValueLabels && bh > 14) {
                const labelVal = settings.vlShowPercent ? `${((bin.length / nFiltered) * 100).toFixed(1)}%` : String(bin.length);
                barsG.append("text")
                    .attr("x", bx + bw / 2).attr("y", by - 3)
                    .attr("text-anchor", "middle").attr("font-size", settings.vlFontSize)
                    .attr("fill", settings.vlColor).text(labelVal);
            }
        });

        // Filter-in overlay (highlighted bars at full opacity)
        if (hasHighlights) {
            highlightBins.forEach(hbin => {
                if (hbin.x0 == null || hbin.x1 == null || hbin.length === 0) return;
                const bx = xScale(hbin.x0) + gap / 2;
                const bw = Math.max(0, xScale(hbin.x1) - xScale(hbin.x0) - gap);
                const by = yScale(hbin.length);
                const bh = plotH - yScale(hbin.length);
                if (bw <= 0 || bh <= 0) return;
                barsG.append("rect")
                    .attr("x", bx).attr("y", by).attr("width", bw).attr("height", bh)
                    .attr("fill", barColor).attr("fill-opacity", barOpacity)
                    .attr("stroke", borderColor).attr("stroke-width", borderWidth)
                    .style("pointer-events", "none");
            });
        }

        // X axis
        g.append("g").attr("transform", `translate(0,${plotH})`)
            .call(d3.axisBottom(xScale).tickFormat(d => formatValue(+d, formatStr)).ticks(Math.min(effectiveBins, 8)))
            .call(sel => {
                sel.select(".domain").attr("stroke", effectiveAxisColor);
                sel.selectAll("text").attr("fill", effectiveAxisColor).attr("font-size", settings.axisFontSize);
                sel.selectAll(".tick line").attr("stroke", effectiveAxisColor);
            });

        // Y axis
        g.append("g").call(d3.axisLeft(yScale).ticks(5).tickFormat(d => fmtNum(+d)))
            .call(sel => {
                sel.select(".domain").attr("stroke", effectiveAxisColor);
                sel.selectAll("text").attr("fill", effectiveAxisColor).attr("font-size", settings.axisFontSize);
                sel.selectAll(".tick line").attr("stroke", effectiveAxisColor);
            });

        if (settings.showYLabel) {
            g.append("text").attr("transform", "rotate(-90)").attr("x", -plotH / 2).attr("y", -marginL + 12)
                .attr("text-anchor", "middle").attr("font-size", settings.axisFontSize).attr("fill", effectiveAxisColor).text("Count");
        }
        if (settings.showXLabel) {
            g.append("text").attr("x", plotW / 2).attr("y", plotH + marginB - 6)
                .attr("text-anchor", "middle").attr("font-size", settings.axisFontSize).attr("fill", effectiveAxisColor).text("Value");
        }

        // Mean line
        const effectiveMeanColor   = isHighContrast ? (this.host.colorPalette.foreground?.value ?? settings.meanColor)   : (ibcs ? IBCS.mean   : settings.meanColor);
        const effectiveMedianColor = isHighContrast ? (this.host.colorPalette.foregroundSelected?.value ?? settings.medianColor) : (ibcs ? IBCS.median : settings.medianColor);
        const effectiveP25Color    = isHighContrast ? (this.host.colorPalette.foreground?.value ?? settings.p25Color)    : (ibcs ? IBCS.p25    : settings.p25Color);
        const effectiveP75Color    = isHighContrast ? (this.host.colorPalette.foreground?.value ?? settings.p75Color)    : (ibcs ? IBCS.p75    : settings.p75Color);

        if (settings.showMean && mean >= xDomain[0] && mean <= xDomain[1]) {
            const mx = xScale(mean);
            const meanDash = ibcs ? IBCS.meanDash : "4,3";  // IBCS: solid; default: dashed
            g.append("line").attr("x1", mx).attr("y1", 0).attr("x2", mx).attr("y2", plotH)
                .attr("stroke", effectiveMeanColor).attr("stroke-width", ibcs ? 2 : 1.5)
                .attr("stroke-dasharray", meanDash || null!);
            g.append("text").attr("x", mx + 4).attr("y", 10)
                .attr("fill", effectiveMeanColor).attr("font-size", settings.axisFontSize)
                .attr("font-weight", ibcs ? "600" : "normal")
                .text(`μ ${formatValue(mean, formatStr)}`);
        }

        // Median line
        if (settings.showMedian && median >= xDomain[0] && median <= xDomain[1]) {
            const mdx = xScale(median);
            const medianDash = ibcs ? IBCS.medianDash : "6,3";
            g.append("line").attr("x1", mdx).attr("y1", 0).attr("x2", mdx).attr("y2", plotH)
                .attr("stroke", effectiveMedianColor).attr("stroke-width", 1.5)
                .attr("stroke-dasharray", medianDash);
            g.append("text").attr("x", mdx + 4).attr("y", 24)
                .attr("fill", effectiveMedianColor).attr("font-size", settings.axisFontSize).text(`M ${formatValue(median, formatStr)}`);
        }

        // P25 / P75 quartile lines
        if (settings.showP25 && p25 >= xDomain[0] && p25 <= xDomain[1]) {
            const px25 = xScale(p25);
            g.append("line").attr("x1", px25).attr("y1", 0).attr("x2", px25).attr("y2", plotH)
                .attr("stroke", effectiveP25Color).attr("stroke-width", 1).attr("stroke-dasharray", "3,4");
            g.append("text").attr("x", px25 + 4).attr("y", 38)
                .attr("fill", effectiveP25Color).attr("font-size", settings.axisFontSize).text(`Q1 ${formatValue(p25, formatStr)}`);
        }

        if (settings.showP75 && p75 >= xDomain[0] && p75 <= xDomain[1]) {
            const px75 = xScale(p75);
            g.append("line").attr("x1", px75).attr("y1", 0).attr("x2", px75).attr("y2", plotH)
                .attr("stroke", effectiveP75Color).attr("stroke-width", 1).attr("stroke-dasharray", "3,4");
            g.append("text").attr("x", px75 + 4).attr("y", 52)
                .attr("fill", effectiveP75Color).attr("font-size", settings.axisFontSize).text(`Q3 ${formatValue(p75, formatStr)}`);
        }

        // Benchmark line — user-defined vertical reference
        if (settings.showBenchmark) {
            const bv = settings.benchmarkValue;
            if (bv >= xDomain[0] && bv <= xDomain[1]) {
                const bmX = xScale(bv);
                const bmLabel = settings.benchmarkLabel || "Target";
                g.append("line")
                    .attr("x1", bmX).attr("y1", 0).attr("x2", bmX).attr("y2", plotH)
                    .attr("stroke", bmColor).attr("stroke-width", ibcs ? 2.5 : 2);
                g.append("text")
                    .attr("x", bmX + 4).attr("y", plotH - 6)
                    .attr("fill", bmColor).attr("font-size", settings.axisFontSize)
                    .attr("font-weight", ibcs ? "700" : "600")
                    .text(`${bmLabel}: ${formatValue(bv, formatStr)}`);
            }
        }

        // Normal curve (Pro only)
        if (this.isPro && settings.showNormal && std > 0) {
            const normalLine = d3.line<number>()
                .x(d => xScale(d))
                .y(d => {
                    const density = (1 / (std * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((d - mean) / std) ** 2);
                    const binWidth = (xDomain[1] - xDomain[0]) / effectiveBins;
                    return yScale(density * nFiltered * binWidth);
                })
                .curve(d3.curveBasis);
            const pts = d3.range(xDomain[0], xDomain[1], (xDomain[1] - xDomain[0]) / 200);
            g.append("path").datum(pts).attr("fill", "none").attr("stroke", settings.normalColor).attr("stroke-width", 2).attr("d", normalLine);
        }

        // Stats panel (Pro only)
        if (this.isPro && settings.showStats) {
            const lines = [
                `n = ${nFiltered}${n > nFiltered ? ` (${n - nFiltered} trimmed)` : ""}`,
                `μ = ${formatValue(mean, formatStr)}`, `M = ${formatValue(median, formatStr)}`,
                `σ = ${formatValue(std, formatStr)}`,
                `min = ${formatValue(dMin, formatStr)}`, `max = ${formatValue(dMax, formatStr)}`,
            ];
            const px = plotW - 110, py = 8;
            const lh = settings.axisFontSize + 3;
            g.append("rect").attr("x", px - 6).attr("y", py - 4).attr("width", 116).attr("height", lines.length * lh + 6)
                .attr("fill", "rgba(0,0,0,0.35)").attr("rx", 4);
            lines.forEach((line, i) => {
                g.append("text").attr("x", px).attr("y", py + i * lh + settings.axisFontSize)
                    .attr("fill", settings.statsColor).attr("font-size", settings.axisFontSize).attr("font-family", "monospace").text(line);
            });
        }

        // Legend — horizontal, Bullet-style (icon + label, no background)
        if (settings.showLegend) {
            type LegendItem = { label: string; color: string; dash: string; w: number; kind: "hline" | "vline" };
            const items: LegendItem[] = [];
            const meanDash = ibcs ? "" : "4,3";
            const medDash  = ibcs ? "4,3" : "6,3";

            if (settings.showMean)                 items.push({ label: settings.legendMeanLabel   || DEFAULTS.legendMeanLabel,   color: effectiveMeanColor,   dash: meanDash, w: ibcs ? 2 : 1.5, kind: "hline" });
            if (settings.showMedian)               items.push({ label: settings.legendMedianLabel || DEFAULTS.legendMedianLabel, color: effectiveMedianColor, dash: medDash,  w: 1.5,            kind: "hline" });
            if (settings.showP25)                  items.push({ label: settings.legendP25Label    || DEFAULTS.legendP25Label,    color: effectiveP25Color,    dash: "3,4",    w: 1,              kind: "hline" });
            if (settings.showP75)                  items.push({ label: settings.legendP75Label    || DEFAULTS.legendP75Label,    color: effectiveP75Color,    dash: "3,4",    w: 1,              kind: "hline" });
            if (this.isPro && settings.showNormal) items.push({ label: settings.legendNormalLabel || DEFAULTS.legendNormalLabel, color: settings.normalColor, dash: "",       w: 2,              kind: "hline" });
            if (settings.showBenchmark)            items.push({ label: settings.benchmarkLabel    || "Target",                  color: bmColor,              dash: "",       w: ibcs ? 2.5 : 2, kind: "vline" });

            if (items.length > 0) {
                const fs      = Math.max(8, settings.axisFontSize - 1);
                const iconW   = 16;   // width of icon area
                const iconH   = fs;   // height of icon area (matches text cap height)
                const gap     = 5;    // icon → text
                const itemGap = 16;   // item → item

                // Estimate each item's total width
                const itemWidths = items.map(it => iconW + gap + it.label.length * (fs * 0.56));
                const totalW = itemWidths.reduce((a, b) => a + b, 0) + itemGap * (items.length - 1);

                // Center in plot width; clamp inside bounds
                const lx0 = Math.max(0, (plotW - totalW) / 2);

                // Vertical centre of the legend row
                // top:    just above the plot — sits in the reserved top margin
                // bottom: below the x-axis tick labels (ticks ~3px + label ~fontSize + 4px gap)
                const cy = settings.legendBottom
                    ? plotH + settings.axisFontSize + 22   // clear tick labels + gap
                    : -(legendRowH + 8);                   // above plot with breathing room

                const textFill = isHighContrast
                    ? (this.host.colorPalette.foreground?.value ?? effectiveAxisColor)
                    : effectiveAxisColor;

                let cx = lx0;
                items.forEach((item, i) => {
                    if (item.kind === "vline") {
                        // Vertical bar icon (like "Target" in Bullet)
                        const midX = cx + iconW / 2;
                        g.append("line")
                            .attr("x1", midX).attr("y1", cy - iconH / 2)
                            .attr("x2", midX).attr("y2", cy + iconH / 2)
                            .attr("stroke", item.color).attr("stroke-width", item.w)
                            .attr("pointer-events", "none");
                    } else {
                        // Horizontal line icon
                        g.append("line")
                            .attr("x1", cx).attr("y1", cy)
                            .attr("x2", cx + iconW).attr("y2", cy)
                            .attr("stroke", item.color).attr("stroke-width", item.w)
                            .attr("stroke-dasharray", item.dash || null!)
                            .attr("pointer-events", "none");
                    }
                    g.append("text")
                        .attr("x", cx + iconW + gap)
                        .attr("y", cy + fs * 0.35)   // optical vertical alignment
                        .attr("fill", textFill).attr("font-size", fs)
                        .attr("pointer-events", "none")
                        .text(item.label);
                    cx += itemWidths[i] + itemGap;
                });
            }
        }

        // Free badge
        if (!this.isPro) {
            this.svg.append("rect").attr("x", 0).attr("y", height - 18).attr("width", width).attr("height", 18).attr("fill", "rgba(0,0,0,0.45)");
            this.svg.append("text").attr("x", width / 2).attr("y", height - 5)
                .attr("text-anchor", "middle").attr("fill", "#00E5FF").attr("font-size", 10).attr("font-family", "Segoe UI, sans-serif")
                .text("⬆ Unlock Pro: custom bins, outlier trim, stats, normal curve");
        }
    }

    // ── Landing page ──────────────────────────────────────────────────────────

    private showLandingPage(width: number, height: number): void {
        const cx = width / 2, cy = height / 2;
        const fakeData = [3, 7, 15, 22, 30, 25, 18, 10, 5, 2];
        const barW = Math.min(30, (width * 0.6) / fakeData.length);
        const startX = cx - (fakeData.length * barW) / 2;
        fakeData.forEach((v, i) => {
            const bh = (v / 30) * 60;
            this.svg.append("rect")
                .attr("x", startX + i * barW + 1).attr("y", cy + 30 - bh)
                .attr("width", barW - 2).attr("height", bh)
                .attr("fill", "#00E5FF").attr("fill-opacity", 0.15).attr("rx", 2);
        });
        this.svg.append("text").attr("x", cx).attr("y", cy - 50).attr("text-anchor", "middle")
            .attr("font-size", 16).attr("font-weight", "600").attr("fill", "#E0E6FF").attr("font-family", "Segoe UI, sans-serif").text("Histogram Pro");
        this.svg.append("text").attr("x", cx).attr("y", cy - 30).attr("text-anchor", "middle")
            .attr("font-size", 12).attr("fill", "#B0BEC5").attr("font-family", "Segoe UI, sans-serif").text("Add a numeric field to get started");
    }

    // ── Format Pane ───────────────────────────────────────────────────────────

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const s = this.currentSettings;
        const pro = this.isPro;
        const lbl = (name: string) => pro ? name : `${name} (Pro)`;

        const num = (uid: string, name: string, obj: string, prop: string, val: number) => ({
            uid, displayName: name,
            control: { type: powerbi.visuals.FormattingComponent.NumUpDown, properties: { descriptor: { objectName: obj, propertyName: prop }, value: val } }
        });
        const tog = (uid: string, name: string, obj: string, prop: string, val: boolean) => ({
            uid, displayName: name,
            control: { type: powerbi.visuals.FormattingComponent.ToggleSwitch, properties: { descriptor: { objectName: obj, propertyName: prop }, value: val } }
        });
        const col = (uid: string, name: string, obj: string, prop: string, val: string, conditionalFormatting = false) => ({
            uid, displayName: name,
            control: {
                type: powerbi.visuals.FormattingComponent.ColorPicker,
                properties: {
                    descriptor: {
                        objectName: obj,
                        propertyName: prop,
                        ...(conditionalFormatting ? { instanceKind: powerbi.VisualEnumerationInstanceKinds.ConstantOrRule } : {})
                    },
                    value: { value: val }
                }
            }
        });
        const card = (uid: string, displayName: string, slices: any[]) => ({
            uid, displayName, groups: [{ uid: uid + "_g", displayName: "", slices }]
        });

        return {
            cards: [
                card("ibcs_card", "IBCS", [
                    tog("ibcs_mode", "IBCS mode", "ibcs", "mode", s.ibcsMode),
                ]),
                card("histogram_card", "Histogram", [
                    num("bins",        lbl("Number of bins"), "histogram", "bins",        s.bins),
                    num("trimLower",   lbl("Lower trim %"),   "histogram", "trimLower",   s.trimLower),
                    num("trimUpper",   lbl("Upper trim %"),   "histogram", "trimUpper",   s.trimUpper),
                    col("barColor",    lbl("Bar color"),      "histogram", "barColor",    s.barColor,    true),
                    num("barOpacity",  lbl("Opacity %"),      "histogram", "barOpacity",  s.barOpacity),
                    col("borderColor", lbl("Border color"),   "histogram", "borderColor", s.borderColor),
                    num("borderWidth", lbl("Border width"),   "histogram", "borderWidth", s.borderWidth),
                    num("barGap",      lbl("Bar gap px"),     "histogram", "barGap",      s.barGap),
                ]),
                card("axes_card", "Axes", [
                    col("axisColor",  "Axis color",   "axes", "axisColor",  s.axisColor),
                    col("gridColor",  "Grid color",   "axes", "gridColor",  s.gridColor),
                    num("fontSize",   "Font size",    "axes", "fontSize",   s.axisFontSize),
                    tog("showXLabel", "Show X label", "axes", "showXLabel", s.showXLabel),
                    tog("showYLabel", "Show Y label", "axes", "showYLabel", s.showYLabel),
                ]),
                card("statistics_card", "Statistics", [
                    tog("showMean",    "Show mean",              "statistics", "showMean",    s.showMean),
                    col("meanColor",   "Mean color",             "statistics", "meanColor",   s.meanColor),
                    tog("showMedian",  "Show median",            "statistics", "showMedian",  s.showMedian),
                    col("medianColor", "Median color",           "statistics", "medianColor", s.medianColor),
                    tog("showP25",     "Show P25 (Q1)",          "statistics", "showP25",     s.showP25),
                    col("p25Color",    "P25 line color",         "statistics", "p25Color",    s.p25Color),
                    tog("showP75",     "Show P75 (Q3)",          "statistics", "showP75",     s.showP75),
                    col("p75Color",    "P75 line color",         "statistics", "p75Color",    s.p75Color),
                    tog("showIQR",     "Show IQR range",         "statistics", "showIQR",     s.showIQR),
                    col("iqrColor",    "IQR fill color",         "statistics", "iqrColor",    s.iqrColor),
                    tog("showNormal",  lbl("Normal curve"),      "statistics", "showNormal",  s.showNormal),
                    col("normalColor", lbl("Normal color"),      "statistics", "normalColor", s.normalColor),
                    tog("showStats",   lbl("Stats panel"),       "statistics", "showStats",   s.showStats),
                    col("statsColor",  lbl("Stats text color"),  "statistics", "statsColor",  s.statsColor),
                ]),
                card("benchmark_card", "Benchmark", [
                    tog("bm_show",  "Show benchmark line", "benchmark", "show",  s.showBenchmark),
                    num("bm_value", "Benchmark value",     "benchmark", "value", s.benchmarkValue),
                    col("bm_color", "Line color",          "benchmark", "color", s.benchmarkColor),
                ]),
                card("legend_card", "Legend", [
                    tog("legend_show",   "Show legend",      "legend", "show",   s.showLegend),
                    tog("legend_bottom", "Position: bottom", "legend", "bottom", s.legendBottom),
                    { uid: "leg_mean_lbl",   displayName: "Mean label",   control: { type: powerbi.visuals.FormattingComponent.TextInput, properties: { descriptor: { objectName: "legend", propertyName: "meanLabel"   }, value: s.legendMeanLabel   } } },
                    { uid: "leg_med_lbl",    displayName: "Median label",  control: { type: powerbi.visuals.FormattingComponent.TextInput, properties: { descriptor: { objectName: "legend", propertyName: "medianLabel" }, value: s.legendMedianLabel } } },
                    { uid: "leg_p25_lbl",    displayName: "P25 label",     control: { type: powerbi.visuals.FormattingComponent.TextInput, properties: { descriptor: { objectName: "legend", propertyName: "p25Label"    }, value: s.legendP25Label    } } },
                    { uid: "leg_p75_lbl",    displayName: "P75 label",     control: { type: powerbi.visuals.FormattingComponent.TextInput, properties: { descriptor: { objectName: "legend", propertyName: "p75Label"    }, value: s.legendP75Label    } } },
                    { uid: "leg_normal_lbl", displayName: "Normal label",  control: { type: powerbi.visuals.FormattingComponent.TextInput, properties: { descriptor: { objectName: "legend", propertyName: "normalLabel" }, value: s.legendNormalLabel } } },
                ]),
                card("valueLabels_card", lbl("Value labels"), [
                    tog("vl_show",    lbl("Show"),         "valueLabels", "show",        s.showValueLabels),
                    num("vl_size",    lbl("Font size"),    "valueLabels", "fontSize",    s.vlFontSize),
                    col("vl_color",   lbl("Color"),        "valueLabels", "color",       s.vlColor),
                    tog("vl_percent", lbl("Show percent"), "valueLabels", "showPercent", s.vlShowPercent),
                ]),
            ]
        };
    }

    // ── Destroy ───────────────────────────────────────────────────────────────

    public destroy(): void { this.container.remove(); }
}
