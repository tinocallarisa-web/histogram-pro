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
import VisualUpdateType = powerbi.VisualUpdateType;

// ─── Constants ────────────────────────────────────────────────────────────────

const FREE_MAX_BINS = 10;

const PLAN_ID = "histogram-pro-tcviz"; // Must match Partner Center Plan ID exactly

const DEFAULTS = {
    bins: 10,
    trimLower: 0,
    trimUpper: 0,
    barColor: "#00E5FF",
    barOpacity: 80,
    borderColor: "#0B1437",
    borderWidth: 1,
    barGap: 2,
    axisColor: "#B0BEC5",
    gridColor: "#263238",
    axisFontSize: 10,
    showXLabel: true,
    showYLabel: true,
    showMean: true,
    meanColor: "#FF4081",
    showMedian: true,
    medianColor: "#69F0AE",
    showNormal: false,
    normalColor: "#7C4DFF",
    showStats: true,
    statsColor: "#B0BEC5",
    showValueLabels: false,
    vlFontSize: 9,
    vlColor: "#E0E6FF",
    vlShowPercent: false,
};

// ─── Settings helpers ─────────────────────────────────────────────────────────

function getColor(
    objects: powerbi.DataViewObjects,
    obj: string,
    prop: string,
    fallback: string
): string {
    return objects?.[obj]?.[prop]?.["solid"]?.["color"] ?? fallback;
}

function getValue<T>(
    objects: powerbi.DataViewObjects,
    obj: string,
    prop: string,
    fallback: T
): T {
    const v = objects?.[obj]?.[prop];
    return v == null ? fallback : (v as T);
}

interface Settings {
    // Histogram
    bins: number;
    trimLower: number;
    trimUpper: number;
    barColor: string;
    barOpacity: number;
    borderColor: string;
    borderWidth: number;
    barGap: number;
    // Axes
    axisColor: string;
    gridColor: string;
    axisFontSize: number;
    showXLabel: boolean;
    showYLabel: boolean;
    // Statistics
    showMean: boolean;
    meanColor: string;
    showMedian: boolean;
    medianColor: string;
    showNormal: boolean;
    normalColor: string;
    showStats: boolean;
    statsColor: string;
    // Value labels
    showValueLabels: boolean;
    vlFontSize: number;
    vlColor: string;
    vlShowPercent: boolean;
}

