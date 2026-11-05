"use strict";

import { STRINGS } from "./strings";
import powerbi from "powerbi-visuals-api";
import * as d3 from "d3";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ITooltipService = powerbi.extensibility.ITooltipService;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ServicePlanState = powerbi.ServicePlanState;
import DataView = powerbi.DataView;
import ILocalizationManager = powerbi.extensibility.ILocalizationManager;
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";
import {
    HtmlSubSelectableClass, HtmlSubSelectionHelper, SubSelectableDisplayNameAttribute,
    SubSelectableObjectNameAttribute, SubSelectableTypeAttribute,
} from "powerbi-visuals-utils-onobjectutils";

// ─── Constants ────────────────────────────────────────────────────────────────

const FREE_MAX_BINS = 10;
// Un BasicFilter se convierte en un IN() de DAX y el coste crece con el numero
// de valores. Medido en Pareto Chart Pro sobre un modelo de 500.000 entidades
// en el Servicio, con claves enteras: 10.000 va fluido en importado y lento
// pero usable en conexion viva; 25.000 es inusable; 50.000 cuelga el informe.
// El tope sigue la cifra de conexion viva, que es la lenta y la que usan los
// despliegues reales. Las claves de texto pesan mas por valor, asi que su techo
// real es aun menor.
//
// Filtrar un subconjunto en su lugar seria una respuesta silenciosamente falsa,
// asi que a partir de aqui el visual declina y dice que palanca lo arregla.
const MAX_FILTER_VALUES = 10000;
// Solo en el camino de respaldo: los selection IDs son pesados, asi que pocos.
const MAX_SEL_IDS_PER_BIN = 100;
const PLAN_ID = "histogram-pro-tcviz";

/**
 * spIdentifier es el Service ID completo que genera Partner Center para el plan
 * ("editor.oferta.plan", p.ej. "tino_callarisa.<oferta>.histogram-pro-tcviz"), no el Plan ID
 * corto: lo dice la documentacion de la licensing API. Comparar con === PLAN_ID dejaba en
 * Free a quien pagaba. Se acepta el Service ID que termina en ".<plan>" y tambien el Plan ID.
 */
function matchesPlan(spIdentifier: unknown, planId: string): boolean {
    const sp = String(spIdentifier ?? "");
    return sp === planId || sp.endsWith("." + planId);
}

const BASE_DEFAULTS = {
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
    bmColorBars: false, bmAboveColor: "#FF6B6B", bmBelowColor: "#00E5FF",
    zShow: false, zCut1: 0, zCut2: 0, zColor1: "#69F0AE", zColor2: "#FFD740", zColor3: "#FF6B6B",
    zLabels: true, zValueShare: true, zLabelBg: "", zLabelBgOpacity: 75, zLabelColor: "", zLabelSize: 0,
    smColumns: 0, smGap: 14, smTitleSize: 12, smTitleColor: "#6B7785", smTitleBold: true, smTitleAlign: "left",
    smBackground: "", smBorder: false, smBorderColor: "#E1DFDD",
    statsBgColor: "#000000", statsBgOpacity: 35, labelBgColor: "#FFFFFF", labelBgOpacity: 75,
    legendFontSize: 9, legendColor: "#B0BEC5",
    showLegend: false, legendBottom: false,
    legendMeanLabel: "Mean", legendMedianLabel: "Median", legendP25Label: "P25", legendP75Label: "P75", legendNormalLabel: "Normal",
    ibcsMode: false,
    showNormal: false, normalColor: "#7C4DFF",
    showCumulative: false, cumulativeColor: "#FF9F43",
    showStats: true, statsColor: "#B0BEC5",
    showValueLabels: false, vlFontSize: 9, vlColor: "#E0E6FF", vlShowPercent: false,
    template: "report", rangeShow: true, rangeShortcuts: true, rangeColor: "", rangeInColor: "", rangeOutColor: "",
};

// ─── Style templates ──────────────────────────────────────────────────────────
// A style only fills what the user has not set. The default since 1.5 is the report's theme, as
// in a native visual (Tino, 04-11-2026); Classic is the look of earlier versions. The fonts are
// system fonts: a visual cannot count on any other being installed.

// dim: strength of the bars outside a range. On a dark background the usual 0.25 turns them muddy.
interface StyleLook { bg?: string; grad?: [string, string, string]; font?: string; accent: string; dim?: number; values: Partial<Settings>; }

const lines = (mean: string, median: string, q: string, iqr: string, normal: string, cum: string, target: string) => ({
    meanColor: mean, medianColor: median, p25Color: q, p75Color: q, iqrColor: iqr, normalColor: normal, cumulativeColor: cum, benchmarkColor: target,
});

interface RangeState { rLo: number; rHi: number; rActLo: number; rActHi: number; rActive: boolean; }
/** What a range paints in one panel: its bars have their own scale, the range is the same in all. */
interface RangePanel {
    g: d3.Selection<SVGGElement, unknown, null, undefined>; barsG: d3.Selection<SVGGElement, unknown, null, undefined>;
    xScale: d3.ScaleLinear<number, number>; plotH: number;
    bars: { x: number; y: number; w: number; h: number; fill: string }[];
}
interface RangeArgs extends RangeState {
    plotW: number; y: number; xScale: d3.ScaleLinear<number, number>; dom: number[];
    rows: { value: number; origIndex: number }[]; data: number[]; sum: number;
    panels: RangePanel[];
    left: number; top: number; inColor: string; outColor: string;
    barOpacity: number; dim: number; shortcutsOn: boolean; step: number;
    stroke: string; strokeW: number; hc: boolean; axisColor: string; gridColor: string; accent: string;
    fmt: (v: number) => string; fs: number;
}

const STYLES: Record<string, StyleLook> = {
    classic: { accent: "#0B7285", values: {} },
    boardroom: { bg: "#16263D", accent: "#C9A45C", dim: 0.4, values: {
        barColor: "#C9A45C", borderColor: "#16263D", axisColor: "#9FB0C6", gridColor: "#2A3E5C",
        ...lines("#F2F0E8", "#6FCF97", "#9FB0C6", "#C9A45C", "#8FB8E8", "#6FCF97", "#EB8A7B"),
        bmAboveColor: "#6FCF97", bmBelowColor: "#EB8A7B", zColor1: "#6FCF97", zColor2: "#C9A45C", zColor3: "#EB8A7B",
        smTitleColor: "#F2F0E8", statsBgColor: "#0F1B2D", statsBgOpacity: 90, statsColor: "#F2F0E8",
        labelBgColor: "#0F1B2D", labelBgOpacity: 85, legendColor: "#9FB0C6", vlColor: "#F2F0E8" } },
    ledger: { bg: "#FBF8EF", font: "Georgia, serif", accent: "#7A1F1F", values: {
        barColor: "#3A3528", borderColor: "#FBF8EF", axisColor: "#6E6652", gridColor: "#D9D2BE",
        ...lines("#7A1F1F", "#2F6B3B", "#6E6652", "#B7AD92", "#946A10", "#2F6B3B", "#7A1F1F"),
        bmAboveColor: "#2F6B3B", bmBelowColor: "#A32A2A", zColor1: "#2F6B3B", zColor2: "#946A10", zColor3: "#A32A2A",
        smTitleColor: "#231F16", statsBgColor: "#F6F1E4", statsBgOpacity: 95, statsColor: "#231F16",
        labelBgColor: "#FBF8EF", labelBgOpacity: 90, legendColor: "#6E6652", vlColor: "#231F16" } },
    editorial: { bg: "#FFFFFF", font: "Georgia, serif", accent: "#D7263D", values: {
        barColor: "#111111", borderColor: "#FFFFFF", axisColor: "#5F5F5F", gridColor: "#E2E2E2",
        ...lines("#D7263D", "#111111", "#5F5F5F", "#BDBDBD", "#5F5F5F", "#D7263D", "#D7263D"),
        bmAboveColor: "#111111", bmBelowColor: "#D7263D", zColor1: "#BDBDBD", zColor2: "#5F5F5F", zColor3: "#D7263D",
        smTitleColor: "#111111", statsBgColor: "#FFFFFF", statsBgOpacity: 92, statsColor: "#111111",
        labelBgColor: "#FFFFFF", labelBgOpacity: 90, legendColor: "#5F5F5F", vlColor: "#111111" } },
    signal: { bg: "#FFFFFF", accent: "#1F7A4D", values: {
        barColor: "#14202B", borderColor: "#FFFFFF", axisColor: "#566472", gridColor: "#D9DEE4",
        ...lines("#1F7A4D", "#B7791F", "#566472", "#9AA5B1", "#566472", "#1F7A4D", "#C0392B"),
        bmAboveColor: "#1F7A4D", bmBelowColor: "#C0392B", zColor1: "#1F7A4D", zColor2: "#B7791F", zColor3: "#C0392B",
        smTitleColor: "#14202B", statsBgColor: "#EEF1F4", statsBgOpacity: 95, statsColor: "#14202B",
        labelBgColor: "#FFFFFF", labelBgOpacity: 90, legendColor: "#566472", vlColor: "#14202B" } },
    aurora: { grad: ["#1B1147", "#10395E", "#0B5A5E"], accent: "#7CE7D0", dim: 0.4, values: {
        barColor: "#7CE7D0", borderColor: "#10395E", axisColor: "#C5D3E3", gridColor: "#3A5C7E",
        ...lines("#FFFFFF", "#FFD27D", "#C5D3E3", "#7CE7D0", "#FF9DB0", "#FFD27D", "#FF9DB0"),
        bmAboveColor: "#7CE7D0", bmBelowColor: "#FF9DB0", zColor1: "#7CE7D0", zColor2: "#FFD27D", zColor3: "#FF9DB0",
        smTitleColor: "#FFFFFF", statsBgColor: "#10395E", statsBgOpacity: 85, statsColor: "#FFFFFF",
        labelBgColor: "#10395E", labelBgOpacity: 80, legendColor: "#C5D3E3", vlColor: "#FFFFFF" } },
    terrace: { bg: "#FBF5EC", accent: "#B5532A", values: {
        barColor: "#B5532A", borderColor: "#FBF5EC", axisColor: "#7A6450", gridColor: "#E5D6C2",
        ...lines("#3A2A1E", "#5E7128", "#7A6450", "#C9A77E", "#5E7128", "#5E7128", "#B5372A"),
        bmAboveColor: "#5E7128", bmBelowColor: "#B5372A", zColor1: "#5E7128", zColor2: "#B5782A", zColor3: "#B5372A",
        smTitleColor: "#3A2A1E", statsBgColor: "#EFE3D3", statsBgOpacity: 95, statsColor: "#3A2A1E",
        labelBgColor: "#FBF5EC", labelBgOpacity: 90, legendColor: "#7A6450", vlColor: "#3A2A1E" } },
};

const DEFAULTS = BASE_DEFAULTS;

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

/**
 * "Report theme": the colours of the report's own theme, so the visual sits with a client's
 * corporate look without anyone picking colours. No background of its own: Power BI paints it.
 */
function reportLook(host: IVisualHost): StyleLook {
    const pal: any = host.colorPalette;
    const fg: string = pal.foreground?.value ?? "#252423";
    const soft: string = pal.foregroundNeutralSecondary?.value ?? fg;
    const line: string = pal.backgroundNeutral?.value ?? pal.backgroundLight?.value ?? "#E1DFDD";
    const panel: string = pal.background?.value ?? "#FFFFFF";
    const c = (k: string) => pal.getColor(k).value as string;
    const bar = c("hp-bars"), c2 = c("hp-2"), c3 = c("hp-3"), c4 = c("hp-4");
    return { accent: bar, values: {
        barColor: bar, borderColor: panel, axisColor: soft, gridColor: line,
        ...lines(fg, c2, soft, bar, c3, c2, c4),
        bmAboveColor: bar, bmBelowColor: c4, zColor1: c2, zColor2: c3, zColor3: c4,
        smTitleColor: fg, statsBgColor: panel, statsBgOpacity: 90, statsColor: fg,
        labelBgColor: panel, labelBgOpacity: 85, legendColor: soft, vlColor: fg } };
}

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
    bmColorBars: boolean; bmAboveColor: string; bmBelowColor: string;
    zShow: boolean; zCut1: number; zCut2: number; zColor1: string; zColor2: string; zColor3: string;
    zLabels: boolean; zValueShare: boolean; zLabelBg: string; zLabelBgOpacity: number; zLabelColor: string; zLabelSize: number;
    smColumns: number; smGap: number; smTitleSize: number; smTitleColor: string; smTitleBold: boolean; smTitleAlign: string;
    smBackground: string; smBorder: boolean; smBorderColor: string;
    statsBgColor: string; statsBgOpacity: number; labelBgColor: string; labelBgOpacity: number;
    legendFontSize: number; legendColor: string;
    showLegend: boolean; legendBottom: boolean;
    legendMeanLabel: string; legendMedianLabel: string; legendP25Label: string; legendP75Label: string; legendNormalLabel: string;
    ibcsMode: boolean;
    showNormal: boolean; normalColor: string;
    showCumulative: boolean; cumulativeColor: string;
    showStats: boolean; statsColor: string;
    showValueLabels: boolean; vlFontSize: number; vlColor: string; vlShowPercent: boolean;
    template: string; rangeShow: boolean; rangeShortcuts: boolean; rangeColor: string; rangeInColor: string; rangeOutColor: string;
}

function getColor(obj: powerbi.DataViewObjects, o: string, p: string, fb: string): string {
    return obj?.[o]?.[p]?.["solid"]?.["color"] || fb;
}
function getValue<T>(obj: powerbi.DataViewObjects, o: string, p: string, fb: T): T {
    const v = obj?.[o]?.[p]; return v == null ? fb : v as T;
}

function parseSettings(dv: DataView, styleOk: boolean): Settings {
    const obj = dv?.metadata?.objects;
    const template = String(getValue<string>(obj, "style", "template", BASE_DEFAULTS.template));
    // Without Pro the style is the report's theme, whatever is stored: the choice comes back with the licence.
    const DEFAULTS: typeof BASE_DEFAULTS = { ...BASE_DEFAULTS, ...STYLES[styleOk ? template : "report"]?.values };
    return {
        template,
        rangeShow: getValue<boolean>(obj, "rangeBar", "show", DEFAULTS.rangeShow),
        rangeShortcuts: getValue<boolean>(obj, "rangeBar", "shortcuts", DEFAULTS.rangeShortcuts),
        rangeColor: getColor(obj, "rangeBar", "color", DEFAULTS.rangeColor),
        rangeInColor: getColor(obj, "rangeBar", "inColor", DEFAULTS.rangeInColor),
        rangeOutColor: getColor(obj, "rangeBar", "outColor", DEFAULTS.rangeOutColor),
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
        bmColorBars: getValue<boolean>(obj, "benchmark", "colorBars", DEFAULTS.bmColorBars),
        bmAboveColor: getColor(obj, "benchmark", "aboveColor", DEFAULTS.bmAboveColor),
        bmBelowColor: getColor(obj, "benchmark", "belowColor", DEFAULTS.bmBelowColor),
        zShow: getValue<boolean>(obj, "zones", "show", DEFAULTS.zShow),
        zCut1: getValue<number>(obj, "zones", "cut1", DEFAULTS.zCut1),
        zCut2: getValue<number>(obj, "zones", "cut2", DEFAULTS.zCut2),
        zColor1: getColor(obj, "zones", "color1", DEFAULTS.zColor1),
        zColor2: getColor(obj, "zones", "color2", DEFAULTS.zColor2),
        zColor3: getColor(obj, "zones", "color3", DEFAULTS.zColor3),
        zLabels: getValue<boolean>(obj, "zones", "showLabels", DEFAULTS.zLabels),
        zValueShare: getValue<boolean>(obj, "zones", "showValueShare", DEFAULTS.zValueShare),
        zLabelBg: getColor(obj, "zones", "labelBg", DEFAULTS.zLabelBg),
        zLabelBgOpacity: getValue<number>(obj, "zones", "labelBgOpacity", DEFAULTS.zLabelBgOpacity),
        zLabelColor: getColor(obj, "zones", "labelColor", DEFAULTS.zLabelColor),
        zLabelSize: getValue<number>(obj, "zones", "labelSize", DEFAULTS.zLabelSize),
        smColumns: getValue<number>(obj, "smallMultiples", "columns", DEFAULTS.smColumns),
        smTitleSize: getValue<number>(obj, "smallMultiples", "titleFontSize", DEFAULTS.smTitleSize),
        smTitleColor: getColor(obj, "smallMultiples", "titleColor", DEFAULTS.smTitleColor),
        smGap: getValue<number>(obj, "smallMultiples", "gap", DEFAULTS.smGap),
        smTitleBold: getValue<boolean>(obj, "smallMultiples", "titleBold", DEFAULTS.smTitleBold),
        smTitleAlign: getValue<string>(obj, "smallMultiples", "titleAlign", DEFAULTS.smTitleAlign),
        smBackground: getColor(obj, "smallMultiples", "background", DEFAULTS.smBackground),
        smBorder: getValue<boolean>(obj, "smallMultiples", "border", DEFAULTS.smBorder),
        smBorderColor: getColor(obj, "smallMultiples", "borderColor", DEFAULTS.smBorderColor),
        statsBgColor: getColor(obj, "statistics", "statsBgColor", DEFAULTS.statsBgColor),
        statsBgOpacity: getValue<number>(obj, "statistics", "statsBgOpacity", DEFAULTS.statsBgOpacity),
        labelBgColor: getColor(obj, "statistics", "labelBgColor", DEFAULTS.labelBgColor),
        labelBgOpacity: getValue<number>(obj, "statistics", "labelBgOpacity", DEFAULTS.labelBgOpacity),
        legendFontSize: getValue<number>(obj, "legend", "fontSize", DEFAULTS.legendFontSize),
        legendColor: getColor(obj, "legend", "color", DEFAULTS.legendColor),
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
        showCumulative: getValue<boolean>(obj, "statistics", "showCumulative", DEFAULTS.showCumulative),
        cumulativeColor: getColor(obj, "statistics", "cumulativeColor", DEFAULTS.cumulativeColor),
        showStats: getValue<boolean>(obj, "statistics", "showStats", DEFAULTS.showStats),
        statsColor: getColor(obj, "statistics", "statsColor", DEFAULTS.statsColor),
        showValueLabels: getValue<boolean>(obj, "valueLabels", "show", DEFAULTS.showValueLabels),
        vlFontSize: getValue<number>(obj, "valueLabels", "fontSize", DEFAULTS.vlFontSize),
        vlColor: getColor(obj, "valueLabels", "color", DEFAULTS.vlColor),
        vlShowPercent: getValue<boolean>(obj, "valueLabels", "showPercent", DEFAULTS.vlShowPercent),
    };
}

// ─── Contrast ─────────────────────────────────────────────────────────────────