function parseSettings(dataView: DataView): Settings {
    const obj = dataView?.metadata?.objects;
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
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
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

// ─── Visual ───────────────────────────────────────────────────────────────────

export class Visual implements IVisual {
    private host: IVisualHost;
    private container: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private events: IVisualEventService;
    private tooltipService: ITooltipService;
    private selectionManager: ISelectionManager;

    private isPro: boolean = false;
    private hasData: boolean = false;
    private currentSettings: Settings = { ...DEFAULTS } as Settings;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.tooltipService = options.host.tooltipService;
        this.selectionManager = options.host.createSelectionManager();

        this.container = d3
            .select(options.element)
            .append("div")
            .classed("histogram-pro-container", true)
            .style("width", "100%")
            .style("height", "100%")
            .style("position", "relative");

        this.svg = this.container.append("svg");

        // Start license check (async, non-blocking)
        this.checkLicense();
    }

    // ── License ──────────────────────────────────────────────────────────────

    private async checkLicense(): Promise<void> {
        try {
            const licenseManager = this.host.licenseManager;
            if (!licenseManager) { this.isPro = false; return; }
            const result = await licenseManager.getAvailableServicePlans();
            this.isPro = result?.plans?.some(
                (p) => p.spIdentifier === PLAN_ID && p.state === ServicePlanState.Active
            ) ?? false;
        } catch {
            this.isPro = false;
        }
    }

    // ── Update ────────────────────────────────────────────────────────────────

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);
        try {
            this.render(options);
            this.events.renderingFinished(options);
        } catch (e) {
            this.events.renderingFailed(options, String(e));
            console.error("[HistogramPro] render error:", e);
        }
    }

    private render(options: VisualUpdateOptions): void {
        const dataView = options.dataViews?.[0];
        const width = options.viewport.width;
        const height = options.viewport.height;

        this.svg.selectAll("*").remove();
        this.svg.attr("width", width).attr("height", height);

        // Landing page — no data yet
        if (!dataView?.categorical?.values?.[0]) {
            this.hasData = false;
            this.showLandingPage(width, height);
            return;
        }
        this.hasData = true;

        const settings = parseSettings(dataView);
        this.currentSettings = settings;

        // Apply Pro enforcement on bins
        const effectiveBins = this.isPro
            ? Math.max(2, Math.min(100, settings.bins || DEFAULTS.bins))
            : FREE_MAX_BINS;

        // Extract raw values + build selection IDs per row
        const raw: number[] = [];
        const rawWithIds: Array<{ value: number; selId: powerbi.extensibility.ISelectionId }> = [];
        const rawValues = dataView.categorical.values[0].values;
        const categories = dataView.categorical.categories?.[0];

        for (let i = 0; i < rawValues.length; i++) {
            const v = rawValues[i];
            if (v != null && isFinite(+v)) {
                const builder = this.host.createSelectionIdBuilder();
                if (categories) builder.withCategory(categories, i);
                const selId = builder.createSelectionId();
                raw.push(+v);
                rawWithIds.push({ value: +v, selId });
            }
        }
        if (raw.length < 2) return;

        raw.sort((a, b) => a - b);
        const n = raw.length;

        // Outlier trimming (Pro only)
        const loVal =
            this.isPro && settings.trimLower > 0
                ? percentile(raw, settings.trimLower)
                : raw[0];
        const hiVal =
            this.isPro && settings.trimUpper > 0
                ? percentile(raw, 100 - settings.trimUpper)
                : raw[n - 1];

        const data = raw.filter((v) => v >= loVal && v <= hiVal);
        if (data.length < 2) return;

        const nFiltered = data.length;
        const mean = data.reduce((s, v) => s + v, 0) / nFiltered;
        const median = percentile(data, 50);
        const std = Math.sqrt(data.reduce((s, v) => s + (v - mean) ** 2, 0) / nFiltered);
        const dMin = data[0];
        const dMax = data[data.length - 1];

        // Layout margins
        const marginL = settings.showYLabel ? 52 : 38;
        const marginR = 16;
        const marginT = 16;
        const marginB = settings.showXLabel ? 46 : 32;
        const plotW = Math.max(20, width - marginL - marginR);
        const plotH = Math.max(20, height - marginT - marginB);

        // Scales
        const xScale = d3.scaleLinear().domain([dMin, dMax]).range([0, plotW]).nice();
        const xDomain = xScale.domain();

        // Histogram bins
        const binner = d3
            .bin()
            .domain(xDomain as [number, number])
            .thresholds(d3.range(xDomain[0], xDomain[1], (xDomain[1] - xDomain[0]) / effectiveBins));
        const bins = binner(data);
        const maxCount = d3.max(bins, (b) => b.length) || 1;

        // Map each bin to its selection IDs (for filter-out)
        const binSelectionIds: powerbi.extensibility.ISelectionId[][] = bins.map(bin =>
            rawWithIds
                .filter(d => d.value >= (bin.x0 ?? -Infinity) && d.value < (bin.x1 ?? Infinity))
                .map(d => d.selId)
        );
        const yScale = d3.scaleLinear().domain([0, maxCount]).range([plotH, 0]).nice();

        // SVG group
        const g = this.svg
            .append("g")
            .attr("transform", `translate(${marginL},${marginT})`);

        // Grid lines
        g.append("g")
            .attr("class", "grid")
            .call(
                d3
                    .axisLeft(yScale)
                    .tickSize(-plotW)
                    .tickFormat(() => "")
                    .ticks(5)
            )
            .call((sel) => {
                sel.select(".domain").remove();
                sel.selectAll("line")
                    .attr("stroke", settings.gridColor)
                    .attr("stroke-dasharray", "2,3")
                    .attr("opacity", 0.5);
            });

        // Bar gap
        const gap = this.isPro ? Math.max(0, settings.barGap) : 1;

        // Bars
        const barOpacity = (this.isPro ? Math.min(100, Math.max(0, settings.barOpacity)) : 80) / 100;
        const barColor = this.isPro ? settings.barColor : DEFAULTS.barColor;
        const borderColor = this.isPro ? settings.borderColor : DEFAULTS.borderColor;
        const borderWidth = this.isPro ? settings.borderWidth : DEFAULTS.borderWidth;

        // Click on empty space clears selection
        this.svg.on("click", () => {
            this.selectionManager.clear();
        });

        const barsG = g.append("g").attr("class", "bars");
        bins.forEach((bin, binIndex) => {
            if (bin.x0 == null || bin.x1 == null) return;
            const bx = xScale(bin.x0) + gap / 2;
            const bw = Math.max(0, xScale(bin.x1) - xScale(bin.x0) - gap);
            const by = yScale(bin.length);
            const bh = plotH - yScale(bin.length);
            if (bw <= 0 || bh <= 0) return;

            const ids = binSelectionIds[binIndex] || [];

            barsG
                .append("rect")
                .attr("x", bx)
                .attr("y", by)
                .attr("width", bw)
                .attr("height", bh)
                .attr("fill", barColor)
                .attr("fill-opacity", barOpacity)
                .attr("stroke", borderColor)
                .attr("stroke-width", borderWidth)
                .style("cursor", "pointer")
                .on("click", (event: MouseEvent) => {
                    event.stopPropagation();
                    this.selectionManager.select(ids, (event as MouseEvent).ctrlKey);
                })
                .on("contextmenu", (event: MouseEvent) => {
                    event.preventDefault();
                    const contextMenu = (this.host as any).contextMenuService;
                    if (contextMenu) {
                        contextMenu.show({
                            dataItems: ids.length > 0 ? [{ displayName: "Range", value: `${fmtNum(bin.x0!)} – ${fmtNum(bin.x1!)}` }] : [],
                            identities: ids,
                            coordinates: [event.clientX, event.clientY],
                            isTouchEvent: false,
                        });
                    }
                })
                .on("mouseover", (event: MouseEvent) => {
                    this.tooltipService.show({
                        dataItems: [
                            { displayName: "Range", value: `${fmtNum(bin.x0!)} – ${fmtNum(bin.x1!)}` },
                            { displayName: "Count", value: String(bin.length) },
                            { displayName: "% of total", value: `${((bin.length / nFiltered) * 100).toFixed(1)}%` },
                        ],
                        identities: ids,
                        coordinates: [event.clientX, event.clientY],
                        isTouchEvent: false,
                    });
                })
                .on("mousemove", (event: MouseEvent) => {
                    this.tooltipService.move({
                        coordinates: [event.clientX, event.clientY],
                        isTouchEvent: false,
                        identities: ids,
                    });
                })
                .on("mouseout", () => {
                    this.tooltipService.hide({ immediately: false, isTouchEvent: false });
                });

            // Value labels (Pro only)
            if (this.isPro && settings.showValueLabels && bh > 14) {
                const labelVal = settings.vlShowPercent
                    ? `${((bin.length / nFiltered) * 100).toFixed(1)}%`
                    : String(bin.length);
                barsG
                    .append("text")
                    .attr("x", bx + bw / 2)
                    .attr("y", by - 3)
                    .attr("text-anchor", "middle")
                    .attr("font-size", settings.vlFontSize)
                    .attr("fill", settings.vlColor)
                    .text(labelVal);
            }
        });

        // X axis
        g.append("g")
            .attr("transform", `translate(0,${plotH})`)
            .call(
                d3
                    .axisBottom(xScale)
                    .tickFormat((d) => fmtNum(+d))
                    .ticks(Math.min(effectiveBins, 8))
            )
            .call((sel) => {
                sel.select(".domain").attr("stroke", settings.axisColor);
                sel.selectAll("text")
                    .attr("fill", settings.axisColor)
                    .attr("font-size", settings.axisFontSize);
                sel.selectAll(".tick line").attr("stroke", settings.axisColor);
            });

        // Y axis
        g.append("g")
            .call(d3.axisLeft(yScale).ticks(5).tickFormat((d) => fmtNum(+d)))
            .call((sel) => {
                sel.select(".domain").attr("stroke", settings.axisColor);
                sel.selectAll("text")
                    .attr("fill", settings.axisColor)
                    .attr("font-size", settings.axisFontSize);
                sel.selectAll(".tick line").attr("stroke", settings.axisColor);
            });

        // Axis labels
        if (settings.showYLabel) {
            g.append("text")
                .attr("transform", "rotate(-90)")
                .attr("x", -plotH / 2)
                .attr("y", -marginL + 12)
                .attr("text-anchor", "middle")
                .attr("font-size", settings.axisFontSize)
                .attr("fill", settings.axisColor)
                .text("Count");
        }
        if (settings.showXLabel) {
            g.append("text")
                .attr("x", plotW / 2)
                .attr("y", plotH + marginB - 6)
                .attr("text-anchor", "middle")
                .attr("font-size", settings.axisFontSize)
                .attr("fill", settings.axisColor)
                .text("Value");
        }

        // Mean line
        if (settings.showMean && mean >= xDomain[0] && mean <= xDomain[1]) {
            const mx = xScale(mean);
            g.append("line")
                .attr("x1", mx).attr("y1", 0)
                .attr("x2", mx).attr("y2", plotH)
                .attr("stroke", settings.meanColor)
                .attr("stroke-width", 1.5)
                .attr("stroke-dasharray", "4,3");
            g.append("text")
                .attr("x", mx + 4)
                .attr("y", 10)
                .attr("fill", settings.meanColor)
                .attr("font-size", settings.axisFontSize)
                .text(`μ ${fmtNum(mean)}`);
        }

        // Median line
        if (settings.showMedian && median >= xDomain[0] && median <= xDomain[1]) {
            const mdx = xScale(median);
            g.append("line")
                .attr("x1", mdx).attr("y1", 0)
                .attr("x2", mdx).attr("y2", plotH)
                .attr("stroke", settings.medianColor)
                .attr("stroke-width", 1.5)
                .attr("stroke-dasharray", "6,3");
            g.append("text")
                .attr("x", mdx + 4)
                .attr("y", 24)
                .attr("fill", settings.medianColor)
                .attr("font-size", settings.axisFontSize)
                .text(`M ${fmtNum(median)}`);
        }

        // Normal curve (Pro only)
        if (this.isPro && settings.showNormal && std > 0) {
            const normalLine = d3
                .line<number>()
                .x((d) => xScale(d))
                .y((d) => {
                    const density =
                        (1 / (std * Math.sqrt(2 * Math.PI))) *
                        Math.exp(-0.5 * ((d - mean) / std) ** 2);
                    // Scale density to match histogram height
                    const binWidth = (xDomain[1] - xDomain[0]) / effectiveBins;
                    const scaledCount = density * nFiltered * binWidth;
                    return yScale(scaledCount);
                })
                .curve(d3.curveBasis);

            const normalPoints = d3.range(
                xDomain[0],
                xDomain[1],
                (xDomain[1] - xDomain[0]) / 200
            );

            g.append("path")
                .datum(normalPoints)
                .attr("fill", "none")
                .attr("stroke", settings.normalColor)
                .attr("stroke-width", 2)
                .attr("d", normalLine);
        }

        // Statistics panel (Pro only)
        if (this.isPro && settings.showStats) {
            const statsLines = [
                `n = ${nFiltered}${n > nFiltered ? ` (${n - nFiltered} trimmed)` : ""}`,
                `μ = ${fmtNum(mean)}`,
                `M = ${fmtNum(median)}`,
                `σ = ${fmtNum(std)}`,
                `min = ${fmtNum(dMin)}`,
                `max = ${fmtNum(dMax)}`,
            ];
            const panelX = plotW - 110;
            const panelY = 8;
            const lineH = settings.axisFontSize + 3;

            g.append("rect")
                .attr("x", panelX - 6)
                .attr("y", panelY - 4)
                .attr("width", 116)
                .attr("height", statsLines.length * lineH + 6)
                .attr("fill", "rgba(0,0,0,0.35)")
                .attr("rx", 4);

            statsLines.forEach((line, i) => {
                g.append("text")
                    .attr("x", panelX)
                    .attr("y", panelY + i * lineH + settings.axisFontSize)
                    .attr("fill", settings.statsColor)
                    .attr("font-size", settings.axisFontSize)
                    .attr("font-family", "monospace")
                    .text(line);
            });
        }

        // Free tier badge (when not Pro)
        if (!this.isPro) {
            const badgeG = this.svg.append("g");
            const badgeText = "⬆ Unlock Pro: custom bins, outlier trim, stats, normal curve";
            badgeG
                .append("rect")
                .attr("x", 0)
                .attr("y", height - 18)
                .attr("width", width)
                .attr("height", 18)
                .attr("fill", "rgba(0,0,0,0.45)");
            badgeG
                .append("text")
                .attr("x", width / 2)
                .attr("y", height - 5)
                .attr("text-anchor", "middle")
                .attr("fill", "#00E5FF")
                .attr("font-size", 10)
                .attr("font-family", "Segoe UI, sans-serif")
                .text(badgeText);
        }
    }

    // ── Landing page ──────────────────────────────────────────────────────────

    private showLandingPage(width: number, height: number): void {
        const cx = width / 2;
        const cy = height / 2;

        // Background histogram illustration
        const fakeData = [3, 7, 15, 22, 30, 25, 18, 10, 5, 2];
        const maxH = 30;
        const barW = Math.min(30, (width * 0.6) / fakeData.length);
        const startX = cx - (fakeData.length * barW) / 2;
        const baseY = cy + 30;

        fakeData.forEach((v, i) => {
            const bh = (v / maxH) * 60;
            this.svg
                .append("rect")
                .attr("x", startX + i * barW + 1)
                .attr("y", baseY - bh)
                .attr("width", barW - 2)
                .attr("height", bh)
                .attr("fill", "#00E5FF")
                .attr("fill-opacity", 0.15)
                .attr("rx", 2);
        });

        this.svg
            .append("text")
            .attr("x", cx)
            .attr("y", cy - 50)
            .attr("text-anchor", "middle")
            .attr("font-size", 16)
            .attr("font-weight", "600")
            .attr("fill", "#E0E6FF")
            .attr("font-family", "Segoe UI, sans-serif")
            .text("Histogram Pro");

        this.svg
            .append("text")
            .attr("x", cx)
            .attr("y", cy - 30)
            .attr("text-anchor", "middle")
            .attr("font-size", 12)
            .attr("fill", "#B0BEC5")
            .attr("font-family", "Segoe UI, sans-serif")
            .text("Add a numeric field to get started");
    }

    // ── Format Pane (pbiviz v7 API) ───────────────────────────────────────────

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const s = this.currentSettings;
        const isPro = this.isPro;
        const proLabel = (name: string) => isPro ? name : `${name} (Pro)`;

        const num = (uid: string, name: string, obj: string, prop: string, val: number) => ({
            uid, displayName: name,
            control: {
                type: powerbi.visuals.FormattingComponent.NumUpDown,
                properties: { descriptor: { objectName: obj, propertyName: prop }, value: val }
            }
        });
        const tog = (uid: string, name: string, obj: string, prop: string, val: boolean) => ({
            uid, displayName: name,
            control: {
                type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                properties: { descriptor: { objectName: obj, propertyName: prop }, value: val }
            }
        });
        const col = (uid: string, name: string, obj: string, prop: string, val: string) => ({
            uid, displayName: name,
            control: {
                type: powerbi.visuals.FormattingComponent.ColorPicker,
                properties: { descriptor: { objectName: obj, propertyName: prop }, value: { value: val } }
            }
        });

        const card = (uid: string, displayName: string, slices: any[]) => ({
            uid, displayName,
            groups: [{ uid: uid + "_group", displayName: "", slices }]
        });

        return {
            cards: [
                card("histogram_card", "Histogram", [
                    num("bins",        proLabel("Number of bins"),  "histogram", "bins",        s.bins),
                    num("trimLower",   proLabel("Lower trim %"),    "histogram", "trimLower",   s.trimLower),
                    num("trimUpper",   proLabel("Upper trim %"),    "histogram", "trimUpper",   s.trimUpper),
                    col("barColor",    proLabel("Bar color"),       "histogram", "barColor",    s.barColor),
                    num("barOpacity",  proLabel("Opacity %"),       "histogram", "barOpacity",  s.barOpacity),
                    col("borderColor", proLabel("Border color"),    "histogram", "borderColor", s.borderColor),
                    num("borderWidth", proLabel("Border width"),    "histogram", "borderWidth", s.borderWidth),
                    num("barGap",      proLabel("Bar gap px"),      "histogram", "barGap",      s.barGap),
                ]),
                card("axes_card", "Axes", [
                    col("axisColor",   "Axis color",   "axes", "axisColor",  s.axisColor),
                    col("gridColor",   "Grid color",   "axes", "gridColor",  s.gridColor),
                    num("fontSize",    "Font size",    "axes", "fontSize",   s.axisFontSize),
                    tog("showXLabel",  "Show X label", "axes", "showXLabel", s.showXLabel),
                    tog("showYLabel",  "Show Y label", "axes", "showYLabel", s.showYLabel),
                ]),
                card("statistics_card", "Statistics", [
                    tog("showMean",    "Show mean",                  "statistics", "showMean",    s.showMean),
                    col("meanColor",   "Mean color",                 "statistics", "meanColor",   s.meanColor),
                    tog("showMedian",  "Show median",                "statistics", "showMedian",  s.showMedian),
                    col("medianColor", "Median color",               "statistics", "medianColor", s.medianColor),
                    tog("showNormal",  proLabel("Normal curve"),     "statistics", "showNormal",  s.showNormal),
                    col("normalColor", proLabel("Normal color"),     "statistics", "normalColor", s.normalColor),
                    tog("showStats",   proLabel("Stats panel"),      "statistics", "showStats",   s.showStats),
                    col("statsColor",  proLabel("Stats text color"), "statistics", "statsColor",  s.statsColor),
                ]),
                card("valueLabels_card", proLabel("Value labels"), [
                    tog("vl_show",    proLabel("Show"),         "valueLabels", "show",        s.showValueLabels),
                    num("vl_size",    proLabel("Font size"),    "valueLabels", "fontSize",    s.vlFontSize),
                    col("vl_color",   proLabel("Color"),        "valueLabels", "color",       s.vlColor),
                    tog("vl_percent", proLabel("Show percent"), "valueLabels", "showPercent", s.vlShowPercent),
                ]),
            ]
        };
    }

    // ── Destroy ───────────────────────────────────────────────────────────────

    public destroy(): void {
        this.container.remove();
    }
}