function luminance(hex: string): number {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return 1;
    const n = parseInt(m[1], 16);
    const ch = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(n >> 16) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

function contrast(a: string, b: string): number {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The colour itself when it can be read on that background; if not, black or white. */
function readableOn(color: string, bg: string): string {
    if (contrast(color, bg) >= 4.5) return color;
    return contrast("#111111", bg) >= contrast("#FFFFFF", bg) ? "#111111" : "#FFFFFF";
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Eje resistente a colas largas, por las vallas de Tukey.
 *
 * El dominio iba de min a max. En una distribucion sesgada -importes, tiempos de
 * respuesta, consumos: casi todo lo que se mide en negocio- un solo valor
 * extremo estira el eje y hunde el resto de las filas en el primer bin. El
 * grafico no parece sesgado, parece roto.
 *
 * Q1 - 1.5*IQR y Q3 + 1.5*IQR son la regla habitual para esto. Se aplica solo
 * cuando cambia algo de verdad: si las vallas no recortan nada, se usa el rango
 * completo y no hay nada que explicar.
 *
 * Los valores de fuera NO se tiran: el llamante los mete en el bin del extremo.
 * Recortar el eje es una decision de presentacion; perder filas cambiaria las
 * cuentas, la media y la desviacion, que es justo lo que un histograma no puede
 * permitirse.
 */
function robustDomain(sorted: number[]): { lo: number; hi: number; clamped: boolean } {
    const lo0 = sorted[0], hi0 = sorted[sorted.length - 1];
    const q1 = percentile(sorted, 25);
    const q3 = percentile(sorted, 75);
    const iqr = q3 - q1;
    if (!(iqr > 0)) return { lo: lo0, hi: hi0, clamped: false };

    const lo = Math.max(lo0, q1 - 1.5 * iqr);
    const hi = Math.min(hi0, q3 + 1.5 * iqr);
    if (!(hi > lo)) return { lo: lo0, hi: hi0, clamped: false };

    // Si las vallas apenas recortan, el rango completo ya era legible. Una normal
    // pierde siempre ~0,7% de filas fuera de las vallas: recortar ahi anunciaba una
    // "cola larga" que no existe. Solo se recorta si el rango completo es al menos
    // 1,5 veces el de las vallas.
    if ((hi0 - lo0) < 1.5 * (hi - lo)) return { lo: lo0, hi: hi0, clamped: false };
    const clamped = (lo > lo0) || (hi < hi0);
    return { lo, hi, clamped };
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
    /** Editando sin licencia y con la licencia resuelta: se dibuja lo Pro con marca. */
    private proPreview: boolean = false;
    private editing: boolean = false;
    /** Funciones Pro que el usuario ha tocado en esta sesion de edicion. */
    private attemptedPro: string[] = [];
    /** Temporizador que deja la barra de Upgrade cuando el banner termina. */
    private licenseIconTimer: number | null = null;
    private licenseResolved: boolean = false;
    private licenseEnvSupported: boolean = true;
    private licenseInfoAvailable: boolean = true;
    private licenseNoticeShown: boolean = false;
    private notifiedFeatures: string = "";
    private lastOptions: VisualUpdateOptions | null = null;
    public visualOnObjectFormatting: powerbi.extensibility.visual.VisualOnObjectFormatting;
    private subSelectionHelper: HtmlSubSelectionHelper;
    private formatMode = false;
    private guideEl: HTMLDivElement;
    private guideStep = 2;
    /** Stays open while the session lasts: choosing a style stores a property, and that must not close it. */
    private guideOpen = false;
    private lastDataView: DataView | null = null;
    private lastCatCol: powerbi.DataViewCategoryColumn | null = null;
    private lastPanCol: powerbi.DataViewCategoryColumn | null = null;
    private filterApplied: boolean = false;
    /** Guardas del streaming de segmentos — ver streamSegments(). */
    private lastFetchCount = 0;
    private fetchRounds = 0;
    private truncatedAt = 0;
    private axisClamped = false;
    /** Filas del ultimo bin que era demasiado grande para filtrar. */
    private oversizedSelection = 0;
    /**
     * Bins selected through the selection manager ("<panel>|<bin index>"), the path used
     * while the Detail field can be drilled. The filter path needs no state: the
     * selection is read back from the filter Power BI holds, which is what makes a
     * bookmark or a reopened report show the right bar.
     */
    private selKeys = new Set<string>();
    /** Selection IDs of every bar drawn, to map a selection Power BI restores back to bars. */
    private binIds: { key: string; ids: powerbi.extensibility.ISelectionId[] }[] = [];
    /** Values and panel of the entity filter in force, for Ctrl+click to add to. */
    private curFilterVals: powerbi.PrimitiveValue[] = [];
    private curFilterPanel: string | null = null;
    private readonly MAX_FETCH_ROUNDS = 60;   // 60 x 30k pasa del techo de filas de Power BI
    /**
     * Desktop, from the host (CustomVisualHostEnv.Desktop = 1 << 2). The old test
     * looked for "Electron" in the user agent, which current Desktop builds no longer
     * carry, so Desktop was taken for the Service.
     */
    private get isDesktop(): boolean {
        const env = Number((this.host as any)?.hostEnv);
        if (isFinite(env) && env > 0) return (env & 4) !== 0;
        return navigator.userAgent.indexOf("Electron") !== -1;
    }
    private loc: ILocalizationManager;
    private fmtCache = new Map<string, valueFormatter.IValueFormatter>();
    /** Roving tabindex: the bin that owns the chart's single Tab stop. */
    private focusedBin = 0;
    private restoreFocus = false;
    /** Last interaction was the keyboard: only then is focus put back after a repaint. */
    private keyboardNav = false;
    /** Un unico color en categories[0].objects = color plano del usuario, no una regla fx. */
    private uniformBarColor: string | null = null;
    private currentSettings: Settings = { ...DEFAULTS } as Settings;
    /** A range shortcut was used in this editing session: it draws as Pro preview. */
    private shortcutTried = false;
    /** Which range handle holds the keyboard, to give the focus back after a repaint. */
    private rangeFocus: "lo" | "hi" | null = null;
    private rangeTimer: number | null = null;
    /** The ends asked for: the filter only holds values, so 150 would read back as the nearest row, 150.2. */
    private askedRange: { lo: number; hi: number } | null = null;
    /**
     * The filter this visual has just applied. Power BI hands it back a moment later, so until
     * then a repaint or an update still carries the previous one, and the range jumped back and
     * forth on release. A filter from outside, such as a bookmark, wins once the wait is over.
     */
    private ownFilter: { sig: string; at: number; filters: any[] } | null = null;
    /** Removing the old bar during a repaint blurs its handle: that is not the user leaving it. */
    private painting = false;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.tooltipService = options.host.tooltipService;
        this.selectionManager = options.host.createSelectionManager();
        // A bookmark captured in drill mode stores a selection, not a filter. Power BI
        // hands it back here; without this the report was filtered but no bar showed it.
        this.selectionManager.registerOnSelectCallback((ids: powerbi.extensibility.ISelectionId[]) => {
            this.selKeys.clear();
            for (const b of this.binIds) {
                if (b.ids.some(id => ids.some(s => (s as any).equals?.(id) ?? s === id))) this.selKeys.add(b.key);
            }
            this.repaint();
        });
        this.loc = options.host.createLocalizationManager();
        this.subSelectionHelper = HtmlSubSelectionHelper.createHtmlSubselectionHelper({
            hostElement: options.element,
            subSelectionService: options.host.subSelectionService,
            selectionIdCallback: () => undefined,
        });
        this.visualOnObjectFormatting = {
            getSubSelectionStyles: (subs) => this.getSubSelectionStyles(subs),
            getSubSelectionShortcuts: (subs) => this.getSubSelectionShortcuts(subs),
            getSubSelectables: (filter) => this.subSelectionHelper.getAllSubSelectables(filter),
        };

        this.container = d3.select(options.element)
            .append("div")
            .classed("histogram-pro-container", true)
            .style("width", "100%").style("height", "100%").style("position", "relative");

        this.svg = this.container.append("svg");
        this.guideEl = (this.container.node() as HTMLElement).appendChild(document.createElement("div"));
        this.guideEl.className = "hp-guide";
        this.checkLicense();
    }

    // ── Localization and number format ────────────────────────────────────────
    private t(key: string, fallback: string): string {
        const own = this.stringsFor()?.[key];
        if (own) return own;
        try {
            const s = this.loc?.getDisplayName(key);
            return s && s !== key ? s : fallback;
        } catch { return fallback; }
    }

    /** Desktop only resolves the keys declared in capabilities.json: the rest travel in the bundle. */
    private stringsFor(): Record<string, string> | undefined {
        const loc = String((this.host as any)?.locale || "");
        if (!loc || /^en/i.test(loc)) return undefined;
        if (STRINGS[loc]) return STRINGS[loc];
        const lang = loc.split("-")[0].toLowerCase();
        const k = Object.keys(STRINGS).sort().find(x => x.toLowerCase().startsWith(lang + "-"));
        return k ? STRINGS[k] : undefined;
    }

    private tf(key: string, fallback: string, ...args: string[]): string {
        return this.t(key, fallback).replace(/\{(\d+)\}/g, (_m, i) => args[Number(i)] ?? "");
    }

    /**
     * A value with the measure's format string from the model, in the report's
     * locale. Above 10,000 it is scaled to K / M / bn like the axis needs, except
     * for percentage formats, which are never scaled (0.3 would become 0.03K%).
     * With no format string, whole numbers above 100 and two decimals below.
     */
    private fmtNumber(v: number, format: string | undefined, scaleRef: number): string {
        if (!isFinite(v)) return "";
        const isPct = !!format && /%/.test(format.replace(/"[^"]*"|\\./g, ""));
        // Below 1,000 the unit would only add a ".0K" to a small number: 0 stays 0.
        const scale = !isPct && Math.abs(scaleRef) >= 1e4 && Math.abs(v) >= 1e3;
        const f = format || (Math.abs(scaleRef) >= 100 ? "#,0" : "#,0.##");
        const key = `${f}|${scale ? Math.round(Math.log10(Math.abs(scaleRef))) : "-"}`;
        let fmt = this.fmtCache.get(key);
        if (!fmt) {
            const opts: any = { format: f, cultureSelector: this.host.locale, displayUnitSystemType: 2 };
            if (scale) { opts.value = Math.abs(scaleRef); opts.precision = 1; }
            fmt = valueFormatter.create(opts);
            this.fmtCache.set(key, fmt);
        }
        return fmt.format(v);
    }

    /** Counts, with the locale's thousands separator. */
    private fmtInt(n: number): string { return this.fmtNumber(n, "#,0", 0); }

    /** A share the visual computed, in percent units, in the report's locale. */
    private pct(v: number, decimals = 1): string {
        return this.fmtNumber(v / 100, decimals > 0 ? "0." + "0".repeat(decimals) + "%" : "0%", 0);
    }

    /** Display name of a Pro feature label, in the report's language. */
    private featName(id: string): string {
        switch (id) {
            case "bin count":        return this.t("Feat_bins",   "bin count");
            case "outlier trimming": return this.t("Feat_trim",   "outlier trimming");
            case "bar styling":      return this.t("Feat_style",  "bar styling");
            case "statistics panel": return this.t("Feat_stats",  "statistics panel");
            case "normal curve":     return this.t("Feat_normal", "normal curve");
            case "cumulative line":  return this.t("Feat_cumulative", "cumulative frequency");
            case "value labels":     return this.t("Feat_labels", "value labels");
            case "value zones":      return this.t("Feat_zones",  "value zones");
            case "small multiples":  return this.t("Feat_panels", "small multiples");
            case "style templates":  return this.t("Feat_templates", "style templates");
            case "range shortcuts":  return this.t("Feat_shortcuts", "range shortcuts");
            default: return id;
        }
    }

    // ── License ───────────────────────────────────────────────────────────────

    /**
     * Resolves the licence and repaints if the answer changes what is drawn.
     *
     * The repaint is the point. Resolution is asynchronous and lands after the
     * first paint, so without it a customer who has paid sees the Free chart —
     * ten fixed bins, no statistics — until Power BI happens to call update()
     * again. In a report that renders once, that is for ever.
     */
    private async checkLicense(): Promise<void> {
        if (this.isPro) { this.licenseResolved = true; return; } // test build
        try {
            const lm = this.host.licenseManager;
            if (!lm) { this.licenseResolved = true; return; }

            const result: any = await lm.getAvailableServicePlans();

            // The plan identifier has to match: any other active plan the user
            // holds belongs to a different visual.
            //
            // Warning is a payment grace period. Per the licensing API "only the
            // active and warning states represent a usable license", so a paying
            // customer keeps their features while a billing problem is resolved.
            this.isPro = result?.plans?.some(
                p => matchesPlan(p.spIdentifier, PLAN_ID) &&
                     (p.state === ServicePlanState.Active ||
                      p.state === ServicePlanState.Warning)
            ) ?? false;

            // Publish to Web, embedded, national clouds, PDF/PPT export, offline
            // or signed out: the licence cannot be resolved and a Pro customer
            // reads as Free. Render the free experience there, but never ask them
            // to buy what they may already own.
            this.licenseEnvSupported  = !result?.isLicenseUnsupportedEnv;
            this.licenseInfoAvailable = result?.isLicenseInfoAvailable !== false;
        } catch {
            // Si no se pudo leer la licencia no sabemos si ya pago: Free, y sin avisos de compra.
            this.isPro = false;
            this.licenseInfoAvailable = false;
        } finally {
            this.licenseResolved = true;
            // Repintar TAMBIEN en la rama gratuita. El primer render ocurre antes de que
            // la licencia resuelva, asi que computePreview() daba false y la vista previa
            // no llegaba a dibujarse nunca; Power BI recrea el visual al cambiar de pagina,
            // asi que el usuario veia la previa desaparecer al volver. Costo una version
            // en KPI Card Pro por no repintar aqui.
            this.attemptedPro = this.isPro ? [] : this.attemptedProFeatures();
            this.proPreview = this.computePreview();
            if (this.lastOptions) {
                try { this.render(this.lastOptions); this.afterRender(this.lastOptions); } catch { /* el render ya reporta */ }
            }
            this.applyLicenseNotifications();
        }
    }

    /**
     * Vista previa Pro.
     *
     * Solo con la licencia ya resuelta y en un entorno donde se puede leer: al arrancar,
     * isPro es false tambien para un cliente de pago, y donde la licencia no se resuelve
     * -Publicar en la web, incrustado, exportacion- un cliente Pro se lee como gratuito.
     * Dibujar la marca ahi seria ponersela a quien ya pago.
     */
    private computePreview(): boolean {
        return !this.isPro && this.editing && this.licenseResolved
            && this.licenseEnvSupported && this.licenseInfoAvailable;
    }

    /**
     * Si una funcion concreta se dibuja.
     *
     * Por FUNCION, no en bloque: conceder la previa entera repartiria los valores Pro por
     * defecto en cuanto se inserta el visual, sin que nadie haya pedido nada. Se compara
     * la etiqueta exacta, no por prefijo -"bar styling" no debe activar otra cosa-.
     */
    private allow(feature: string): boolean {
        if (this.isPro) return true;
        if (!this.proPreview) return false;
        return this.attemptedPro.indexOf(feature) >= 0;
    }

    /** Pro properties the user has actually set, by format-pane card. */
    private static readonly PRO_PROPS: ReadonlyArray<[string, string, string]> = [
        ["histogram",   "bins",        "bin count"],
        ["histogram",   "trimLower",   "outlier trimming"],
        ["histogram",   "trimUpper",   "outlier trimming"],
        ["histogram",   "barColor",    "bar styling"],
        ["histogram",   "barOpacity",  "bar styling"],
        ["histogram",   "borderColor", "bar styling"],
        ["histogram",   "borderWidth", "bar styling"],
        ["histogram",   "barGap",      "bar styling"],
        ["statistics",  "showStats",   "statistics panel"],
        ["statistics",  "showNormal",  "normal curve"],
        ["statistics",  "showCumulative", "cumulative line"],
        ["valueLabels", "show",        "value labels"],
        ["zones",       "show",        "value zones"],
        ["style",       "template",    "style templates"],
        ["rangeBar",    "inColor",     "bar styling"],
        ["rangeBar",    "outColor",    "bar styling"],
    ];

    /**
     * Which Pro features the user has reached for.
     *
     * Read from `metadata.objects`, which carries only properties the user set
     * explicitly — defaults are absent — so the banner never fires on a report
     * nobody has touched.
     */
    private attemptedProFeatures(): string[] {
        const obj: any = this.lastDataView?.metadata?.objects ?? {};
        const found = new Set<string>();
        if ((this.lastDataView?.metadata?.columns ?? []).some(c => c.roles?.["panel"])) found.add("small multiples");
        if (this.shortcutTried) found.add("range shortcuts");
        for (const [card, prop, label] of Visual.PRO_PROPS) {
            if (!obj[card]) continue;
            const v = obj[card][prop];
            if (v === undefined) continue;
            // Comparar el VALOR, no la mera presencia. Power BI deja la propiedad escrita
            // para siempre una vez tocada, asi que mirar si existe dejaba la marca de agua
            // puesta aunque el usuario devolviera el ajuste a su valor gratuito.
            if (this.esValorPorDefecto(prop, v)) continue;
            // Following the report's theme is what a native visual does, and Classic is the old
            // free look: neither is a Pro style.
            if (card === "style" && (v === "report" || v === "classic")) continue;
            found.add(label);
        }
        return [...found];
    }

    /** Si un valor guardado coincide con el que da el tier gratuito. */
    private esValorPorDefecto(prop: string, v: any): boolean {
        const def: any = (DEFAULTS as any)[prop === "show" ? "showValueLabels" : prop];
        if (def === undefined) return false;
        // Los colores llegan envueltos: { solid: { color: "#RRGGBB" } }
        const val = (v && typeof v === "object" && v.solid) ? v.solid.color : v;
        if (typeof def === "string" && typeof val === "string") {
            return def.toLowerCase() === val.toLowerCase();
        }
        return def === val;
    }

    /**
     * Power BI's own notifications, which carry the purchase path. The visual
     * draws no licensing UI of its own: Microsoft's guidance is explicit that a
     * visual "shouldn't display its own licensing UX, instead use one of Power
     * BI supported predefined notifications".
     */
    private applyLicenseNotifications(): void {
        const lm: any = this.host.licenseManager;
        if (!lm) return;

        // Nothing is notified until the licence resolves: isPro is false at
        // start for a licensed customer too, and notifying then would ask a
        // paying user to buy what they already have.
        if (!this.licenseResolved) return;

        if (this.isPro || !this.licenseEnvSupported || !this.licenseInfoAvailable) {
            this.cancelLicenseIcon();
            if (this.licenseNoticeShown) {
                try { lm.clearLicenseNotification(); } catch { /* older host */ }
                this.licenseNoticeShown = false;
            }
            this.notifiedFeatures = "";
            return;
        }

        const attempted = this.attemptedProFeatures();
        if (!attempted.length) {
            this.cancelLicenseIcon();
            if (this.licenseNoticeShown) {
                try { lm.clearLicenseNotification(); } catch { /* older host */ }
                this.licenseNoticeShown = false;
            }
            this.notifiedFeatures = "";
            return;
        }

        // notifyFeatureBlocked fires once per distinct set of features, when the
        // user reaches for one.
        const key = attempted.sort().join("|");
        if (key !== this.notifiedFeatures) {
            this.notifiedFeatures = key;
            try {
                lm.notifyFeatureBlocked(this.tf("UI_NoticeBlocked",
                    "Histogram Pro: {0} — part of the Pro plan.", attempted.map(a => this.featName(a)).join(", ")).slice(0, 500));
            } catch { /* older host */ }
        }

        // notifyLicenseRequired stays up while Pro settings are stored without a
        // licence. It covers the lapsed trial, where the user changes nothing and
        // the chart quietly reverts to ten bins with no statistics: the settings
        // are still saved, so it reads as the visual breaking rather than as a
        // licence expiring. The banner alone does not cover that, since it only
        // fires when a setting is changed.
        //
        // Va DESPUES del banner, no a la vez. Power BI muestra un aviso cada vez y el
        // ultimo pisa al anterior: llamando seguido, la barra borraba el banner y el
        // usuario nunca llegaba a leer que funcion habia tocado.
        if (!this.licenseNoticeShown && this.licenseIconTimer === null) {
            this.licenseIconTimer = window.setTimeout(() => {
                this.licenseIconTimer = null;
                if (this.isPro) return;
                try {
                    lm.notifyLicenseRequired(0 /* LicenseNotificationType.General */);
                    this.licenseNoticeShown = true;
                } catch { /* older host */ }
            }, 10500);
        }
    }

    /** Cancela la barra de Upgrade pendiente. */
    private cancelLicenseIcon(): void {
        if (this.licenseIconTimer !== null) {
            window.clearTimeout(this.licenseIconTimer);
            this.licenseIconTimer = null;
        }
    }

    /**
     * Power BI pone allowInteractions a false al exportar y en algunos modos
     * de lectura. Seleccionar entonces cambiaria el informe a espaldas del
     * usuario, asi que la seleccion y el menu contextual se comprueban antes.
     */
    private get canInteract(): boolean {
        return (this.host as any).allowInteractions !== false;
    }

    // ── Segment streaming ─────────────────────────────────────────────────────

    /**
     * Asks Power BI for the next data segment, and says so when it cannot.
     *
     * The data reduction hands over 30,000 rows at a time. For a histogram that
     * ceiling is not a cosmetic limit: the shape of the distribution *is* the
     * product, and a distribution drawn from part of the rows looks exactly as
     * plausible as one drawn from all of them. There is nothing on screen to
     * suggest anything is missing, which is why the truncation notice exists.
     *
     * Returns true when a fetch was requested, and the caller must return
     * without rendering — Power BI will call update() again with more rows.
     *
     * Three independent brakes. Requesting more data and returning without
     * rendering is only safe while more data is actually arriving; when it is
     * not, this loops for ever and takes the host down with it:
     *
     *   - Desktop runs inside Electron and cannot stream segments at all, so it
     *     stops at the first 30,000 whatever we do here.
     *   - No growth since the previous round means we are being handed the same
     *     rows again. This is the brake that matters, because it does not depend
     *     on sniffing the user agent.
     *   - A round ceiling, as a last resort.
     */
    private streamSegments(options: VisualUpdateOptions, dv: DataView): boolean {
        // operationKind 1 = Append, a segment continuation. Anything else is a
        // fresh query, so the guards start over.
        if ((options as any).operationKind !== 1) {
            this.lastFetchCount = 0;
            this.fetchRounds = 0;
        }

        this.truncatedAt = 0;
        if (!dv.metadata?.segment) return false;   // Power BI gave us everything

        const loaded = dv.categorical?.values?.[0]?.values?.length ?? 0;
        const grew = loaded > this.lastFetchCount;
        const canStream = !this.isDesktop && grew && this.fetchRounds < this.MAX_FETCH_ROUNDS;

        if (canStream && loaded >= 30000) {
            this.lastFetchCount = loaded;
            this.fetchRounds++;
            // aggregateSegments = true: Power BI combines the chunks and calls
            // update() again with the lot.
            if (this.host.fetchMoreData(true)) return true;
        }

        this.truncatedAt = loaded;
        return false;
    }

    /**
     * Says, on the chart, that it is drawn from part of the data.
     *
     * Without this the histogram is silently wrong: bin heights, the mean, the
     * median, the standard deviation and the normal curve are all computed over
     * whatever arrived.
     */
    /**
     * Dice que el eje esta recortado y que la ultima barra acumula la cola.
     *
     * Sin esto la ultima barra se lee como "hay muchisimos casos justo ahi",
     * cuando lo que dice es "todo lo que hay de aqui en adelante".
     */
    private renderClampNotice(width: number, height: number, hiLabel: string): void {
        if (!this.axisClamped) return;
        this.svg.append("text")
            .attr("x", width - 6).attr("y", height - 4)
            .attr("text-anchor", "end")
            .attr("fill", "#90A4AE")
            .attr("font-size", 9)
            .attr("font-family", "Segoe UI, sans-serif")
            .text(this.tf("UI_Clamp", "Axis clipped to the long tail · the last bar holds everything above {0}", hiLabel));
    }

    private renderTruncationNotice(width: number): void {
        if (!this.truncatedAt) return;
        const shown = this.fmtInt(this.truncatedAt);
        const txt = this.isDesktop
            ? this.tf("UI_TruncDesktop", "Showing the first {0} rows — Desktop cannot load more. Publish to the Service for the full distribution.", shown)
            : this.tf("UI_TruncService", "Showing the first {0} rows — the dataset is larger than Power BI will hand to a visual.", shown);
        this.svg.append("text")
            .attr("x", width - 6).attr("y", 12)
            .attr("text-anchor", "end")
            .attr("fill", "#FFB300")
            .attr("font-size", 10)
            .attr("font-family", "Segoe UI, sans-serif")
            .text(txt);
    }

    // ── Cross-filtering ───────────────────────────────────────────────────────

    /**
     * A BasicFilter over every row that falls in the given bin.
     *
     * This is what makes bin filtering exact. `selectionManager.select()` needs
     * one selection ID per row, each carrying a full scope identity, so a bin
     * holding 8,000 rows either builds 8,000 heavy objects or gets capped and
     * filters a subset — the report then shows numbers that do not match the bar
     * the user clicked. A BasicFilter carries plain scalars instead, which is the
     * same mechanism native slicers use for large value lists, so there is no cap.
     *
     * It matters here more than anywhere: the data reduction allows 30,000 rows,
     * and a ten-bin histogram of a normal-ish distribution puts several thousand
     * of them in the middle bins.
     *
     * Returns null when the category's queryName cannot be split into a
     * table/column target — drilldown levels and some model shapes do not expose
     * one. The caller falls back to selection IDs, so behaviour degrades to the
     * previous mechanism rather than breaking.
     */
    private buildBinFilter(indices: number[], panelValue?: powerbi.PrimitiveValue,
                           keep: powerbi.PrimitiveValue[] = [], remove = false): powerbi.IFilter | powerbi.IFilter[] | null {
        const cat = this.lastCatCol;
        if (!cat || (!indices.length && !keep.length)) return null;

        // Exactly one dot. "table.column" is a usable target; a hierarchy level
        // arrives as "table.hierarchy.level", and splitting that on the first dot
        // would build a target for a column that does not exist — a wrong filter
        // rather than no filter.
        const queryName = cat.source?.queryName ?? "";
        const parts = queryName.split(".");
        if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
        const dot = parts[0].length;

        // Ctrl+click: the values already filtered are kept and the bin's are added, or,
        // when the bin was already selected, taken out. A plain click passes keep = [].
        const binVals = new Set<string>();
        for (const i of indices) {
            const v = cat.values[i];
            if (v !== null && v !== undefined) binVals.add(String(v));
        }
        const values: powerbi.PrimitiveValue[] = [];
        const seen = new Set<string>();
        const push = (v: powerbi.PrimitiveValue) => {
            if (v === null || v === undefined) return;
            const key = String(v);
            if (seen.has(key)) return;
            if (remove && binVals.has(key)) return;
            seen.add(key);
            values.push(v);
        };
        keep.forEach(push);
        if (!remove) for (const i of indices) push(cat.values[i]);
        if (!values.length) return null;

        const entityFilter = {
            $schema: "https://powerbi.com/product/schema#basic",
            filterType: 1,                    // FilterType.Basic
            target: {
                table: queryName.slice(0, dot),
                column: queryName.slice(dot + 1),
            },
            operator: "In",
            values,
        } as unknown as powerbi.IFilter;
        if (panelValue === undefined || panelValue === null) return entityFilter;

        // Small multiples: the panel half is mandatory, or the rows of that bin would
        // be selected in every panel. Without a usable target, fall back to selection
        // IDs, which carry the panel in their scope.
        const pq = (this.lastPanCol?.source?.queryName ?? "").split(".");
        if (pq.length !== 2 || !pq[0] || !pq[1]) return null;
        return [entityFilter, {
            $schema: "https://powerbi.com/product/schema#basic",
            filterType: 1,
            target: { table: pq[0], column: pq[1] },
            operator: "In",
            values: [panelValue],
        } as unknown as powerbi.IFilter];
    }

    /** FilterAction is a const enum — the literals are required at runtime. */
    private readonly FILTER_MERGE = 0;
    private readonly FILTER_REMOVE = 1;

    /**
     * Filters the report by a bin. Prefers the exact filter; falls back to
     * selection IDs when the model gives no usable target.
     */
    private selectBin(indices: number[], ids: powerbi.extensibility.ISelectionId[], multi: boolean,
                      panelValue?: powerbi.PrimitiveValue, key?: string, wasSelected?: boolean): void {
        if (!this.canInteract) return;

        // Clicking the selected bar again clears the selection, as in a native chart.
        if (wasSelected && !multi) { this.clearSelection(); return; }
        // Ctrl+click adds to what is filtered, within one panel; in another panel it
        // starts a new selection (two IN filters cannot express "bin A of panel 1 and
        // bin B of panel 2" without selecting combinations nobody clicked).
        const samePanel = panelValue === undefined || panelValue === null
            || this.curFilterPanel === null || this.curFilterPanel === String(panelValue);
        const keep = multi && samePanel ? this.curFilterVals : [];
        const removing = multi && !!wasSelected;

        // Drill mode. Power BI drills into a data point only when the visual SELECTS it
        // through the selection manager; the exact BasicFilter below never reaches the
        // drill logic, so with drill mode on a click did nothing. While the Detail field
        // has a level below (drillableRoles lists Down), select instead: that drills in
        // drill mode and still cross-filters otherwise. Upper levels hold few members per
        // bin, so the selection-ID cap does not bite; the last level keeps the exact filter.
        const dr = (this.lastDataView?.metadata as any)?.dataRoles;
        const canDrillDown = !dr?.isDrillDisabled
            && ((dr?.drillableRoles?.["category"] ?? []) as number[]).indexOf(2 /* DrillType.Down */) >= 0;
        if (canDrillDown && ids.length) {
            if (this.filterApplied) this.setOwnFilter(null);
            this.selectionManager.select(ids.slice(0, MAX_SEL_IDS_PER_BIN), multi);
            if (!multi) this.selKeys.clear();
            if (key) this.selKeys.add(key);
            this.repaint();
            return;
        }
        this.selKeys.clear();

        // Freno antes de construir nada. Sin esto, un bin de un histograma sesgado
        // -donde el primero se lleva la mayoria de las filas- genera un IN() de
        // cientos de miles de valores y bloquea el informe al pulsarlo.
        const distinct = this.countDistinct(indices, MAX_FILTER_VALUES) + (removing ? 0 : keep.length);
        if (distinct > MAX_FILTER_VALUES) {
            this.oversizedSelection = distinct;
            this.renderOversizedNotice();
            return;
        }
        this.oversizedSelection = 0;

        const filter = this.buildBinFilter(indices, panelValue, keep, removing);
        if (!filter && removing) { this.clearSelection(); return; }
        if (filter) {
            this.setOwnFilter(filter);
            const ent = (Array.isArray(filter) ? filter[0] : filter) as any;
            this.curFilterVals = Array.isArray(ent?.values) ? ent.values.slice() : [];
            this.curFilterPanel = panelValue === undefined || panelValue === null ? null : String(panelValue);
            this.repaint();
            return;
        }
        // Respaldo: el modelo no da un objetivo tabla.columna. Los selection IDs
        // siguen funcionando, con tope.
        this.selectionManager.select(ids.slice(0, MAX_SEL_IDS_PER_BIN), multi);
        if (!multi) this.selKeys.clear();
        if (key) this.selKeys.add(key);
        this.repaint();
    }

    /** Redraw for a change only the visual knows about (no update() from Power BI). */
    private repaint(): void {
        if (!this.lastOptions) return;
        this.attemptedPro = this.isPro ? [] : this.attemptedProFeatures();
        try { this.render(this.lastOptions); this.afterRender(this.lastOptions); } catch (e) { console.error("[HistogramPro]", e); }
    }

    /**
     * Valores distintos del bin, con salida temprana.
     *
     * Cuenta hasta cap+1 y para. Contarlos todos significaria recorrer las
     * 500.000 filas y construir el Set que precisamente queremos evitar.
     */
    private countDistinct(indices: number[], cap: number): number {
        const cat = this.lastCatCol;
        if (!cat) return 0;
        const seen = new Set<string>();
        for (const i of indices) {
            const v = cat.values[i];
            if (v === null || v === undefined) continue;
            seen.add(String(v));
            if (seen.size > cap) return seen.size;
        }
        return seen.size;
    }

    /** Dice por que el clic no ha hecho nada, y que palanca lo arregla. */
    private renderOversizedNotice(isRange = false): void {
        this.container.selectAll(".oversized-notice").remove();
        const n = this.fmtInt(this.oversizedSelection);
        const cap = this.fmtInt(MAX_FILTER_VALUES);

        const note = this.container.append("div")
            .classed("oversized-notice", true)
            .style("position", "absolute").style("left", "0").style("right", "0")
            .style("bottom", "0").style("padding", "8px 12px")
            .style("background", "#FDF3E7").style("border-top", "1px solid #E8A020")
            .style("font-size", "11px").style("color", "#7A4E12")
            .style("line-height", "1.4");

        note.append("div").text(isRange
            ? this.tf("UI_OversizedRange", "This range holds over {0} distinct values — more than the {1} Power BI can cross-filter at once. Narrow it.", n, cap)
            : this.tf("UI_Oversized",
            "This bin holds over {0} distinct values — more than the {1} Power BI can cross-filter at once.", n, cap));
        if (!isRange) note.append("div").text(
            this.isPro
                ? this.t("UI_OversizedPro", "Raise the bin count (Histogram → Bins) so each bar covers fewer rows, or trim the outliers.")
                : this.t("UI_OversizedFree", "Pro lets you raise the bin count so each bar covers fewer rows."));

        setTimeout(() => this.container.selectAll(".oversized-notice").remove(), 6000);
    }

    private static filterSig(filters: any[] | undefined): string {
        return (filters ?? []).map(f => `${f?.target?.column}:${(f?.values ?? []).map(String).sort().join("")}`).sort().join("");
    }

    /** Applies the filter and remembers it, so what is drawn does not wait for Power BI. */
    private setOwnFilter(filter: powerbi.IFilter | powerbi.IFilter[] | null): void {
        const filters: any[] = !filter ? [] : Array.isArray(filter) ? filter : [filter];
        this.ownFilter = { sig: Visual.filterSig(filters), at: Date.now(), filters };
        if (this.lastOptions) (this.lastOptions as any).jsonFilters = filters;
        this.filterApplied = !!filter;
        this.host.applyJsonFilter(filter as any, "general", "filter", filter ? this.FILTER_MERGE : this.FILTER_REMOVE);
    }

    /** Clears whichever mechanism is in force. */
    private clearSelection(): void {
        if (!this.canInteract) return;
        if (this.filterApplied) this.setOwnFilter(null);
        this.selectionManager.clear();
        const had = this.selKeys.size > 0 || this.curFilterVals.length > 0;
        this.selKeys.clear();
        this.curFilterVals = [];
        this.curFilterPanel = null;
        this.askedRange = null;
        const tried = this.shortcutTried;
        this.shortcutTried = false;
        if (had || tried) this.repaint();
        if (tried) this.applyLicenseNotifications();
    }

    /**
     * Filters the report by a value range. Same exact filter as a bar, so a range never
     * filters a subset: above the cap it declines and says so.
     */
    private applyRange(rows: { value: number; origIndex: number }[], lo: number, hi: number, dom: number[]): void {
        if (!this.canInteract) return;
        if (lo <= dom[0] && hi >= dom[1]) { this.clearSelection(); return; }
        // The ends of the axis mean "everything out there": the last bar holds the long tail.
        const a = lo <= dom[0] ? -Infinity : lo, b = hi >= dom[1] ? Infinity : hi;
        const idx = rows.filter(d => d.value >= a && d.value <= b).map(d => d.origIndex);
        if (!idx.length) { this.repaint(); return; }
        const distinct = this.countDistinct(idx, MAX_FILTER_VALUES);
        if (distinct > MAX_FILTER_VALUES) {
            this.oversizedSelection = distinct;
            this.renderOversizedNotice(true);
            this.repaint();
            return;
        }
        this.oversizedSelection = 0;
        const filter = this.buildBinFilter(idx);
        if (!filter) { this.repaint(); return; }
        this.selKeys.clear();
        this.setOwnFilter(filter);
        this.askedRange = { lo: a, hi: b };
        const ent = (Array.isArray(filter) ? filter[0] : filter) as any;
        this.curFilterVals = Array.isArray(ent?.values) ? ent.values.slice() : [];
        this.curFilterPanel = null;
        this.repaint();
    }

    // ── Update ────────────────────────────────────────────────────────────────

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);
        this.lastOptions = options;
        this.formatMode = !!(options as any).formatMode;
        this.subSelectionHelper.setFormatMode(this.formatMode);
        this.lastDataView = options.dataViews?.[0] ?? null;
        // viewMode 0 es vista de lectura. La previa es cosa de quien edita: un informe
        // publicado nunca debe usar una funcion que no se ha pagado.
        this.editing = (options as any).viewMode !== 0;
        this.attemptedPro = this.isPro ? [] : this.attemptedProFeatures();
        this.proPreview = this.computePreview();

        // filterApplied es estado de instancia y no sobrevive a una recarga ni a
        // un bookmark aplicado desde fuera. Power BI si lo sabe, asi que se lee
        // de lo que llega: sin esto, "borrar" no quitaria un filtro que sigue
        // vivo en el informe.
        if (this.ownFilter) {
            const incoming = (options as any).jsonFilters as any[] | undefined;
            if (Visual.filterSig(incoming) === this.ownFilter.sig || Date.now() - this.ownFilter.at > 3000) this.ownFilter = null;
            else (options as any).jsonFilters = this.ownFilter.filters;
        }
        this.filterApplied =
            (options.jsonFilters?.length ?? 0) > 0 ||
            !!(this.lastDataView?.metadata?.objects?.["general"]?.["filter"]);
        try {
            const dv = options.dataViews?.[0];
            if (dv && this.streamSegments(options, dv)) {
                // Se ha pedido otro segmento: Power BI volvera a llamar a update()
                // con mas filas. Pintar ahora seria dibujar una distribucion
                // parcial que se reemplaza en cuanto llegue el resto.
                this.events.renderingFinished(options);
                return;
            }
            this.render(options);
            this.afterRender(options);
            this.applyLicenseNotifications();
            this.events.renderingFinished(options);
        } catch (e) {
            this.events.renderingFailed(options, String(e));
            console.error("[HistogramPro]", e);
        }
    }

    private render(options: VisualUpdateOptions): void {
        this.binIds = [];
        const dataView = options.dataViews?.[0];
        const width = options.viewport.width;
        const height = options.viewport.height;

        const active = (this.container.node() as HTMLElement)?.ownerDocument?.activeElement;
        // Only while navigating with the keyboard. A mouse click focuses the bar it hits,
        // and putting focus back on "the keyboard's bar" after the repaint drew a focus
        // ring on bin 1 whatever was clicked.
        this.restoreFocus = this.keyboardNav && !!active && (this.container.node() as HTMLElement).contains(active);
        this.painting = true;
        this.svg.selectAll("*").remove();
        this.container.selectAll(".hp-range-input").remove();
        this.painting = false;
        this.svg.attr("width", width).attr("height", height).style("font-family", "'Segoe UI', sans-serif");

        if (!dataView?.categorical?.values?.[0]) {
            this.showLandingPage(width, height);
            return;
        }

        const tplStored = String(dataView.metadata?.objects?.["style"]?.["template"] ?? DEFAULTS.template);
        STYLES.report = reportLook(this.host);
        const styleOk = tplStored === "report" || tplStored === "classic" || this.allow("style templates");
        const settings = parseSettings(dataView, styleOk);
        this.currentSettings = settings;
        const look = (styleOk && STYLES[settings.template]) || STYLES.report;
        const baseLook: Partial<Settings> = { ...DEFAULTS, ...look.values };
        const hcOn = this.host.colorPalette.isHighContrast;
        if (!hcOn && (look.bg || look.grad)) {
            let fill = look.bg ?? "none";
            if (look.grad) {
                const lg = this.svg.append("defs").append("linearGradient").attr("id", "hp-bg")
                    .attr("x1", "0").attr("y1", "0").attr("x2", "1").attr("y2", "1");
                look.grad.forEach((c, i) => lg.append("stop").attr("offset", `${i * 50}%`).attr("stop-color", c));
                fill = "url(#hp-bg)";
            }
            this.svg.append("rect").attr("width", width).attr("height", height).attr("fill", fill).attr("pointer-events", "none");
        }

        // Dynamic format string — read from the measure's Power BI format setting
        const formatStr = dataView.categorical.values[0].source.format ?? "";

        const effectiveBins = this.allow("bin count")
            ? Math.max(2, Math.min(100, settings.bins || DEFAULTS.bins))
            : FREE_MAX_BINS;

        // Extract values + selection IDs + highlights
        const raw: number[] = [];
        type RowT = { value: number; selId: powerbi.extensibility.ISelectionId; origIndex: number; panel: string; hl: boolean };
        const rawWithIds: RowT[] = [];
        const mainValueCol = dataView.categorical.values.find(v => v.source.roles?.["measure"]) ?? dataView.categorical.values[0];
        const tooltipCols = dataView.categorical.values.filter(v => v.source.roles?.["tooltips"]);
        const rawValues = mainValueCol.values;
        const highlightValues = mainValueCol.highlights;
        const hasHighlights = highlightValues != null;
        const highlightedRaw: number[] = [];
        const cats = dataView.categorical.categories ?? [];
        const categories = cats.find(c => c.source?.roles?.["category"]);
        const panCol = cats.find(c => c.source?.roles?.["panel"] && c !== categories) ?? null;
        this.lastCatCol = categories ?? null;
        this.lastPanCol = panCol;

        // The selection, read back from the filter Power BI holds for this visual: a
        // click, a bookmark or a reopened report all arrive here the same way.
        const colOf = (src?: powerbi.DataViewMetadataColumn) => {
            const p = (src?.queryName ?? "").split(".");
            return p.length === 2 ? p[1] : null;
        };
        const catColName = colOf(categories?.source), panColName = colOf(panCol?.source ?? undefined);
        let selVals: Set<string> | null = null, selPanels: Set<string> | null = null;
        for (const f of ((options as any).jsonFilters ?? []) as any[]) {
            const col = f?.target?.column, vs = f?.values;
            if (!Array.isArray(vs)) continue;
            if (panColName && col === panColName && col !== catColName) {
                selPanels = selPanels ?? new Set<string>();
                vs.forEach((v: any) => selPanels!.add(String(v)));
            } else if (catColName && col === catColName) {
                selVals = selVals ?? new Set<string>();
                vs.forEach((v: any) => selVals!.add(String(v)));
            }
        }
        // Power BI does not always hand the visual's own filter back in jsonFilters (in
        // Desktop it often does not). So the visual keeps its own copy, set on click:
        //   - jsonFilters has it  -> it wins (bookmarks, reopened report)
        //   - a filter is stored but unreadable -> keep our copy
        //   - no filter at all    -> the selection was cleared elsewhere: drop our copy
        const ownFilterStored = !!(dataView.metadata?.objects?.["general"]?.["filter"])
            || ((options as any).jsonFilters?.length ?? 0) > 0;
        if (selVals) {
            this.selKeys.clear();
            this.curFilterVals = [];
            for (const f of ((options as any).jsonFilters ?? []) as any[]) {
                if (catColName && f?.target?.column === catColName && Array.isArray(f?.values)) this.curFilterVals.push(...f.values);
            }
            this.curFilterPanel = selPanels && selPanels.size === 1 ? Array.from(selPanels)[0] : null;
        } else if (ownFilterStored && this.curFilterVals.length) {
            selVals = new Set(this.curFilterVals.map(v => String(v)));
            if (this.curFilterPanel !== null) selPanels = new Set([this.curFilterPanel]);
        } else if (!ownFilterStored) {
            this.curFilterVals = [];
            this.curFilterPanel = null;
        }
        const anySel = !!selVals || this.selKeys.size > 0;
        const usePanels = !!panCol && this.allow("small multiples");
        const panelKey = (i: number): string => {
            const v = panCol?.values[i];
            return v === null || v === undefined ? "\u0000" : (v instanceof Date ? String(v.getTime()) : String(v));
        };

        for (let i = 0; i < rawValues.length; i++) {
            const v = rawValues[i];
            if (v != null && isFinite(+v)) {
                let builder = this.host.createSelectionIdBuilder();
                if (categories) builder = builder.withCategory(categories, i);
                if (usePanels && panCol) builder = builder.withCategory(panCol, i);
                const selId = builder.createSelectionId();
                const hl = hasHighlights && highlightValues[i] != null && isFinite(+highlightValues[i]);
                raw.push(+v);
                rawWithIds.push({ value: +v, selId, origIndex: i, panel: usePanels ? panelKey(i) : "", hl });
                if (hl) highlightedRaw.push(+v);
            }
        }
        type Shared = { lo: number; hi: number; rd: { lo: number; hi: number; clamped: boolean }; scaleRef: number; yMax: number; range: RangeState | null };
        const fullW = width, fullH = height;
        // Range bar: a detail field whose values can be filtered, and on the last level when drilling.
        const dRoles = (this.lastDataView?.metadata as any)?.dataRoles;
        const drillable = !dRoles?.isDrillDisabled
            && ((dRoles?.drillableRoles?.["category"] ?? []) as number[]).indexOf(2 /* DrillType.Down */) >= 0;
        const rangeTarget = (categories?.source?.queryName ?? "").split(".");
        const rangeAllowed = settings.rangeShow && this.canInteract && !drillable
            && rangeTarget.length === 2 && !!rangeTarget[0] && !!rangeTarget[1];
        // The range in force, read back from the filter: a click, a bookmark or a reopened
        // report arrive the same way. Only a continuous run of values is a range.
        const readRange = (rows: RowT[], toAxis: (v: number) => number, dom: number[]): RangeState => {
            const r: RangeState = { rLo: dom[0], rHi: dom[1], rActLo: dom[0], rActHi: dom[1], rActive: false };
            if (!selVals || selPanels || !categories) return r;
            const inSel = (d: RowT) => selVals!.has(String(categories.values[d.origIndex]));
            let a = Infinity, b = -Infinity, cnt = 0;
            for (const d of rows) if (inSel(d)) { a = Math.min(a, d.value); b = Math.max(b, d.value); cnt++; }
            if (cnt && cnt < rows.length && rows.every(d => d.value < a || d.value > b || inSel(d))) {
                r.rActive = true; r.rLo = r.rActLo = toAxis(a); r.rHi = r.rActHi = toAxis(b);
                const asked = this.askedRange;
                if (asked && asked.lo <= a && asked.hi >= b
                    && rows.filter(d => d.value >= asked.lo && d.value <= asked.hi).length === cnt) {
                    r.rLo = toAxis(asked.lo); r.rHi = toAxis(asked.hi);
                }
            }
            return r;
        };
        let gridArgs: RangeArgs | null = null;
        const gridPanels: RangePanel[] = [];
        // Small multiples: one legend for all panels, in a band across the top.
        let legendBand = 0;
        let bottomBandG = 0;
        let clampDone = false;
        const drawPanel = (raw: number[], rawWithIds: RowT[], highlightedRaw: number[],
                           ox: number, oy: number, width: number, height: number,
                           shared: Shared | null, title: string, panelValue: powerbi.PrimitiveValue | undefined,
                           showLegendHere: boolean): void => {
        const cellH = height;
        const titleH = title ? Math.max(9, settings.smTitleSize) + 8 : 0;
        if (raw.length < 2) return;

        raw.sort((a, b) => a - b);
        const n = raw.length;

        // Every number on the chart goes through the model's format string and the
        // report's locale. The scale reference is the largest magnitude, so ticks,
        // statistics and tooltips share one unit (K, M…).
        const scaleRef = shared ? shared.scaleRef : Math.max(Math.abs(raw[0]), Math.abs(raw[n - 1]));
        const formatValue = (v: number, fmt: string): string => this.fmtNumber(v, fmt || undefined, fmt === formatStr ? scaleRef : Math.abs(v));
        const fmtNum = (v: number): string => this.fmtInt(v);

        const trimOk = this.allow("outlier trimming");
        // With small multiples the trim cut-offs are the whole dataset's, so every
        // panel is cut at the same values.
        const loVal = shared ? shared.lo : (trimOk && settings.trimLower > 0 ? percentile(raw, settings.trimLower) : raw[0]);
        const hiVal = shared ? shared.hi : (trimOk && settings.trimUpper > 0 ? percentile(raw, 100 - settings.trimUpper) : raw[n - 1]);

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

        // Small tiles: the axis titles, the legend and the statistics panel take more
        // room than they give, so they go and the bars keep the space.
        height = height - titleH;
        const compact = width < 320 || height < 220;
        if (compact) {
            settings.showXLabel = false;
            settings.showYLabel = false;
            // With small multiples the legend lives in a shared band outside the panels,
            // so a small panel is no reason to drop it (it vanished with six regions).
            if (!shared) settings.showLegend = false;
            settings.axisFontSize = Math.max(8, settings.axisFontSize - 1);
        }

        // Reserve extra margin for the horizontal legend so it never overlaps the plot
        const legendFs  = Math.max(6, settings.legendFontSize || Math.max(8, settings.axisFontSize - 1));
        const legendRowH = settings.showLegend ? legendFs + 12 : 0;  // line height + padding
        const marginL = settings.showYLabel ? 52 : 38;
        // Room for the cumulative axis on the right when the line is on.
        const showCum = this.allow("cumulative line") && settings.showCumulative;
        const marginR = showCum ? 40 : 16;
        // With small multiples the legend lives in a shared band, not in every panel.
        const ownLegend = settings.showLegend && !shared;
        const marginT = (shared ? 6 : 16) + (ownLegend && !settings.legendBottom ? legendRowH + 16 : 0);
        const marginB0 = (settings.showXLabel ? 46 : 32) + (ownLegend && settings.legendBottom ? legendRowH + 16 : 0);
        // Small multiples get one bar under the whole grid, drawn after the panels.
        const rangeOn = !shared && !compact && rangeAllowed;
        // The shortcuts show to whoever can use them, and to an author without a licence as
        // part of the Pro preview. A reader without a licence gets the free bar alone.
        const shortcutsOn = rangeOn && settings.rangeShortcuts && width >= 380 && height >= 260 && (this.isPro || this.proPreview);
        const rangeH = rangeOn ? 44 : 0, chipsH = shortcutsOn ? 26 : 0;
        const marginB = marginB0 + rangeH + chipsH + (rangeOn ? 12 : 0);
        const plotW = Math.max(20, width - marginL - marginR);
        const plotH = Math.max(20, height - marginT - marginB);

        // Con recorte manual de outliers (Pro) manda el usuario; si no, el eje se
        // calcula de forma resistente a colas largas.
        const manualTrim = trimOk && (settings.trimLower > 0 || settings.trimUpper > 0);
        // Small multiples share one value axis: the same bins in every panel, or the
        // shapes could not be compared.
        const rd = shared ? shared.rd : (manualTrim ? { lo: dMin, hi: dMax, clamped: false } : robustDomain(data));
        this.axisClamped = rd.clamped;

        const xScale = d3.scaleLinear().domain([rd.lo, rd.hi]).range([0, plotW]).nice();
        const xDomain = xScale.domain();

        // Los valores de fuera del eje caen en el bin del extremo. Asi las alturas
        // suman el total de filas: el eje se recorta, los datos no.
        const clampToAxis = (v: number) =>
            Math.min(xDomain[1], Math.max(xDomain[0], v));

        const binner = d3.bin()
            .domain(xDomain as [number, number])
            .thresholds(d3.range(xDomain[0], xDomain[1], (xDomain[1] - xDomain[0]) / effectiveBins));
        const bins = binner(data.map(clampToAxis));
        const maxCount = d3.max(bins, b => b.length) || 1;
        // A band at the top of the plot for the labels drawn over it — zone labels, then
        // one row per reference line, then the value label of the tallest bar. Bars are
        // scaled to stop below it; before, the tallest bar ran under μ and M and its
        // value label was hidden.
        const refFs = settings.axisFontSize;
        const zoneLabelsOn = this.allow("value zones") && settings.zShow && settings.zLabels && settings.zCut1 !== settings.zCut2;
        const zoneFs = settings.zLabelSize > 0 ? Math.max(6, settings.zLabelSize) : Math.max(8, settings.axisFontSize - 1);
        const zoneBand = zoneLabelsOn ? zoneFs + 8 : 0;
        const refRows = [settings.showMean, settings.showMedian, settings.showP25, settings.showP75].filter(Boolean).length;
        const vlBand = this.allow("value labels") && settings.showValueLabels ? settings.vlFontSize + 4 : 0;
        const headroom = Math.min(plotH * 0.4, zoneBand + (refRows ? 4 + refRows * (refFs + 4) : 0) + vlBand);
        const yScale = d3.scaleLinear().domain([0, shared ? shared.yMax : maxCount]).range([plotH, headroom]).nice();

        // Per bin: the rows it holds. The indices drive the exact filter; the
        // selection IDs are the fallback for models with no usable filter target.
        // Through clampToAxis, like the bars themselves: with a clipped axis the last bar says
        // "everything above", so clicking it has to filter those rows too. Before 1.5 they and
        // the row holding the maximum were left out. Trimmed rows stay out.
        const binRows = bins.map((bin, bi) =>
            rawWithIds.filter(d => {
                if (d.value < loVal || d.value > hiVal) return false;
                const v = clampToAxis(d.value);
                return v >= (bin.x0 ?? -Infinity) && (bi === bins.length - 1 ? v <= (bin.x1 ?? Infinity) : v < (bin.x1 ?? Infinity));
            })
        );

        const usedRows = rawWithIds.filter(d => d.value >= loVal && d.value <= hiVal);
        const rState = shared ? shared.range : (rangeOn ? readRange(usedRows, clampToAxis, xDomain) : null);
        const rLo = rState?.rLo ?? xDomain[0], rHi = rState?.rHi ?? xDomain[1], rActLo = rState?.rActLo ?? rLo, rActHi = rState?.rActHi ?? rHi;
        const rActive = !!rState?.rActive;
        const binSelectionIds: powerbi.extensibility.ISelectionId[][] = binRows.map(rows => rows.map(d => d.selId));
        const binIndices: number[][] = binRows.map(rows => rows.map(d => d.origIndex));

        // Bar colour per bin. Conditional formatting (fx) resolves per row and comes
        // back on categories[0].objects; a bin takes the colour of its middle row by
        // value. A single colour across every row is a plain colour the user picked
        // (the wildcard selector persists it there too), and then it paints every bar.
        const catObjs = (categories as any)?.objects as powerbi.DataViewObjects[] | undefined;
        this.uniformBarColor = null;
        if (catObjs?.length) {
            const distintos = new Set<string>();
            for (const o of catObjs) {
                const c = (o?.["histogram"]?.["barColor"] as powerbi.Fill)?.solid?.color;
                if (typeof c === "string" && c) distintos.add(c);
                if (distintos.size > 1) break;
            }
            if (distintos.size === 1) this.uniformBarColor = distintos.values().next().value;
        }
        const ruleColorOf = (rows: typeof rawWithIds): string | null => {
            if (!catObjs?.length || !rows.length) return null;
            const ordered = rows.slice().sort((a, b) => a.value - b.value);
            const mid = ordered[Math.floor(ordered.length / 2)];
            const c = (catObjs[mid.origIndex]?.["histogram"]?.["barColor"] as powerbi.Fill)?.solid?.color;
            return typeof c === "string" && c ? c : null;
        };

        // Highlighted bins for filter-in
        const highlightBinner = d3.bin()
            .domain(xDomain as [number, number])
            .thresholds(d3.range(xDomain[0], xDomain[1], (xDomain[1] - xDomain[0]) / effectiveBins));
        const highlightBins = hasHighlights ? highlightBinner(highlightedData.map(clampToAxis)) : [];

        // Effective colors: user settings → IBCS override → high contrast override
        const isHighContrast = this.host.colorPalette.isHighContrast;
        const ibcs = settings.ibcsMode;

        const estiloOk = this.allow("bar styling");
        // The style's bars need no "bar styling" licence of their own: the style already asked for Pro.
        const _userBarColor    = estiloOk ? settings.barColor    : (baseLook.barColor as string);
        const _userBorderColor = estiloOk ? settings.borderColor : (baseLook.borderColor as string);

        const barColor = isHighContrast
            ? (this.host.colorPalette.foreground?.value ?? _userBarColor)
            : (ibcs ? IBCS.bar : _userBarColor);
        const borderColor = isHighContrast
            ? (this.host.colorPalette.foregroundSelected?.value ?? _userBorderColor)
            : (ibcs ? IBCS.bar : _userBorderColor);
        const borderWidth = ibcs ? 0 : (estiloOk ? settings.borderWidth : (baseLook.borderWidth as number));
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

        // Fill precedence: high contrast → IBCS → benchmark colours → a plain colour
        // the user picked → the fx rule → the default bar colour.
        const binFill = (binIndex: number, bin: d3.Bin<number, number>): string => {
            if (isHighContrast || ibcs) return barColor;
            if (settings.showBenchmark && settings.bmColorBars && bin.x0 != null && bin.x1 != null) {
                return (bin.x0 + bin.x1) / 2 >= settings.benchmarkValue ? settings.bmAboveColor : settings.bmBelowColor;
            }
            if (estiloOk && this.uniformBarColor) return this.uniformBarColor;
            if (estiloOk) return ruleColorOf(binRows[binIndex] || []) ?? barColor;
            return barColor;
        };

        const gap = estiloOk ? Math.max(0, settings.barGap) : 1;
        const barOpacity = (this.isPro ? Math.min(100, Math.max(0, settings.barOpacity)) : 80) / 100;

        if (title) {
            if ((settings.smBackground && !isHighContrast) || settings.smBorder) {
                const fgHc = this.host.colorPalette.foreground?.value ?? "#FFFFFF";
                this.svg.append("rect").attr("class", "hp-sm-panel").attr("pointer-events", "none")
                    .attr("x", ox + 0.5).attr("y", oy + 0.5).attr("width", Math.max(0, width - 1)).attr("height", Math.max(0, cellH - 1))
                    .attr("fill", settings.smBackground && !isHighContrast ? settings.smBackground : "none")
                    .attr("stroke", settings.smBorder ? (isHighContrast ? fgHc : settings.smBorderColor) : "none");
            }
            const centred = settings.smTitleAlign === "center";
            this.svg.append("text").attr("class", "hp-sm-title")
                .attr("x", centred ? ox + width / 2 : ox + 4).attr("y", oy + Math.max(9, settings.smTitleSize))
                .attr("text-anchor", centred ? "middle" : "start")
                .attr("font-size", Math.max(9, settings.smTitleSize)).attr("font-weight", settings.smTitleBold ? "600" : "400")
                .attr("fill", isHighContrast ? (this.host.colorPalette.foreground?.value ?? "#FFFFFF") : settings.smTitleColor)
                .attr("font-family", "Segoe UI, sans-serif")
                .text(title);
        }
        const g = this.svg.append("g").attr("transform", `translate(${ox + marginL},${oy + titleH + marginT})`);

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

        // Value zones (Pro): two cuts split the value axis into three bands, each
        // labelled with its share of the rows AND, optionally, of the total value —
        // "deals above 50k: 9% of deals, 48% of revenue". Counted over the rows the
        // chart uses (after trimming), not over the bins, so the figures are exact.
        type Zone = { lo: number; hi: number; rows: number; value: number; color: string; label: string };
        let zones: Zone[] = [];
        const zoneLabels: { x0: number; x1: number; color: string; candidates: string[] }[] = [];
        if (this.allow("value zones") && settings.zShow && settings.zCut1 !== settings.zCut2) {
            const c1 = Math.min(settings.zCut1, settings.zCut2), c2 = Math.max(settings.zCut1, settings.zCut2);
            const z = [0, 0, 0], zv = [0, 0, 0];
            let totalValue = 0;
            for (const v of data) {
                const k = v <= c1 ? 0 : v <= c2 ? 1 : 2;
                z[k]++; zv[k] += v; totalValue += v;
            }
            const fc1 = formatValue(c1, formatStr), fc2 = formatValue(c2, formatStr);
            const names = [
                this.tf("UI_ZoneLow", "≤ {0}", fc1),
                this.tf("UI_ZoneMid", "{0} – {1}", fc1, fc2),
                this.tf("UI_ZoneHigh", "> {0}", fc2),
            ];
            const cols = isHighContrast
                ? [0, 1, 2].map(() => this.host.colorPalette.foreground?.value ?? "#FFFFFF")
                : (ibcs ? ["#D9D9D9", "#A6A6A6", "#595959"] : [settings.zColor1, settings.zColor2, settings.zColor3]);
            zones = [0, 1, 2].map(k => ({
                lo: k === 0 ? xDomain[0] : k === 1 ? c1 : c2,
                hi: k === 0 ? c1 : k === 1 ? c2 : xDomain[1],
                rows: z[k], value: totalValue > 0 ? zv[k] / totalValue : NaN,
                color: cols[k], label: names[k],
            }));
            const zg = g.append("g").attr("class", "value-zones").attr("pointer-events", "none");
            zones.forEach(zn => {
                const x0 = xScale(Math.max(xDomain[0], Math.min(xDomain[1], zn.lo)));
                const x1 = xScale(Math.max(xDomain[0], Math.min(xDomain[1], zn.hi)));
                if (x1 - x0 < 1) return;
                zg.append("rect").attr("x", x0).attr("y", 0).attr("width", x1 - x0).attr("height", plotH)
                    .attr("fill", isHighContrast ? "none" : zn.color).attr("fill-opacity", 0.12)
                    .attr("stroke", isHighContrast ? zn.color : "none").attr("stroke-dasharray", isHighContrast ? "3,3" : null);
                if (!settings.zLabels) return;
                const rowsPct = this.pct(100 * zn.rows / nFiltered);
                const share = this.tf("UI_ZoneRows", "{0} of rows", rowsPct);
                const valShare = settings.zValueShare && isFinite(zn.value)
                    ? " · " + this.tf("UI_ZoneValue", "{0} of value", this.pct(100 * zn.value)) : "";
                zoneLabels.push({ x0, x1, color: zn.color,
                    candidates: [`${zn.label}: ${share}${valShare}`, `${zn.label}: ${share}`, `${zn.label} · ${rowsPct}`, rowsPct] });
            });
        }
        const zoneOf = (v: number): Zone | null =>
            zones.length ? (v <= zones[0].hi ? zones[0] : v <= zones[1].hi ? zones[1] : zones[2]) : null;

        // Context menu on empty space
        this.svg.on("click", () => { this.clearSelection(); });
        this.svg.on("contextmenu", (event: MouseEvent) => {
            event.preventDefault();
            if (!this.canInteract) return;
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
            const rowIdx = binIndices[binIndex] || [];
            // A selection made here wins over highlights pushed in from other visuals.
            const binKey = `${title}|${binIndex}`;
            this.binIds.push({ key: binKey, ids });
            const isSel = (!!selVals && rowIdx.length > 0
                    && rowIdx.every(i => selVals!.has(String(categories?.values[i])))
                    && (!selPanels || panelValue === undefined || panelValue === null || selPanels.has(String(panelValue))))
                || this.selKeys.has(binKey);
            const dimF = look.dim ?? 0.25;
            const dimmedOpacity = rActive ? barOpacity * dimF : anySel ? (isSel ? barOpacity : barOpacity * 0.25)
                : (hasHighlights ? barOpacity * 0.25 : barOpacity);

            barsG.append("rect")
                .classed("hp-bar", true)
                .attr("x", bx).attr("y", by).attr("width", bw).attr("height", bh)
                .attr("fill", binFill(binIndex, bin)).attr("fill-opacity", dimmedOpacity)
                .attr("stroke", borderColor).attr("stroke-width", borderWidth)
                .attr("role", "option")
                .attr("aria-selected", isSel ? "true" : "false")
                .attr("aria-label", this.tf("UI_AriaBin", "Bin {0} to {1}, count {2}, {3} of total",
                    formatValue(bin.x0!, formatStr), formatValue(bin.x1!, formatStr), fmtNum(bin.length), this.pct((bin.length / nFiltered) * 100)))
                .style("cursor", "pointer")
                .on("mousedown", () => { this.keyboardNav = false; })
                .on("keydown", (event: KeyboardEvent) => {
                    this.keyboardNav = true;
                    if (!this.canInteract) return;
                    const nodes = barsG.selectAll<SVGRectElement, unknown>(".hp-bar").nodes();
                    const i = nodes.indexOf(event.currentTarget as SVGRectElement);
                    const go = (k: number) => {
                        const j = Math.max(0, Math.min(nodes.length - 1, k));
                        this.focusedBin = j;
                        nodes.forEach((nd, x) => nd.setAttribute("tabindex", x === j ? "0" : "-1"));
                        nodes[j]?.focus();
                    };
                    let handled = true;
                    switch (event.key) {
                        case "ArrowRight": case "ArrowDown": go(i + 1); break;
                        case "ArrowLeft":  case "ArrowUp":   go(i - 1); break;
                        case "Home": go(0); break;
                        case "End":  go(nodes.length - 1); break;
                        case "Enter": case " ": this.selectBin(rowIdx, ids, event.ctrlKey || event.metaKey, panelValue, binKey, isSel); break;
                        case "Escape": this.clearSelection(); break;
                        case "ContextMenu": {
                            const r = (event.currentTarget as SVGRectElement).getBoundingClientRect();
                            this.selectionManager.showContextMenu(ids[0] ?? null, { x: r.left + r.width / 2, y: r.top });
                            break;
                        }
                        case "F10":
                            if (event.shiftKey) {
                                const r = (event.currentTarget as SVGRectElement).getBoundingClientRect();
                                this.selectionManager.showContextMenu(ids[0] ?? null, { x: r.left + r.width / 2, y: r.top });
                            } else handled = false;
                            break;
                        default: handled = false;
                    }
                    if (handled) { event.preventDefault(); event.stopPropagation(); }
                })
                .on("click", (event: MouseEvent) => {
                    const all = barsG.selectAll<SVGRectElement, unknown>(".hp-bar").nodes();
                    const at = all.indexOf(event.currentTarget as SVGRectElement);
                    if (at >= 0) this.focusedBin = at;
                    event.stopPropagation();
                    this.selectBin(rowIdx, ids, (event as MouseEvent).ctrlKey, panelValue, binKey, isSel);
                })
                .on("contextmenu", (event: MouseEvent) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!this.canInteract) return;
                    const selId = ids.length > 0 ? ids[0] : null;
                    this.selectionManager.showContextMenu(selId, { x: event.clientX, y: event.clientY });
                })
                .on("mouseover", (event: MouseEvent) => {
                    if (!this.tooltipService.enabled()) return;
                    // Extra tooltip measures — average per bin
                    const binItems = binRows[binIndex] || [];
                    const extraItems: powerbi.extensibility.VisualTooltipDataItem[] = tooltipCols.map(tc => {
                        const vals = binItems
                            .map(d => tc.values[d.origIndex])
                            .filter(v => v != null && isFinite(+v!))
                            .map(v => +(v!));
                        const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
                        return {
                            displayName: tc.source.displayName,
                            value: avg != null ? formatValue(avg, tc.source.format ?? "") : this.t("UI_Blank", "(blank)")
                        };
                    });
                    this.tooltipService.show({
                        dataItems: [
                            { displayName: this.t("UI_TipRange", "Range"), value: `${formatValue(bin.x0!, formatStr)} – ${formatValue(bin.x1!, formatStr)}` },
                            { displayName: this.t("UI_TipCount", "Count"), value: fmtNum(bin.length) },
                            { displayName: this.t("UI_TipShare", "% of total"), value: this.pct((bin.length / nFiltered) * 100) },
                            ...(showCum ? [{ displayName: this.t("UI_TipCum", "Cumulative"),
                                value: this.pct(100 * bins.slice(0, binIndex + 1).reduce((a, b) => a + b.length, 0) / nFiltered) }] : []),
                            ...(zones.length && bin.x0 != null && bin.x1 != null
                                ? [{ displayName: this.t("UI_TipZone", "Zone"), value: zoneOf((bin.x0 + bin.x1) / 2)?.label ?? "" }] : []),
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
            // The label sits ABOVE the bar, so a short bar still has room for it. The old
            // bh > 14 test came from labels drawn inside the bar and hid small bins.
            if (this.allow("value labels") && settings.showValueLabels && bh > 0) {
                const labelVal = settings.vlShowPercent ? this.pct((bin.length / nFiltered) * 100) : fmtNum(bin.length);
                barsG.append("text")
                    .attr("x", bx + bw / 2).attr("y", by - 3)
                    .attr("text-anchor", "middle").attr("font-size", settings.vlFontSize)
                    .attr("fill", settings.vlColor).text(labelVal);
            }
        });

        // One Tab stop for the whole chart (roving tabindex); the arrows walk the bins.
        {
            const nodes = barsG.selectAll<SVGRectElement, unknown>(".hp-bar").nodes();
            this.focusedBin = Math.max(0, Math.min(this.focusedBin, nodes.length - 1));
            nodes.forEach((nd, x) => nd.setAttribute("tabindex", x === this.focusedBin ? "0" : "-1"));
            this.svg.attr("role", "listbox").attr("aria-label",
                this.tf("UI_AriaChart", "Histogram of {0}, {1} bins.", mainValueCol.source.displayName ?? "", String(nodes.length)));
            if (this.restoreFocus) { this.restoreFocus = false; nodes[this.focusedBin]?.focus(); }
        }

        // Filter-in overlay (highlighted bars at full opacity)
        if (hasHighlights && !anySel) {
            highlightBins.forEach((hbin, hi) => {
                if (hbin.x0 == null || hbin.x1 == null || hbin.length === 0) return;
                const bx = xScale(hbin.x0) + gap / 2;
                const bw = Math.max(0, xScale(hbin.x1) - xScale(hbin.x0) - gap);
                const by = yScale(hbin.length);
                const bh = plotH - yScale(hbin.length);
                if (bw <= 0 || bh <= 0) return;
                barsG.append("rect")
                    .attr("x", bx).attr("y", by).attr("width", bw).attr("height", bh)
                    .attr("fill", bins[hi] ? binFill(hi, bins[hi]) : barColor).attr("fill-opacity", barOpacity)
                    .attr("stroke", borderColor).attr("stroke-width", borderWidth)
                    .style("pointer-events", "none");
            });
        }

        // X axis
        g.append("g").attr("class", "hp-axis").attr("transform", `translate(0,${plotH})`)
            .call(d3.axisBottom(xScale).tickFormat(d => formatValue(+d, formatStr)).ticks(Math.min(effectiveBins, 8, Math.max(2, Math.floor(plotW / (settings.axisFontSize * 4.5))))))
            .call(sel => {
                sel.select(".domain").attr("stroke", effectiveAxisColor);
                sel.selectAll("text").attr("fill", effectiveAxisColor).attr("font-size", settings.axisFontSize);
                sel.selectAll(".tick line").attr("stroke", effectiveAxisColor);
            });

        const rangeArgs: RangeArgs = {
            plotW, y: plotH + marginB0 + 10, xScale, dom: xDomain, rows: usedRows, data, sum: usedRows.reduce((t, d) => t + d.value, 0),
            panels: [{ g, barsG, xScale, plotH, bars: bins.map((bin, i) => ({ x: xScale(bin.x0 ?? 0) + gap / 2, w: Math.max(0, xScale(bin.x1 ?? 0) - xScale(bin.x0 ?? 0) - gap),
                y: yScale(bin.length), h: plotH - yScale(bin.length), fill: binFill(i, bin) })) }],
            left: ox + marginL, top: oy + titleH + marginT,
            inColor: this.allow("bar styling") && !isHighContrast ? settings.rangeInColor : "",
            outColor: this.allow("bar styling") && !isHighContrast ? settings.rangeOutColor : "",
            barOpacity, dim: look.dim ?? 0.25, rLo, rHi, rActLo, rActHi, rActive, shortcutsOn, step: (xDomain[1] - xDomain[0]) / effectiveBins, stroke: borderColor, strokeW: borderWidth,
            hc: isHighContrast, axisColor: effectiveAxisColor, gridColor: effectiveGridColor,
            accent: isHighContrast ? (this.host.colorPalette.foregroundSelected?.value ?? "#FFFF00") : (settings.rangeColor || look.accent),
            fmt: (v: number) => formatValue(v, formatStr), fs: settings.axisFontSize,
        };
        if (rangeOn) this.drawRange(g, rangeArgs);
        else if (shared?.range) { gridArgs = rangeArgs; gridPanels.push(rangeArgs.panels[0]); }

        // Y axis
        g.append("g").attr("class", "hp-axis").call(d3.axisLeft(yScale).ticks(5).tickFormat(d => fmtNum(+d)))
            .call(sel => {
                sel.select(".domain").attr("stroke", effectiveAxisColor);
                sel.selectAll("text").attr("fill", effectiveAxisColor).attr("font-size", settings.axisFontSize);
                sel.selectAll(".tick line").attr("stroke", effectiveAxisColor);
            });

        if (settings.showYLabel) {
            g.append("text").attr("transform", "rotate(-90)").attr("x", -plotH / 2).attr("y", -marginL + 12)
                .attr("text-anchor", "middle").attr("font-size", settings.axisFontSize).attr("fill", effectiveAxisColor).text(this.t("UI_AxisY", "Count"));
        }
        if (settings.showXLabel) {
            g.append("text").attr("x", plotW / 2).attr("y", plotH + marginB0 - 6)
                .attr("text-anchor", "middle").attr("font-size", settings.axisFontSize).attr("fill", effectiveAxisColor)
                .text(mainValueCol.source.displayName || this.t("UI_AxisX", "Value"));
        }

        // Mean line
        const effectiveMeanColor   = isHighContrast ? (this.host.colorPalette.foreground?.value ?? settings.meanColor)   : (ibcs ? IBCS.mean   : settings.meanColor);
        const effectiveMedianColor = isHighContrast ? (this.host.colorPalette.foregroundSelected?.value ?? settings.medianColor) : (ibcs ? IBCS.median : settings.medianColor);
        const effectiveP25Color    = isHighContrast ? (this.host.colorPalette.foreground?.value ?? settings.p25Color)    : (ibcs ? IBCS.p25    : settings.p25Color);
        const effectiveP75Color    = isHighContrast ? (this.host.colorPalette.foreground?.value ?? settings.p75Color)    : (ibcs ? IBCS.p75    : settings.p75Color);


        // A background box behind every label drawn over the plot — reference lines and
        // value zones. They sit over bars and shaded zones, where a coloured label alone
        // cannot be read. Colour and opacity are in Statistics → Label background; a
        // halo picked from the text colour looked heavy on light report backgrounds.
        const labelBg = isHighContrast ? (this.host.colorPalette.background?.value ?? "#000000") : settings.labelBgColor;
        const labelBgOp = isHighContrast ? 1 : Math.min(100, Math.max(0, settings.labelBgOpacity)) / 100;
        const withHalo = (sel: d3.Selection<SVGTextElement, unknown, null, undefined>, _c?: string, bg = labelBg, bgOp = labelBgOp) => {
            const node = sel.node();
            if (!node || typeof node.getBBox !== "function" || bgOp <= 0) return sel;
            const bb = node.getBBox();
            d3.select(node.parentNode as SVGGElement).insert("rect", () => node)
                .attr("x", bb.x - 3).attr("y", bb.y - 1).attr("width", bb.width + 6).attr("height", bb.height + 2)
                .attr("rx", 3).attr("fill", bg).attr("fill-opacity", bgOp).attr("pointer-events", "none");
            return sel;
        };

        // Value zone labels, in front of the bars, at the top of each zone. Each takes the
        // longest wording that fits its zone, measured, not estimated.
        let refTop = 0;
        if (zoneLabels.length) {
            const zfs = zoneFs;
            const zBg = isHighContrast ? labelBg : (settings.zLabelBg || labelBg);
            const zOp = isHighContrast ? 1 : Math.min(100, Math.max(0, settings.zLabelBgOpacity)) / 100;
            // Con poco fondo propio, el texto se lee sobre lo que hay detrás: el fondo del visual.
            const behind = zOp >= 0.5 ? zBg : (look.bg ?? look.grad?.[1] ?? this.host.colorPalette.background?.value ?? "#FFFFFF");
            const zl = g.append("g").attr("class", "zone-labels").attr("pointer-events", "none");
            for (const zl0 of zoneLabels) {
                const avail = zl0.x1 - zl0.x0 - 8;
                const el = zl.append("text").attr("x", zl0.x0 + 4).attr("y", zfs + 2)
                    .attr("font-size", zfs).attr("font-weight", "600")
                    .attr("fill", isHighContrast ? zl0.color : (settings.zLabelColor || readableOn(zl0.color, behind)));
                let ok = false;
                for (const c of zl0.candidates) {
                    el.text(c);
                    const w = (el.node() as SVGTextElement).getComputedTextLength?.() ?? c.length * zfs * 0.6;
                    if (w <= avail) { ok = true; break; }
                }
                if (!ok) { el.remove(); continue; }
                withHalo(el, undefined, zBg, zOp);
            }
            refTop = zfs + 8;
        }

        // Reference labels stack in the rows that are in use, in the band reserved above.
        let refRow = 0;
        const nextRefY = () => refTop + refFs + 2 + (refRow++) * (refFs + 4);

        if (settings.showMean && mean >= xDomain[0] && mean <= xDomain[1]) {
            const mx = xScale(mean);
            const meanDash = ibcs ? IBCS.meanDash : "4,3";  // IBCS: solid; default: dashed
            g.append("line").attr("x1", mx).attr("y1", 0).attr("x2", mx).attr("y2", plotH)
                .attr("stroke", effectiveMeanColor).attr("stroke-width", ibcs ? 2 : 1.5)
                .attr("stroke-dasharray", meanDash || null!);
            withHalo(g.append("text").attr("x", mx + 4).attr("y", nextRefY())
                .attr("fill", effectiveMeanColor).attr("font-size", settings.axisFontSize)
                .attr("font-weight", ibcs ? "600" : "normal")
                .text(`μ ${formatValue(mean, formatStr)}`), effectiveMeanColor);
        }

        // Median line
        if (settings.showMedian && median >= xDomain[0] && median <= xDomain[1]) {
            const mdx = xScale(median);
            const medianDash = ibcs ? IBCS.medianDash : "6,3";
            g.append("line").attr("x1", mdx).attr("y1", 0).attr("x2", mdx).attr("y2", plotH)
                .attr("stroke", effectiveMedianColor).attr("stroke-width", 1.5)
                .attr("stroke-dasharray", medianDash);
            withHalo(g.append("text").attr("x", mdx + 4).attr("y", nextRefY())
                .attr("fill", effectiveMedianColor).attr("font-size", settings.axisFontSize).text(`M ${formatValue(median, formatStr)}`), effectiveMedianColor);
        }

        // P25 / P75 quartile lines
        if (settings.showP25 && p25 >= xDomain[0] && p25 <= xDomain[1]) {
            const px25 = xScale(p25);
            g.append("line").attr("x1", px25).attr("y1", 0).attr("x2", px25).attr("y2", plotH)
                .attr("stroke", effectiveP25Color).attr("stroke-width", 1).attr("stroke-dasharray", "3,4");
            withHalo(g.append("text").attr("x", px25 + 4).attr("y", nextRefY())
                .attr("fill", effectiveP25Color).attr("font-size", settings.axisFontSize).text(`Q1 ${formatValue(p25, formatStr)}`), effectiveP25Color);
        }

        if (settings.showP75 && p75 >= xDomain[0] && p75 <= xDomain[1]) {
            const px75 = xScale(p75);
            g.append("line").attr("x1", px75).attr("y1", 0).attr("x2", px75).attr("y2", plotH)
                .attr("stroke", effectiveP75Color).attr("stroke-width", 1).attr("stroke-dasharray", "3,4");
            withHalo(g.append("text").attr("x", px75 + 4).attr("y", nextRefY())
                .attr("fill", effectiveP75Color).attr("font-size", settings.axisFontSize).text(`Q3 ${formatValue(p75, formatStr)}`), effectiveP75Color);
        }

        // Benchmark line — user-defined vertical reference
        if (settings.showBenchmark) {
            const bv = settings.benchmarkValue;
            if (bv >= xDomain[0] && bv <= xDomain[1]) {
                const bmX = xScale(bv);
                const bmLabel = (settings.benchmarkLabel && settings.benchmarkLabel !== DEFAULTS.benchmarkLabel)
                    ? settings.benchmarkLabel : this.t("UI_Target", "Target");
                g.append("line")
                    .attr("x1", bmX).attr("y1", 0).attr("x2", bmX).attr("y2", plotH)
                    .attr("stroke", bmColor).attr("stroke-width", ibcs ? 2.5 : 2);
                withHalo(g.append("text")
                    .attr("x", bmX + 4).attr("y", plotH - 6)
                    .attr("fill", bmColor).attr("font-size", settings.axisFontSize)
                    .attr("font-weight", ibcs ? "700" : "600")
                    .text(`${bmLabel}: ${formatValue(bv, formatStr)}`), bmColor);
            }
        }

        // Cumulative frequency (Pro): the share of rows up to the end of each bin, on its
        // own 0–100% axis at the right. Read with the value zones it answers "how many
        // deals are below 10K" without counting bars.
        if (showCum) {
            const cumColor = isHighContrast ? (this.host.colorPalette.foreground?.value ?? settings.cumulativeColor)
                : (ibcs ? "#262626" : settings.cumulativeColor);
            const yC = d3.scaleLinear().domain([0, 100]).range([plotH, headroom]);
            let acc = 0;
            const pts: [number, number][] = [];
            if (bins.length && bins[0].x0 != null) pts.push([xScale(bins[0].x0), yC(0)]);
            for (const b of bins) {
                if (b.x1 == null) continue;
                acc += b.length;
                pts.push([xScale(b.x1), yC(100 * acc / nFiltered)]);
            }
            g.append("path").datum(pts).attr("fill", "none").attr("stroke", cumColor).attr("stroke-width", 2)
                .attr("pointer-events", "none")
                .attr("d", d3.line<[number, number]>().x(d => d[0]).y(d => d[1]).curve(d3.curveMonotoneX));
            g.selectAll(".cum-pt").data(pts.slice(1)).enter().append("circle")
                .attr("cx", d => d[0]).attr("cy", d => d[1]).attr("r", 2.5)
                .attr("fill", cumColor).attr("pointer-events", "none");
            g.append("g").attr("transform", `translate(${plotW},0)`)
                .call(d3.axisRight(yC).ticks(plotH < 160 ? 2 : 4).tickFormat(d => this.pct(Number(d), 0)))
                .call(sel => {
                    sel.select(".domain").attr("stroke", effectiveAxisColor);
                    sel.selectAll("text").attr("fill", effectiveAxisColor).attr("font-size", settings.axisFontSize);
                    sel.selectAll(".tick line").attr("stroke", effectiveAxisColor);
                });
        }

        // Normal curve (Pro only)
        if (this.allow("normal curve") && settings.showNormal && std > 0) {
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

            // With a long tail σ is far wider than the clipped axis, and over the visible
            // range the bell is flat: correct, but it reads as a broken line. Say why.
            const binW = (xDomain[1] - xDomain[0]) / effectiveBins;
            const dens = (d: number) => (1 / (std * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((d - mean) / std) ** 2) * nFiltered * binW;
            let peakX = xDomain[0], peakY = 0;
            for (const d of pts) { const y = dens(d); if (y > peakY) { peakY = y; peakX = d; } }
            if (peakY < maxCount * 0.2 && plotW >= 200) {
                const tx = Math.max(4, Math.min(plotW - 4, xScale(peakX)));
                withHalo(g.append("text")
                    .attr("x", tx).attr("y", Math.max(12, yScale(peakY) - 8))
                    .attr("text-anchor", tx < plotW * 0.3 ? "start" : tx > plotW * 0.7 ? "end" : "middle")
                    .attr("fill", settings.normalColor).attr("font-size", Math.max(8, settings.axisFontSize - 1))
                    .attr("pointer-events", "none")
                    .text(this.tf("UI_NormalFlat", "Normal curve flat: data far from normal (σ = {0})", formatValue(std, formatStr))), settings.normalColor);
            }
        }

        // Stats panel (Pro only)
        if (this.allow("statistics panel") && settings.showStats && plotW >= 260) {
            const lines = [
                `n = ${fmtNum(nFiltered)}${n > nFiltered ? ` (${this.tf("UI_Trimmed", "{0} trimmed", fmtNum(n - nFiltered))})` : ""}`,
                `μ = ${formatValue(mean, formatStr)}`, `M = ${formatValue(median, formatStr)}`,
                `σ = ${formatValue(std, formatStr)}`,
                `min = ${formatValue(dMin, formatStr)}`, `max = ${formatValue(dMax, formatStr)}`,
            ];
            const px = plotW - 110, py = 8 + refTop;
            const lh = settings.axisFontSize + 3;
            const sg = g.append("g").attr("class", "hp-stats");
            sg.append("rect").attr("x", px - 6).attr("y", py - 4).attr("width", 116).attr("height", lines.length * lh + 6)
                .attr("fill", isHighContrast ? (this.host.colorPalette.background?.value ?? "#000000") : settings.statsBgColor)
                .attr("fill-opacity", isHighContrast ? 1 : Math.min(100, Math.max(0, settings.statsBgOpacity)) / 100)
                .attr("rx", 4);
            lines.forEach((line, i) => {
                sg.append("text").attr("x", px).attr("y", py + i * lh + settings.axisFontSize)
                    .attr("fill", settings.statsColor).attr("font-size", settings.axisFontSize).attr("font-family", "monospace").text(line);
            });
        }

        // Legend — horizontal, Bullet-style (icon + label, no background)
        if (settings.showLegend && showLegendHere) {
            type LegendItem = { label: string; color: string; dash: string; w: number; kind: "hline" | "vline" };
            const items: LegendItem[] = [];
            const meanDash = ibcs ? "" : "4,3";
            const medDash  = ibcs ? "4,3" : "6,3";

            const dflt = (v: string, d: string, key: string) => (!v || v === d) ? this.t(key, d) : v;
            if (settings.showMean)                 items.push({ label: dflt(settings.legendMeanLabel, DEFAULTS.legendMeanLabel, "UI_LegMean"),   color: effectiveMeanColor,   dash: meanDash, w: ibcs ? 2 : 1.5, kind: "hline" });
            if (settings.showMedian)               items.push({ label: dflt(settings.legendMedianLabel, DEFAULTS.legendMedianLabel, "UI_LegMedian"), color: effectiveMedianColor, dash: medDash,  w: 1.5,            kind: "hline" });
            if (settings.showP25)                  items.push({ label: settings.legendP25Label    || DEFAULTS.legendP25Label,    color: effectiveP25Color,    dash: "3,4",    w: 1,              kind: "hline" });
            if (settings.showP75)                  items.push({ label: settings.legendP75Label    || DEFAULTS.legendP75Label,    color: effectiveP75Color,    dash: "3,4",    w: 1,              kind: "hline" });
            if (showCum) items.push({ label: this.t("UI_LegCum", "Cumulative"), color: settings.cumulativeColor, dash: "", w: 2, kind: "hline" });
            if (this.isPro && settings.showNormal) items.push({ label: dflt(settings.legendNormalLabel, DEFAULTS.legendNormalLabel, "UI_LegNormal"), color: settings.normalColor, dash: "",       w: 2,              kind: "hline" });
            if (settings.showBenchmark)            items.push({ label: dflt(settings.benchmarkLabel, DEFAULTS.benchmarkLabel, "UI_Target"),                  color: bmColor,              dash: "",       w: ibcs ? 2.5 : 2, kind: "vline" });

            if (items.length > 0) {
                const fs      = Math.max(6, settings.legendFontSize || Math.max(8, settings.axisFontSize - 1));
                const iconW   = 16;   // width of icon area
                const iconH   = fs;   // height of icon area (matches text cap height)
                const gap     = 5;    // icon → text
                const itemGap = 16;   // item → item

                // Estimate each item's total width
                const itemWidths = items.map(it => iconW + gap + it.label.length * (fs * 0.56));
                const totalW = itemWidths.reduce((a, b) => a + b, 0) + itemGap * (items.length - 1);

                // Center in plot width; clamp inside bounds
                const lx0 = shared
                    ? -(ox + marginL) + Math.max(0, (fullW - totalW) / 2)   // centred across the whole visual
                    : Math.max(0, (plotW - totalW) / 2);

                // Vertical centre of the legend row
                // top:    just above the plot — sits in the reserved top margin
                // bottom: below the x-axis tick labels (ticks ~3px + label ~fontSize + 4px gap)
                const cy = shared
                    ? (settings.legendBottom
                        ? (fullH - bottomBandG - legendBand / 2) - (oy + titleH + marginT)   // shared band at the bottom
                        : -(oy + titleH + marginT) + legendBand / 2)                        // shared band at the top
                    : settings.legendBottom
                        ? plotH + settings.axisFontSize + 22   // clear tick labels + gap
                        : -(legendRowH + 8);                   // above plot with breathing room

                const textFill = isHighContrast
                    ? (this.host.colorPalette.foreground?.value ?? effectiveAxisColor)
                    : settings.legendColor;

                let cx = lx0;
                const lg = g.append("g").attr("class", "hp-legend");
                items.forEach((item, i) => {
                    if (item.kind === "vline") {
                        // Vertical bar icon (like "Target" in Bullet)
                        const midX = cx + iconW / 2;
                        lg.append("line")
                            .attr("x1", midX).attr("y1", cy - iconH / 2)
                            .attr("x2", midX).attr("y2", cy + iconH / 2)
                            .attr("stroke", item.color).attr("stroke-width", item.w)
                            .attr("pointer-events", "none");
                    } else {
                        // Horizontal line icon
                        lg.append("line")
                            .attr("x1", cx).attr("y1", cy)
                            .attr("x2", cx + iconW).attr("y2", cy)
                            .attr("stroke", item.color).attr("stroke-width", item.w)
                            .attr("stroke-dasharray", item.dash || null!)
                            .attr("pointer-events", "none");
                    }
                    lg.append("text")
                        .attr("x", cx + iconW + gap)
                        .attr("y", cy + fs * 0.35)   // optical vertical alignment
                        .attr("fill", textFill).attr("font-size", fs)
                        .attr("pointer-events", "none")
                        .text(item.label);
                    cx += itemWidths[i] + itemGap;
                });
            }
        }

        if (!clampDone) { clampDone = true; this.renderClampNotice(fullW, fullH, formatValue(xDomain[1], formatStr)); }
        };

        if (!usePanels) {
            drawPanel(raw, rawWithIds, highlightedRaw, 0, 0, width, height, null, "", undefined, true);
        } else {
            // One histogram per panel value, on one value axis and one count axis.
            if (raw.length < 2) return;
            const all = raw.slice().sort((x, y) => x - y);
            const trimOk = this.allow("outlier trimming");
            const lo = trimOk && settings.trimLower > 0 ? percentile(all, settings.trimLower) : all[0];
            const hi = trimOk && settings.trimUpper > 0 ? percentile(all, 100 - settings.trimUpper) : all[all.length - 1];
            const kept = all.filter(v => v >= lo && v <= hi);
            if (kept.length < 2) return;
            const manualTrim = trimOk && (settings.trimLower > 0 || settings.trimUpper > 0);
            const rd = manualTrim ? { lo: kept[0], hi: kept[kept.length - 1], clamped: false } : robustDomain(kept);
            const xd = d3.scaleLinear().domain([rd.lo, rd.hi]).nice().domain();
            const thresholds = d3.range(xd[0], xd[1], (xd[1] - xd[0]) / effectiveBins);
            const clamp = (v: number) => Math.min(xd[1], Math.max(xd[0], v));

            const groups = new Map<string, RowT[]>();
            for (const r of rawWithIds) {
                let arr = groups.get(r.panel);
                if (!arr) { arr = []; groups.set(r.panel, arr); }
                arr.push(r);
            }
            const firstRow = new Map<string, number>();
            for (const r of rawWithIds) if (!firstRow.has(r.panel)) firstRow.set(r.panel, r.origIndex);
            const keys = Array.from(groups.keys()).sort((p, q) => {
                const vp = panCol?.values[firstRow.get(p)!], vq = panCol?.values[firstRow.get(q)!];
                if (typeof vp === "number" && typeof vq === "number") return vp - vq;
                if (vp instanceof Date && vq instanceof Date) return vp.getTime() - vq.getTime();
                return String(vp ?? "").localeCompare(String(vq ?? ""), this.host.locale);
            });
            let yMax = 1;
            for (const k of keys) {
                const vals = groups.get(k)!.map(r => r.value).filter(v => v >= lo && v <= hi).map(clamp);
                const b = d3.bin().domain(xd as [number, number]).thresholds(thresholds)(vals);
                yMax = Math.max(yMax, d3.max(b, x => x.length) ?? 0);
            }
            const gridRows = rawWithIds.filter(d => d.value >= lo && d.value <= hi);
            const shared: Shared = { lo, hi, rd, scaleRef: Math.max(Math.abs(all[0]), Math.abs(all[all.length - 1])), yMax, range: null };

            const np = keys.length;
            const cols = settings.smColumns >= 1
                ? Math.min(np, Math.round(settings.smColumns))
                : Math.max(1, Math.min(np, Math.round(Math.sqrt(np * (width / Math.max(1, height)) / 1.6))));
            const rows = Math.ceil(np / cols);
            const gapPx = Math.min(60, Math.max(0, settings.smGap));
            // Bands outside the grid: the shared legend on top, and room at the bottom for
            // the clipped-axis notice so it does not sit on the last panel's axis title.
            legendBand = settings.showLegend
                ? Math.max(6, settings.legendFontSize || Math.max(8, settings.axisFontSize - 1)) + 18 : 0;
            const bottomBand = rd.clamped ? 14 : 0;
            bottomBandG = bottomBand;
            // One range bar for the grid, if the panels keep a readable height without its band.
            const gridShortcuts = settings.rangeShortcuts && width >= 380 && (this.isPro || this.proPreview);
            const rangeBandH = 18 + 44 + (gridShortcuts ? 26 : 0);
            const gridRange = rangeAllowed && width >= 320
                && (height - legendBand - bottomBand - rangeBandH - gapPx * (rows - 1)) / rows >= 110;
            if (gridRange) shared.range = readRange(gridRows, clamp, xd);
            const gridH = height - legendBand - bottomBand - (gridRange ? rangeBandH : 0);
            // "Position: bottom" puts the shared legend under the grid instead of above it.
            const gridTop = settings.legendBottom ? 0 : legendBand;
            const cw = (width - gapPx * (cols - 1)) / cols;
            const chh = (gridH - gapPx * (rows - 1)) / rows;
            keys.forEach((k, i) => {
                const rs = groups.get(k)!;
                const vals = rs.map(r => r.value);
                const hlv = rs.filter(r => r.hl).map(r => r.value);
                const pv = panCol?.values[firstRow.get(k)!];
                const ttl = pv === null || pv === undefined || pv === "" ? this.t("UI_Blank", "(blank)")
                    : (pv instanceof Date || typeof pv === "number")
                        ? this.fmtNumber(pv as any, panCol?.source?.format || undefined, 0) || String(pv)
                        : String(pv);
                drawPanel(vals, rs, hlv, (i % cols) * (cw + gapPx), gridTop + Math.floor(i / cols) * (chh + gapPx),
                          cw, chh, shared, ttl, pv ?? null, i === 0);
            });
            if (gridRange && gridArgs) {
                const left = 52, top = gridTop + gridH + 16, barW = Math.max(20, width - left - 16);
                const gridG = this.svg.append("g").attr("transform", `translate(${left},${top})`);
                this.drawRange(gridG, {
                    ...(gridArgs as RangeArgs), panels: gridPanels, plotW: barW, y: 0, left, top, shortcutsOn: gridShortcuts,
                    xScale: d3.scaleLinear().domain(xd).range([0, barW]), dom: xd, rows: gridRows, data: kept,
                    sum: gridRows.reduce((t, d) => t + d.value, 0),
                });
            }
        }
        this.renderTruncationNotice(width);
        this.renderWatermark(width, height);
        if (look.font) this.svg.selectAll("text").style("font-family", look.font);
        if (this.rangeFocus) {
            (this.svg.select(`.hp-handle-${this.rangeFocus}`).node() as HTMLElement | null)?.focus();
        }

        // No Free badge is drawn. It was licensing UI of the visual's own, which
        // Microsoft's guidance advises against, and it behaved as a watermark on
        // the free tier while offering nothing to click. Power BI's predefined
        // notifications carry the purchase path instead - see
        // applyLicenseNotifications().
    }

    /**
     * The range bar under the axis: two handles and, for those with Pro, shortcuts by quartile
     * and a line that says what the range holds. Drawn on the plot's own x scale, so a handle
     * sits under the value it stands for. Dragging repaints only the bar and the overlay; the
     * report is filtered on release, not at every pixel.
     */
    private drawRange(g: d3.Selection<SVGGElement, unknown, null, undefined>, o: RangeArgs): void {
        const { plotW, xScale, dom } = o;
        let lo = o.rLo, hi = o.rHi, active = o.rActive;
        const bound = (v: number) => Math.min(dom[1], Math.max(dom[0], v));

        // The selected stretch of the bars, at full strength: a range can end inside a bar.
        const overlays = o.panels.map((p, n) => {
            const clipId = `hp-range-clip-${n}`;
            const clipRect = p.g.append("clipPath").attr("id", clipId).append("rect").attr("y", -2).attr("height", p.plotH + 4);
            const over = p.barsG.append("g").attr("class", "hp-range-over").attr("clip-path", `url(#${clipId})`).attr("pointer-events", "none");
            for (const b of p.bars) {
                if (b.w <= 0 || b.h <= 0) continue;
                over.append("rect").attr("x", b.x).attr("y", b.y).attr("width", b.w).attr("height", b.h)
                    .attr("fill", o.inColor || b.fill).attr("fill-opacity", o.barOpacity).attr("stroke", o.stroke).attr("stroke-width", o.strokeW);
            }
            return { p, clipRect, over };
        });

        const rg = g.append("g").attr("class", "hp-range").attr("transform", `translate(0,${o.y})`);
        rg.append("line").attr("x1", 0).attr("x2", plotW).attr("stroke", o.axisColor).attr("stroke-opacity", 0.35).attr("stroke-width", 3).attr("stroke-linecap", "round");
        const seg = rg.append("line").attr("stroke", o.accent).attr("stroke-width", 3).attr("stroke-linecap", "round");
        const label = rg.append("text").attr("y", 24).attr("font-size", Math.max(9, o.fs)).attr("fill", o.axisColor).attr("pointer-events", "none");

        const hit = rg.append("rect").attr("x", -8).attr("y", -10).attr("width", plotW + 16).attr("height", 20)
            .attr("fill", "transparent").style("cursor", "ew-resize").style("touch-action", "none");

        const handle = (side: "lo" | "hi", aria: string) => rg.append("rect")
            .attr("class", `hp-handle hp-handle-${side}`).attr("y", -7).attr("width", 10).attr("height", 14).attr("rx", 4)
            .attr("fill", o.hc ? (this.host.colorPalette.background?.value ?? "#000000") : "#FFFFFF")
            .attr("stroke", o.accent).attr("stroke-width", 2).attr("pointer-events", "none")
            .attr("tabindex", 0).attr("role", "slider").attr("aria-label", aria)
            .attr("aria-valuemin", dom[0]).attr("aria-valuemax", dom[1]);
        const hLo = handle("lo", this.t("UI_RangeMin", "Range minimum"));
        const hHi = handle("hi", this.t("UI_RangeMax", "Range maximum"));

        const paint = () => {
            const a = xScale(lo), b = xScale(hi);
            seg.attr("x1", a).attr("x2", b).attr("display", active ? null : "none");
            hLo.attr("x", a - 5).attr("aria-valuenow", lo).attr("aria-valuetext", o.fmt(lo));
            hHi.attr("x", b - 5).attr("aria-valuenow", hi).attr("aria-valuetext", o.fmt(hi));
            for (const { p, clipRect, over } of overlays) {
                const pa = p.xScale(lo), pb = p.xScale(hi);
                clipRect.attr("x", pa).attr("width", Math.max(0, pb - pa));
                over.attr("display", active ? null : "none");
                p.barsG.selectAll(".hp-bar").attr("fill-opacity", (_d, i, nodes) => active
                    ? (o.outColor ? o.barOpacity : o.barOpacity * o.dim)
                    : (nodes[i] as SVGRectElement).getAttribute("data-op") ?? o.barOpacity)
                    .attr("fill", (_d, i, nodes) => active && o.outColor ? o.outColor
                        : (nodes[i] as SVGRectElement).getAttribute("data-fill"));
            }
            if (inLo) inLo.value = active ? plain(lo) : "";
            if (inHi) inHi.value = active ? plain(hi) : "";
            const mid = Math.max(40, Math.min(plotW - 40, (a + b) / 2));
            label.attr("x", mid).attr("text-anchor", "middle").attr("display", active ? null : "none")
                .text(`${o.fmt(lo)} – ${o.fmt(hi)}${hi >= dom[1] && o.data[o.data.length - 1] > dom[1] ? "+" : ""}`);
        };
        for (const p of o.panels) p.barsG.selectAll(".hp-bar")
            .attr("data-op", (_d, i, nodes) => (nodes[i] as SVGRectElement).getAttribute("fill-opacity"))
            .attr("data-fill", (_d, i, nodes) => (nodes[i] as SVGRectElement).getAttribute("fill"));

        // Minimum and maximum, typed: the exact value, and the way in on touch and with a screen reader.
        const plain = (v: number) => String(Math.round(v * 100) / 100);
        const field = (side: "lo" | "hi", aria: string, value: string, on: boolean, x: number): HTMLInputElement | null => {
            if (plotW < 240) return null;
            const inp = this.container.append("input").classed("hp-range-input", true)
                .attr("type", "text").attr("inputmode", "decimal").attr("aria-label", aria).attr("placeholder", side === "lo" ? this.t("UI_Min", "Min") : this.t("UI_Max", "Max"))
                .style("position", "absolute").style("left", `${o.left + x}px`).style("top", `${o.top + o.y + 13}px`)
                .style("width", "62px").style("height", "20px").style("padding", "0 4px").style("box-sizing", "border-box")
                .style("font-size", "11px").style("font-family", "inherit").style("color", o.axisColor).style("background", "transparent")
                .style("border", `1px solid ${o.axisColor}`).style("border-radius", "4px")
                .style("text-align", side === "lo" ? "left" : "right").node() as HTMLInputElement;
            inp.value = on ? value : "";
            const start = inp.value;
            let done = false;
            const commit = () => {
                // Enter and the blur that follows the repaint would both fire: one edit, one filter.
                if (done || inp.value === start) return;
                done = true;
                const txt = inp.value.trim().replace(",", ".");
                const v = Number(txt);
                if (txt === "" || !isFinite(v)) {
                    if (side === "lo") lo = dom[0]; else hi = dom[1];
                } else if (side === "lo") lo = Math.min(bound(v), hi);
                else hi = Math.max(bound(v), lo);
                active = lo > dom[0] || hi < dom[1];
                this.applyRange(o.rows, lo, hi, dom);
            };
            inp.addEventListener("keydown", (e: KeyboardEvent) => {
                e.stopPropagation();
                if (e.key === "Enter") { e.preventDefault(); commit(); }
                else if (e.key === "Escape") { this.clearSelection(); }
            });
            inp.addEventListener("change", commit);
            inp.addEventListener("click", (e: MouseEvent) => e.stopPropagation());
            return inp;
        };
        const inLo = field("lo", this.t("UI_RangeMin", "Range minimum"), plain(lo), active, 0);
        const inHi = field("hi", this.t("UI_RangeMax", "Range maximum"), plain(hi), active, plotW - 62);
        paint();

        // Mouse and touch: a press near a handle moves it, inside the range moves both, and
        // anywhere else brings the nearest handle there.
        let mode: "lo" | "hi" | "move" | null = null, grab = 0;
        const px = (e: PointerEvent) => {
            const r = (hit.node() as SVGRectElement).getBoundingClientRect();
            return e.clientX - r.left - 8;
        };
        hit.on("pointerdown", (e: PointerEvent) => {
            if (e.button) return;
            e.preventDefault(); e.stopPropagation();
            this.keyboardNav = false; this.rangeFocus = null;
            const x = px(e), a = xScale(lo), b = xScale(hi);
            if (active && Math.abs(x - a) <= 8) mode = "lo";
            else if (active && Math.abs(x - b) <= 8) mode = "hi";
            else if (active && x > a && x < b) { mode = "move"; grab = xScale.invert(x) - lo; }
            else if (Math.abs(x - a) <= Math.abs(x - b)) { mode = "lo"; lo = bound(xScale.invert(x)); }
            else { mode = "hi"; hi = bound(xScale.invert(x)); }
            active = true;
            (hit.node() as SVGRectElement).setPointerCapture?.(e.pointerId);
            paint();
        }).on("pointermove", (e: PointerEvent) => {
            if (!mode) return;
            const v = bound(xScale.invert(px(e)));
            if (mode === "lo") lo = Math.min(v, hi);
            else if (mode === "hi") hi = Math.max(v, lo);
            else {
                const w = hi - lo, n = Math.min(dom[1] - w, Math.max(dom[0], xScale.invert(px(e)) - grab));
                lo = n; hi = n + w;
            }
            paint();
        }).on("pointerup pointercancel", () => {
            if (!mode) return;
            mode = null;
            this.applyRange(o.rows, lo, hi, dom);
        }).on("click", (e: MouseEvent) => { e.stopPropagation(); })
          .on("contextmenu", (e: MouseEvent) => {
              e.preventDefault(); e.stopPropagation();
              this.selectionManager.showContextMenu(null, { x: e.clientX, y: e.clientY });
          });

        // Keyboard: the arrows move a handle by one bar, Shift by a tenth of the axis.
        const keys = (side: "lo" | "hi") => (e: KeyboardEvent) => {
            const big = (dom[1] - dom[0]) / 10;
            const d = e.shiftKey ? big : o.step;
            let v = side === "lo" ? lo : hi, handled = true;
            switch (e.key) {
                case "ArrowRight": case "ArrowUp": v += d; break;
                case "ArrowLeft": case "ArrowDown": v -= d; break;
                case "Home": v = dom[0]; break;
                case "End": v = dom[1]; break;
                case "Escape": this.rangeFocus = side; this.clearSelection(); e.preventDefault(); e.stopPropagation(); return;
                default: handled = false;
            }
            if (!handled) return;
            e.preventDefault(); e.stopPropagation();
            v = bound(v);
            if (side === "lo") lo = Math.min(v, hi); else hi = Math.max(v, lo);
            active = true; this.rangeFocus = side;
            paint();
            if (this.rangeTimer !== null) window.clearTimeout(this.rangeTimer);
            this.rangeTimer = window.setTimeout(() => { this.rangeTimer = null; this.applyRange(o.rows, lo, hi, dom); }, 350);
        };
        hLo.on("keydown", keys("lo")).on("blur", () => { if (this.rangeFocus === "lo" && !this.painting) this.rangeFocus = null; });
        hHi.on("keydown", keys("hi")).on("blur", () => { if (this.rangeFocus === "hi" && !this.painting) this.rangeFocus = null; });

        if (!o.shortcutsOn) return;

        // Shortcuts and what the range holds.
        const d = o.data, q1 = percentile(d, 25), med = percentile(d, 50), q3 = percentile(d, 75), iqr = q3 - q1;
        const chips: { name: string; lo: number; hi: number }[] = [
            { name: "Q1", lo: -Infinity, hi: q1 }, { name: "Q2", lo: q1, hi: med }, { name: "Q3", lo: med, hi: q3 }, { name: "Q4", lo: q3, hi: Infinity },
            { name: this.t("UI_NoOutliers", "No outliers"), lo: q1 - 1.5 * iqr, hi: q3 + 1.5 * iqr },
            { name: this.t("UI_Top10", "Top 10%"), lo: percentile(d, 90), hi: Infinity },
        ];
        // The real ends of a shortcut, to know when it is the one in force.
        const ends = (c: { lo: number; hi: number }) => {
            let a = Infinity, b = -Infinity;
            for (const v of d) if (v >= c.lo && v <= c.hi) { a = Math.min(a, v); b = Math.max(b, v); }
            return [bound(a), bound(b)];
        };
        const cg = g.append("g").attr("class", "hp-chips").attr("transform", `translate(0,${o.y + 44})`);
        let cx = 0;
        const eps = (dom[1] - dom[0]) / 1000;
        for (const c of chips) {
            const [ca, cb] = ends(c);
            const on = o.rActive && Math.abs(ca - o.rActLo) < eps && Math.abs(cb - o.rActHi) < eps;
            const b = cg.append("g").attr("transform", `translate(${cx},0)`).style("cursor", "pointer")
                .attr("tabindex", 0).attr("role", "button").attr("aria-pressed", on ? "true" : "false").attr("aria-label", c.name);
            const r = b.append("rect").attr("y", -2).attr("height", 18).attr("rx", 9)
                .attr("fill", on ? o.accent : "transparent").attr("stroke", on ? o.accent : o.axisColor).attr("stroke-opacity", on ? 1 : 0.5);
            const t = b.append("text").attr("x", 9).attr("y", 11).attr("font-size", 10).attr("fill", on ? "#FFFFFF" : o.axisColor).text(c.name);
            if (on && !o.hc) {
                // Text on the accent: dark when the accent is light.
                const n = parseInt(o.accent.slice(1), 16), lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255));
                t.attr("fill", lum > 150 ? "#111111" : "#FFFFFF");
            }
            const w = ((t.node() as SVGTextElement).getComputedTextLength?.() ?? c.name.length * 6) + 18;
            r.attr("width", w);
            const go = () => {
                if (on) { this.clearSelection(); return; }
                if (!this.isPro) { this.shortcutTried = true; }
                this.applyRange(o.rows, c.lo, c.hi, [Math.min(dom[0], -Infinity), Math.max(dom[1], Infinity)]);
                this.applyLicenseNotifications();
            };
            b.on("click", (e: MouseEvent) => { e.stopPropagation(); go(); })
             .on("keydown", (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); go(); } });
            cx += w + 5;
        }
        if (this.allow("range shortcuts") && o.rActive) {
            const inRange = o.rows.filter(r => r.value >= (o.rLo <= dom[0] ? -Infinity : o.rLo) && r.value <= (o.rHi >= dom[1] ? Infinity : o.rHi));
            const sum = inRange.reduce((t, r) => t + r.value, 0);
            const parts = [this.tf("UI_RangeRows", "{0} rows", this.fmtInt(inRange.length)),
                this.tf("UI_ZoneRows", "{0} of rows", this.pct(100 * inRange.length / Math.max(1, o.rows.length)))];
            if (o.sum > 0 && sum >= 0) parts.push(this.tf("UI_ZoneValue", "{0} of value", this.pct(100 * sum / o.sum)));
            const line = g.append("text").attr("x", plotW).attr("y", o.y + 55).attr("text-anchor", "end")
                .attr("font-size", 10).attr("font-weight", "600").attr("fill", o.axisColor).text(parts.join(" · "));
            if (((line.node() as SVGTextElement).getComputedTextLength?.() ?? 0) > plotW - cx - 8) line.text(parts.slice(1).join(" · "));
            if (((line.node() as SVGTextElement).getComputedTextLength?.() ?? 0) > plotW - cx - 8) line.remove();
        }
    }

    /**
     * "Pro preview" sobre el lienzo, y debajo las funciones que la han encendido.
     *
     * Solo mientras se edita sin licencia y con una funcion Pro activa: en vista de
     * lectura no se dibuja, porque ahi tampoco se dibuja la funcion. Blanco con contorno
     * oscuro -SVG no tiene text-shadow, asi que se hace con stroke y paint-order- para que
     * se lea igual sobre barras claras y oscuras.
     */
    private renderWatermark(width: number, height: number): void {
        if (!this.proPreview || this.attemptedPro.length === 0) return;

        const cx = width / 2, cy = height / 2;
        const fs = Math.round(Math.max(24, Math.min(88, width / 7.5, height / 3.5)));

        const g = this.svg.append("g")
            .attr("class", "pro-watermark")
            .attr("transform", `rotate(-20 ${cx} ${cy})`)
            .attr("aria-hidden", "true")
            .attr("pointer-events", "none")
            .attr("opacity", 0.72);

        const comun = (sel: any, size: number, peso: string) => sel
            .attr("x", cx).attr("text-anchor", "middle").attr("dominant-baseline", "middle")
            .style("font-family", "'Segoe UI', sans-serif")
            .style("font-size", `${size}px`).style("font-weight", peso)
            .style("letter-spacing", "0.06em")
            .style("fill", "#FFFFFF")
            .style("stroke", "#0B1437").style("stroke-width", Math.max(2, size / 14))
            .style("paint-order", "stroke");

        // Con mas de dos, la lista tapa el grafico que se quiere ensenar.
        const nombres = this.attemptedPro.map(a => this.featName(a));
        const etiquetas = nombres.length <= 2
            ? nombres
            : nombres.slice(0, 2).concat([`+${nombres.length - 2}`]);

        comun(g.append("text"), fs, "700")
            .attr("y", cy - fs * 0.22)
            .text(this.t("UI_ProPreview", "Pro preview"));
        comun(g.append("text"), Math.round(fs * 0.32), "600")
            .attr("y", cy + fs * 0.45)
            .text(etiquetas.join(" · "));
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
            .attr("font-size", 12).attr("fill", "#B0BEC5").attr("font-family", "Segoe UI, sans-serif").text(this.t("UI_Landing", "Add a numeric field to get started"));
    }

    // ── Setup guide ───────────────────────────────────────────────────────────

    /**
     * Opens by itself only on a visual nobody has touched, so that a report already built does not
     * greet its author with it; the format pane can bring it back. Only for whoever is editing.
     */
    private updateGuide(): void {
        const el = this.guideEl;
        const dv = this.lastDataView;
        const objects = dv?.metadata?.objects;
        const stored = objects?.["style"]?.["guide"];
        if (stored === false) this.guideOpen = false;
        else if (stored === true || !objects || Object.keys(objects).length === 0) this.guideOpen = true;
        const vp = this.lastOptions?.viewport;
        el.style.display = "none";
        if (!this.guideOpen || !this.editing || this.formatMode || !this.canInteract) return;
        if (!dv?.categorical?.values?.[0] || !vp || vp.width < 360 || vp.height < 260) return;
        this.renderGuide();
    }

    private roleBound(role: string): boolean {
        return !!this.lastDataView?.metadata?.columns?.some(c => c.roles?.[role]);
    }

    private renderGuide(): void {
        const el = this.guideEl;
        while (el.firstChild) el.removeChild(el.firstChild);
        const hc = this.host.colorPalette.isHighContrast;
        const main = hc ? (this.host.colorPalette.foregroundSelected?.value ?? "#FFFF00") : "#2B6CB0";
        const fg = hc ? (this.host.colorPalette.foreground?.value ?? "#FFFFFF") : "#252423";
        const muted = hc ? fg : "#605E5C";
        const bg = hc ? (this.host.colorPalette.background?.value ?? "#000000") : "#FFFFFF";
        el.style.display = "block";
        el.style.background = bg;
        el.style.borderColor = main;
        el.style.color = fg;
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-label", this.t("Guide_Title", "Setup guide"));
        el.onclick = (e) => e.stopPropagation();
        el.onkeydown = (e) => e.stopPropagation();
        const add = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] => {
            const n = document.createElement(tag);
            n.className = cls;
            if (text) n.textContent = text;
            return parent.appendChild(n);
        };
        const persist = (properties: Record<string, powerbi.DataViewPropertyValue>) =>
            this.host.persistProperties({ merge: [{ objectName: "style", selector: null as any, properties }] });
        const finish = () => { this.guideOpen = false; this.guideStep = 2; el.style.display = "none"; persist({ guide: false }); };
        const button = (parent: HTMLElement, text: string, primary: boolean, action: () => void) => {
            const b = add(parent, "button", primary ? "hp-g-btn hp-g-main" : "hp-g-btn", text);
            b.type = "button";
            b.style.borderColor = main;
            b.style.background = primary ? main : "transparent";
            b.style.color = primary ? bg : main;
            b.addEventListener("click", action);
        };

        const head = add(el, "div", "hp-g-head");
        add(head, "div", "", this.t("Guide_Step", "Setup · step {0} of 3").replace("{0}", String(this.guideStep))).style.color = main;
        const close = add(head, "button", "hp-g-close", "✕");
        close.type = "button";
        close.title = this.t("Guide_Close", "Close the guide");
        close.setAttribute("aria-label", close.title);
        close.style.color = muted;
        close.addEventListener("click", finish);

        if (this.guideStep !== 3) {
            add(el, "div", "hp-g-title", this.t("Guide_Distribution", "Get the distribution"));
            const list = add(el, "div", "");
            list.setAttribute("role", "list");
            const items: [string, string, string, string, string][] = [
                ["category", "Role_category", "Detail (rows)", "Guide_DetailWhy", "one row per order, employee or ticket: without it there is no distribution"],
                ["panel", "Role_panel", "Small multiples (Pro)", "Guide_PanelWhy", "one histogram per region or product, on the same axis"],
                ["tooltips", "Role_tooltips", "Tooltips", "Guide_TooltipsWhy", "extra values, as the average per bar"],
            ];
            for (const [role, nameKey, name, whyKey, why] of items) {
                const done = this.roleBound(role);
                const row = add(list, "div", "hp-g-item");
                row.setAttribute("role", "listitem");
                const mark = add(row, "span", "", done ? "✓" : "○");
                mark.setAttribute("aria-label", done ? this.t("Guide_Done", "added") : this.t("Guide_Todo", "not added"));
                mark.style.color = done ? (hc ? fg : "#107C10") : muted;
                const txt = add(row, "span", "");
                add(txt, "b", "", this.t(nameKey, name));
                txt.appendChild(document.createTextNode(" — " + this.t(whyKey, why)));
                txt.style.color = done ? muted : fg;
            }
            add(el, "div", "hp-g-note", this.t("Guide_Wells", "Drag the fields into the field wells; this list updates by itself. Only Detail is needed.")).style.color = muted;
            button(add(el, "div", "hp-g-foot"), this.t("Guide_Next", "Next"), true, () => { this.guideStep = 3; this.renderGuide(); });
        } else {
            add(el, "div", "hp-g-title", this.t("Guide_Style", "Pick a style"));
            const grid = add(el, "div", "hp-g-grid");
            const current = this.currentSettings?.template;
            for (const name of ["report", "classic", "boardroom", "ledger", "editorial", "signal", "aurora", "terrace"]) {
                const look = STYLES[name];
                const chip = add(grid, "button", "hp-g-chip");
                chip.type = "button";
                chip.setAttribute("aria-pressed", String(name === current));
                chip.style.borderColor = name === current ? main : "#C8C6C4";
                chip.style.borderWidth = name === current ? "2px" : "1px";
                chip.style.background = bg;
                chip.style.color = fg;
                const mini = add(chip, "div", "hp-g-mini");
                mini.style.background = hc ? bg : (look.bg ?? (look.grad ? `linear-gradient(135deg, ${look.grad.join(", ")})` : "transparent"));
                const bar = hc ? fg : String(look.values?.barColor ?? DEFAULTS.barColor);
                for (const h of [30, 75, 100, 60, 35, 15]) {
                    const b = add(mini, "i", "");
                    b.style.height = `${h}%`;
                    b.style.background = bar;
                }
                const paid = !this.isPro && name !== "report" && name !== "classic";
                const label = this.t(`Enum_style_${name}`, name.charAt(0).toUpperCase() + name.slice(1));
                add(chip, "div", "", paid ? `${label} (Pro)` : label);
                chip.addEventListener("click", () => persist({ template: name }));
            }
            const foot = add(el, "div", "hp-g-foot");
            button(foot, this.t("Guide_Back", "Back"), false, () => { this.guideStep = 2; this.renderGuide(); });
            button(foot, this.t("Guide_Finish", "Finish"), true, finish);
        }
    }

    // ── On-object formatting ──────────────────────────────────────────────────

    /** Every parent of what can be formatted, with the object it edits. */
    private static readonly SUB_SELECTABLES: [string, string, string, string, "Text" | "Shape"][] = [
        [".bars", "histogram", "Obj_histogram", "Histogram", "Shape"],
        [".hp-axis", "axes", "Obj_axes", "Axes", "Text"],
        [".hp-legend", "legend", "Obj_legend", "Legend", "Text"],
        [".hp-stats", "statistics", "Obj_statistics", "Statistics", "Text"],
        [".zone-labels", "zones", "Obj_zones", "Value zones", "Text"],
        [".hp-range", "rangeBar", "Obj_rangeBar", "Range bar", "Shape"],
        [".hp-sm-title", "smallMultiples", "Obj_smallMultiples", "Small multiples", "Text"],
    ];

    /**
     * In format mode a click chooses what to format: nothing filters, and the handlers are taken
     * off here, in one place, so that no click on a bar or a handle can stop on its way to the
     * helper, which listens on the host element.
     */
    private afterRender(options: VisualUpdateOptions): void {
        this.updateGuide();
        if (!this.formatMode) return;
        const root = this.svg.node() as SVGSVGElement;
        const types = "click contextmenu keydown blur mousedown mousemove mouseover mouseout pointerdown pointermove pointerup pointercancel";
        this.svg.on(types, null);
        this.svg.selectAll("*").on(types, null);
        this.container.selectAll<HTMLElement, unknown>(".hp-range-input").style("pointer-events", "none");
        for (const [sel, obj, key, fb, kind] of Visual.SUB_SELECTABLES) {
            const name = this.t(key, fb).replace(/\s*\(Pro\)\s*$/, "");
            root.querySelectorAll(sel).forEach(el => {
                el.classList.add(HtmlSubSelectableClass);
                el.setAttribute("pointer-events", "auto");
                el.setAttribute(SubSelectableObjectNameAttribute, obj);
                el.setAttribute(SubSelectableDisplayNameAttribute, name);
                el.setAttribute(SubSelectableTypeAttribute, String(kind === "Text" ? powerbi.visuals.SubSelectionStylesType.Text : powerbi.visuals.SubSelectionStylesType.Shape));
            });
        }
        this.subSelectionHelper.updateOutlinesFromSubSelections((options as any).subSelections ?? [], true);
    }

    private getSubSelectionStyles(subs: powerbi.visuals.CustomVisualSubSelection[]): powerbi.visuals.SubSelectionStyles | undefined {
        const ref = (objectName: string, propertyName: string, fb: string) => ({
            reference: { objectName, propertyName },
            label: this.t(`Prop_${objectName}_${propertyName}`, fb).replace(/\s*\(Pro\)\s*$/, ""),
        });
        const shape = powerbi.visuals.SubSelectionStylesType.Shape, text = powerbi.visuals.SubSelectionStylesType.Text;
        switch (subs[0]?.customVisualObjects[0]?.objectName) {
            case "histogram":
                return { type: shape, fill: ref("histogram", "barColor", "Bar color"),
                    stroke: ref("histogram", "borderColor", "Border color"), strokeWidth: ref("histogram", "borderWidth", "Border width") } as any;
            case "axes":
                return { type: text, fontSize: ref("axes", "fontSize", "Font size"), fontColor: ref("axes", "axisColor", "Axis text color") } as any;
            case "legend":
                return { type: text, fontSize: ref("legend", "fontSize", "Font size"), fontColor: ref("legend", "color", "Font color") } as any;
            case "statistics":
                return { type: text, fontColor: ref("statistics", "statsColor", "Stats text color") } as any;
            case "zones":
                return { type: text, fontSize: ref("zones", "labelSize", "Label font size"), fontColor: ref("zones", "labelColor", "Label text color") } as any;
            case "rangeBar":
                return { type: shape, fill: ref("rangeBar", "color", "Range color") } as any;
            case "smallMultiples":
                return { type: text, fontSize: ref("smallMultiples", "titleFontSize", "Title size"), fontColor: ref("smallMultiples", "titleColor", "Title color") } as any;
        }
        return undefined;
    }

    private getSubSelectionShortcuts(subs: powerbi.visuals.CustomVisualSubSelection[]): powerbi.visuals.VisualSubSelectionShortcuts | undefined {
        const name = subs[0]?.customVisualObjects[0]?.objectName;
        if (!name) return undefined;
        const id = (objectName: string, propertyName: string) => ({ objectName, propertyName });
        const toggle = (obj: string, prop: string, hideKey: string, hide: string, showKey: string, show: string) => (
            { type: powerbi.visuals.VisualShortcutType.Toggle, ...id(obj, prop), relatedToggledFormattingIds: [id(obj, prop)], disabledLabel: this.t(hideKey, hide), enabledLabel: this.t(showKey, show) });
        const ends = (resets: [string, string][], key: string, fb: string) => [
            { type: powerbi.visuals.VisualShortcutType.Divider },
            { type: powerbi.visuals.VisualShortcutType.Reset, relatedResetFormattingIds: resets.map(([o, q]) => id(o, q)) },
            { type: powerbi.visuals.VisualShortcutType.Navigate, destinationInfo: { cardUid: `Visual-${name}_card` }, label: this.t(key, fb).replace(/\s*\(Pro\)\s*$/, "") },
        ];
        switch (name) {
            case "histogram":
                return [{ type: powerbi.visuals.VisualShortcutType.Picker, ...id("style", "template"), label: this.t("Prop_style_template", "Template") },
                    ...ends([["histogram", "barColor"], ["histogram", "borderColor"], ["histogram", "borderWidth"]], "Obj_histogram", "Histogram")] as any;
            case "axes":
                return ends([["axes", "fontSize"], ["axes", "axisColor"]], "Obj_axes", "Axes") as any;
            case "legend":
                return [toggle("legend", "show", "UI_HideLegend", "Hide legend", "Prop_legend_show", "Show legend"),
                    ...ends([["legend", "fontSize"], ["legend", "color"]], "Obj_legend", "Legend")] as any;
            case "statistics":
                return [toggle("statistics", "showStats", "UI_HideStats", "Hide stats panel", "UI_ShowStats", "Show stats panel"),
                    ...ends([["statistics", "statsColor"]], "Obj_statistics", "Statistics")] as any;
            case "zones":
                return [toggle("zones", "showLabels", "UI_HideZoneLabels", "Hide zone labels", "Prop_zones_showLabels", "Show zone labels"),
                    ...ends([["zones", "labelSize"], ["zones", "labelColor"]], "Obj_zones", "Value zones")] as any;
            case "rangeBar":
                return [toggle("rangeBar", "shortcuts", "UI_HideShortcuts", "Hide shortcuts", "UI_ShowShortcuts", "Show shortcuts"),
                    ...ends([["rangeBar", "color"]], "Obj_rangeBar", "Range bar")] as any;
            case "smallMultiples":
                return ends([["smallMultiples", "titleFontSize"], ["smallMultiples", "titleColor"]], "Obj_smallMultiples", "Small multiples") as any;
        }
        return undefined;
    }

    // ── Format Pane ───────────────────────────────────────────────────────────

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const s = this.currentSettings;
        const pro = this.isPro;
        const lbl = (name: string) => pro ? name : `${name} (Pro)`;
        // Display names come from stringResources by key (Prop_<card>_<prop>, Obj_<card>),
        // without their "(Pro)" suffix, which lbl() adds back only for unlicensed users.
        const T = (key: string, fallback: string) => this.t(key, fallback).replace(/\s*\(Pro\)\s*$/, "");
        const dn = (obj: string, prop: string, name: string) => {
            const isPro = /\s\(Pro\)$/.test(name);
            const base = name.replace(/\s*\(Pro\)\s*$/, "");
            const tr = T(`Prop_${obj}_${prop}`, base);
            return isPro ? `${tr} (Pro)` : tr;
        };

        const num = (uid: string, name: string, obj: string, prop: string, val: number) => ({
            uid, displayName: dn(obj, prop, name),
            control: { type: powerbi.visuals.FormattingComponent.NumUpDown, properties: { descriptor: { objectName: obj, propertyName: prop }, value: val } }
        });
        const tog = (uid: string, name: string, obj: string, prop: string, val: boolean) => ({
            uid, displayName: dn(obj, prop, name),
            control: { type: powerbi.visuals.FormattingComponent.ToggleSwitch, properties: { descriptor: { objectName: obj, propertyName: prop }, value: val } }
        });
        // Conditional formatting needs BOTH the instanceKind (which shows the fx button)
        // and a wildcard selector (which gives Power BI a scope to write the resolved
        // colours into). With instanceKind alone the button appeared and the rule
        // never reached the visual — that was the state up to 1.3.0.0.
        const col = (uid: string, name: string, obj: string, prop: string, val: string, conditionalFormatting = false) => ({
            uid, displayName: dn(obj, prop, name),
            control: {
                type: powerbi.visuals.FormattingComponent.ColorPicker,
                properties: {
                    descriptor: {
                        objectName: obj,
                        propertyName: prop,
                        ...(conditionalFormatting ? {
                            instanceKind: powerbi.VisualEnumerationInstanceKinds.ConstantOrRule,
                            selector: { data: [{ dataViewWildcard: { matchingOption: 0 } }] } as any,
                        } : {})
                    },
                    value: { value: val }
                }
            }
        });
        const card = (uid: string, displayName: string, slices: any[]) => {
            const obj = uid.replace(/_card$/, "");
            const isPro = /\s\(Pro\)$/.test(displayName);
            const tr = T(`Obj_${obj}`, displayName.replace(/\s*\(Pro\)\s*$/, ""));
            return { uid, displayName: isPro ? `${tr} (Pro)` : tr, groups: [{ uid: uid + "_g", displayName: "", slices }] };
        };
        const txt = (uid: string, name: string, obj: string, prop: string, val: string) => ({
            uid, displayName: dn(obj, prop, name),
            control: { type: powerbi.visuals.FormattingComponent.TextInput, properties: { descriptor: { objectName: obj, propertyName: prop }, value: val } }
        });

        const dropdown = (uid: string, name: string, obj: string, prop: string, val: string, items: [string, string, string][]) => {
            const list = items.map(([value, key, f]) => ({ value,
                displayName: value === "report" || value === "classic" ? T(key, f) : lbl(T(key, f)) }));
            return { uid, displayName: dn(obj, prop, name), control: { type: powerbi.visuals.FormattingComponent.Dropdown,
                properties: { descriptor: { objectName: obj, propertyName: prop }, value: list.find(x => x.value === val) ?? list[0], items: list } as any } };
        };

        return {
            cards: [
                card("style_card", "Style template", [
                    dropdown("style_template", "Template", "style", "template", s.template, [
                        ["report", "Enum_style_report", "Report theme"], ["classic", "Enum_style_classic", "Classic"], ["boardroom", "Enum_style_boardroom", "Boardroom"],
                        ["ledger", "Enum_style_ledger", "Ledger"], ["editorial", "Enum_style_editorial", "Editorial"],
                        ["signal", "Enum_style_signal", "Signal"], ["aurora", "Enum_style_aurora", "Aurora"],
                        ["terrace", "Enum_style_terrace", "Terrace"]]),
                    tog("style_guide", "Setup guide", "style", "guide", this.guideOpen),
                ]),
                card("histogram_card", "Histogram", [
                    num("bins",        lbl("Number of bins"), "histogram", "bins",        s.bins),
                    num("trimLower",   lbl("Lower trim %"),   "histogram", "trimLower",   s.trimLower),
                    num("trimUpper",   lbl("Upper trim %"),   "histogram", "trimUpper",   s.trimUpper),
                    col("barColor",    lbl("Bar color"),      "histogram", "barColor",    this.uniformBarColor ?? s.barColor, true),
                    num("barOpacity",  lbl("Opacity %"),      "histogram", "barOpacity",  s.barOpacity),
                    col("borderColor", lbl("Border color"),   "histogram", "borderColor", s.borderColor),
                    num("borderWidth", lbl("Border width"),   "histogram", "borderWidth", s.borderWidth),
                    num("barGap",      lbl("Bar gap px"),     "histogram", "barGap",      s.barGap),
                ]),
                card("rangeBar_card", "Range bar", [
                    tog("range_show", "Show range bar", "rangeBar", "show", s.rangeShow),
                    tog("range_short", lbl("Shortcuts and summary"), "rangeBar", "shortcuts", s.rangeShortcuts),
                    col("range_color", "Range colour", "rangeBar", "color", s.rangeColor || (STYLES[s.template]?.accent ?? STYLES.classic.accent)),
                    col("range_in", lbl("Bars inside the range"), "rangeBar", "inColor", s.rangeInColor || s.barColor),
                    col("range_out", lbl("Bars outside the range"), "rangeBar", "outColor", s.rangeOutColor || s.gridColor),
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
                    tog("showCum",     lbl("Cumulative frequency"), "statistics", "showCumulative", s.showCumulative),
                    col("cumColor",    lbl("Cumulative line color"), "statistics", "cumulativeColor", s.cumulativeColor),
                    tog("showStats",   lbl("Stats panel"),       "statistics", "showStats",   s.showStats),
                    col("statsColor",  lbl("Stats text color"),  "statistics", "statsColor",  s.statsColor),
                    col("statsBg",     lbl("Stats panel background"), "statistics", "statsBgColor", s.statsBgColor),
                    num("statsBgOp",   lbl("Stats panel opacity %"),  "statistics", "statsBgOpacity", s.statsBgOpacity),
                    col("labelBg",     "Label background",        "statistics", "labelBgColor", s.labelBgColor),
                    num("labelBgOp",   "Label background opacity %", "statistics", "labelBgOpacity", s.labelBgOpacity),
                ]),
                card("zones_card", lbl("Value zones"), [
                    tog("z_show",   lbl("Show value zones"), "zones", "show", s.zShow),
                    num("z_cut1",   lbl("First cut"),        "zones", "cut1", s.zCut1),
                    num("z_cut2",   lbl("Second cut"),       "zones", "cut2", s.zCut2),
                    col("z_c1",     lbl("Low zone color"),    "zones", "color1", s.zColor1),
                    col("z_c2",     lbl("Middle zone color"), "zones", "color2", s.zColor2),
                    col("z_c3",     lbl("High zone color"),   "zones", "color3", s.zColor3),
                    tog("z_labels", lbl("Show zone labels"),  "zones", "showLabels", s.zLabels),
                    tog("z_value",  lbl("Show share of total value"), "zones", "showValueShare", s.zValueShare),
                    col("z_lbg",    lbl("Label background"), "zones", "labelBg", s.zLabelBg || s.labelBgColor),
                    num("z_lop",    lbl("Label background opacity %"), "zones", "labelBgOpacity", s.zLabelBgOpacity),
                    col("z_lcol",   lbl("Label text color"), "zones", "labelColor", s.zLabelColor || s.axisColor),
                    num("z_lsize",  lbl("Label font size (0 = automatic)"), "zones", "labelSize", s.zLabelSize),
                ]),
                card("benchmark_card", "Benchmark", [
                    tog("bm_show",  "Show benchmark line", "benchmark", "show",  s.showBenchmark),
                    num("bm_value", "Benchmark value",     "benchmark", "value", s.benchmarkValue),
                    col("bm_color", "Line color",          "benchmark", "color", s.benchmarkColor),
                    txt("bm_label", "Benchmark label",     "benchmark", "label", s.benchmarkLabel),
                    tog("bm_colorBars", "Color bars by benchmark", "benchmark", "colorBars", s.bmColorBars),
                    col("bm_above", "At or above benchmark", "benchmark", "aboveColor", s.bmAboveColor),
                    col("bm_below", "Below benchmark",       "benchmark", "belowColor", s.bmBelowColor),
                ]),
                card("valueLabels_card", lbl("Value labels"), [
                    tog("vl_show",    lbl("Show"),         "valueLabels", "show",        s.showValueLabels),
                    num("vl_size",    lbl("Font size"),    "valueLabels", "fontSize",    s.vlFontSize),
                    col("vl_color",   lbl("Color"),        "valueLabels", "color",       s.vlColor),
                    tog("vl_percent", lbl("Show percent"), "valueLabels", "showPercent", s.vlShowPercent),
                ]),
                card("ibcs_card", "IBCS", [
                    tog("ibcs_mode", "IBCS mode", "ibcs", "mode", s.ibcsMode),
                ]),
                card("axes_card", "Axes", [
                    col("axisColor",  "Axis color",   "axes", "axisColor",  s.axisColor),
                    col("gridColor",  "Grid color",   "axes", "gridColor",  s.gridColor),
                    num("fontSize",   "Font size",    "axes", "fontSize",   s.axisFontSize),
                    tog("showXLabel", "Show X label", "axes", "showXLabel", s.showXLabel),
                    tog("showYLabel", "Show Y label", "axes", "showYLabel", s.showYLabel),
                ]),
                card("legend_card", "Legend", [
                    tog("legend_show",   "Show legend",      "legend", "show",   s.showLegend),
                    tog("legend_bottom", "Position: bottom", "legend", "bottom", s.legendBottom),
                    num("legend_fs",     "Font size",        "legend", "fontSize", s.legendFontSize),
                    col("legend_color",  "Font color",       "legend", "color", s.legendColor),
                    txt("leg_mean_lbl", "Mean label", "legend", "meanLabel", s.legendMeanLabel),
                    txt("leg_med_lbl", "Median label", "legend", "medianLabel", s.legendMedianLabel),
                    txt("leg_p25_lbl", "P25 label", "legend", "p25Label", s.legendP25Label),
                    txt("leg_p75_lbl", "P75 label", "legend", "p75Label", s.legendP75Label),
                    txt("leg_normal_lbl", "Normal label", "legend", "normalLabel", s.legendNormalLabel),
                ]),
                card("smallMultiples_card", lbl("Small multiples"), [
                    num("sm_cols",  lbl("Columns (0 = automatic)"), "smallMultiples", "columns", s.smColumns),
                    num("sm_tsize", lbl("Title size"),          "smallMultiples", "titleFontSize", s.smTitleSize),
                    num("sm_gap",   lbl("Space between panels"),     "smallMultiples", "gap", s.smGap),
                    col("sm_tcol",  lbl("Title color"),              "smallMultiples", "titleColor", s.smTitleColor),
                    tog("sm_tbold", lbl("Bold title"),               "smallMultiples", "titleBold", s.smTitleBold),
                    dropdown("sm_talign", lbl("Title alignment"),    "smallMultiples", "titleAlign", s.smTitleAlign,
                        [["left", "Enum_al_left", "Left"], ["center", "Enum_al_center", "Center"]]),
                    col("sm_bg",    lbl("Panel background"),         "smallMultiples", "background", s.smBackground),
                    tog("sm_bord",  lbl("Panel border"),             "smallMultiples", "border", s.smBorder),
                    col("sm_bcol",  lbl("Panel border color"),       "smallMultiples", "borderColor", s.smBorderColor),
                ]),
            ]
        };
    }

    // ── Destroy ───────────────────────────────────────────────────────────────

    public destroy(): void {
        // Power BI recrea el visual al cambiar de pagina: un temporizador vivo levantaria
        // la barra de Upgrade sobre un visual que ya no existe.
        this.cancelLicenseIcon();
        if (this.rangeTimer !== null) window.clearTimeout(this.rangeTimer);
        this.container.remove();
    }
}
