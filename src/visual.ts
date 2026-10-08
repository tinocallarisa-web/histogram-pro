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
import ILocalizationManager = powerbi.extensibility.ILocalizationManager;
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";

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
    bmColorBars: false, bmAboveColor: "#FF6B6B", bmBelowColor: "#00E5FF",
    zShow: false, zCut1: 0, zCut2: 0, zColor1: "#69F0AE", zColor2: "#FFD740", zColor3: "#FF6B6B",
    zLabels: true, zValueShare: true,
    smColumns: 0, smTitleSize: 12, smTitleColor: "#6B7785",
    statsBgColor: "#000000", statsBgOpacity: 35, labelBgColor: "#FFFFFF", labelBgOpacity: 75,
    legendFontSize: 9, legendColor: "#B0BEC5",
    showLegend: false, legendBottom: false,
    legendMeanLabel: "Mean", legendMedianLabel: "Median", legendP25Label: "P25", legendP75Label: "P75", legendNormalLabel: "Normal",
    ibcsMode: false,
    showNormal: false, normalColor: "#7C4DFF",
    showCumulative: false, cumulativeColor: "#FF9F43",
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
    bmColorBars: boolean; bmAboveColor: string; bmBelowColor: string;
    zShow: boolean; zCut1: number; zCut2: number; zColor1: string; zColor2: string; zColor3: string;
    zLabels: boolean; zValueShare: boolean;
    smColumns: number; smTitleSize: number; smTitleColor: string;
    statsBgColor: string; statsBgOpacity: number; labelBgColor: string; labelBgOpacity: number;
    legendFontSize: number; legendColor: string;
    showLegend: boolean; legendBottom: boolean;
    legendMeanLabel: string; legendMedianLabel: string; legendP25Label: string; legendP75Label: string; legendNormalLabel: string;
    ibcsMode: boolean;
    showNormal: boolean; normalColor: string;
    showCumulative: boolean; cumulativeColor: string;
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
        smColumns: getValue<number>(obj, "smallMultiples", "columns", DEFAULTS.smColumns),
        smTitleSize: getValue<number>(obj, "smallMultiples", "titleFontSize", DEFAULTS.smTitleSize),
        smTitleColor: getColor(obj, "smallMultiples", "titleColor", DEFAULTS.smTitleColor),
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

        this.container = d3.select(options.element)
            .append("div")
            .classed("histogram-pro-container", true)
            .style("width", "100%").style("height", "100%").style("position", "relative");

        this.svg = this.container.append("svg");
        this.checkLicense();
    }

    // ── Localization and number format ────────────────────────────────────────
    private t(key: string, fallback: string): string {
        try {
            const s = this.loc?.getDisplayName(key);
            return s && s !== key ? s : fallback;
        } catch { return fallback; }
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
                try { this.render(this.lastOptions); } catch { /* el render ya reporta */ }
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
        for (const [card, prop, label] of Visual.PRO_PROPS) {
            if (!obj[card]) continue;
            const v = obj[card][prop];
            if (v === undefined) continue;
            // Comparar el VALOR, no la mera presencia. Power BI deja la propiedad escrita
            // para siempre una vez tocada, asi que mirar si existe dejaba la marca de agua
            // puesta aunque el usuario devolviera el ajuste a su valor gratuito.
            if (this.esValorPorDefecto(prop, v)) continue;
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
            if (this.filterApplied) {
                this.filterApplied = false;
                this.host.applyJsonFilter(null, "general", "filter", this.FILTER_REMOVE);
            }
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
            this.filterApplied = true;
            this.host.applyJsonFilter(filter, "general", "filter", this.FILTER_MERGE);
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
        try { this.render(this.lastOptions); } catch (e) { console.error("[HistogramPro]", e); }
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
    private renderOversizedNotice(): void {
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

        note.append("div").text(this.tf("UI_Oversized",
            "This bin holds over {0} distinct values — more than the {1} Power BI can cross-filter at once.", n, cap));
        note.append("div").text(
            this.isPro
                ? this.t("UI_OversizedPro", "Raise the bin count (Histogram → Bins) so each bar covers fewer rows, or trim the outliers.")
                : this.t("UI_OversizedFree", "Pro lets you raise the bin count so each bar covers fewer rows."));

        setTimeout(() => this.container.selectAll(".oversized-notice").remove(), 6000);
    }

    /** Clears whichever mechanism is in force. */
    private clearSelection(): void {
        if (!this.canInteract) return;
        if (this.filterApplied) {
            this.filterApplied = false;
            this.host.applyJsonFilter(null, "general", "filter", this.FILTER_REMOVE);
        }
        this.selectionManager.clear();
        const had = this.selKeys.size > 0 || this.curFilterVals.length > 0;
        this.selKeys.clear();
        this.curFilterVals = [];
        this.curFilterPanel = null;
        if (had) this.repaint();
    }

    // ── Update ────────────────────────────────────────────────────────────────

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);
        this.lastOptions = options;
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
        type Shared = { lo: number; hi: number; rd: { lo: number; hi: number; clamped: boolean }; scaleRef: number; yMax: number };
        const fullW = width, fullH = height;
        // Small multiples: one legend for all panels, in a band across the top.
        let legendBand = 0;
        let bottomBandG = 0;
        let clampDone = false;
        const drawPanel = (raw: number[], rawWithIds: RowT[], highlightedRaw: number[],
                           ox: number, oy: number, width: number, height: number,
                           shared: Shared | null, title: string, panelValue: powerbi.PrimitiveValue | undefined,
                           showLegendHere: boolean): void => {
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
        const marginT = 16 + (ownLegend && !settings.legendBottom ? legendRowH + 16 : 0);
        const marginB = (settings.showXLabel ? 46 : 32) + (ownLegend && settings.legendBottom ? legendRowH + 16 : 0);
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
        const zoneBand = zoneLabelsOn ? Math.max(8, settings.axisFontSize - 1) + 8 : 0;
        const refRows = [settings.showMean, settings.showMedian, settings.showP25, settings.showP75].filter(Boolean).length;
        const vlBand = this.allow("value labels") && settings.showValueLabels ? settings.vlFontSize + 4 : 0;
        const headroom = Math.min(plotH * 0.4, zoneBand + (refRows ? 4 + refRows * (refFs + 4) : 0) + vlBand);
        const yScale = d3.scaleLinear().domain([0, shared ? shared.yMax : maxCount]).range([plotH, headroom]).nice();

        // Per bin: the rows it holds. The indices drive the exact filter; the
        // selection IDs are the fallback for models with no usable filter target.
        const binRows = bins.map(bin =>
            rawWithIds.filter(d => d.value >= (bin.x0 ?? -Infinity) && d.value < (bin.x1 ?? Infinity))
        );
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
        const _userBarColor    = estiloOk ? settings.barColor    : DEFAULTS.barColor;
        const _userBorderColor = estiloOk ? settings.borderColor : DEFAULTS.borderColor;

        const barColor = isHighContrast
            ? (this.host.colorPalette.foreground?.value ?? _userBarColor)
            : (ibcs ? IBCS.bar : _userBarColor);
        const borderColor = isHighContrast
            ? (this.host.colorPalette.foregroundSelected?.value ?? _userBorderColor)
            : (ibcs ? IBCS.bar : _userBorderColor);
        const borderWidth = ibcs ? 0 : (estiloOk ? settings.borderWidth : DEFAULTS.borderWidth);
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
            this.svg.append("text")
                .attr("x", ox + 4).attr("y", oy + Math.max(9, settings.smTitleSize))
                .attr("font-size", Math.max(9, settings.smTitleSize)).attr("font-weight", "600")
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
            const dimmedOpacity = anySel ? (isSel ? barOpacity : barOpacity * 0.25)
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
        g.append("g").attr("transform", `translate(0,${plotH})`)
            .call(d3.axisBottom(xScale).tickFormat(d => formatValue(+d, formatStr)).ticks(Math.min(effectiveBins, 8, Math.max(2, Math.floor(plotW / (settings.axisFontSize * 4.5))))))
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
                .attr("text-anchor", "middle").attr("font-size", settings.axisFontSize).attr("fill", effectiveAxisColor).text(this.t("UI_AxisY", "Count"));
        }
        if (settings.showXLabel) {
            g.append("text").attr("x", plotW / 2).attr("y", plotH + marginB - 6)
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
        const withHalo = (sel: d3.Selection<SVGTextElement, unknown, null, undefined>, _c?: string) => {
            const node = sel.node();
            if (!node || typeof node.getBBox !== "function" || labelBgOp <= 0) return sel;
            const bb = node.getBBox();
            d3.select(node.parentNode as SVGGElement).insert("rect", () => node)
                .attr("x", bb.x - 3).attr("y", bb.y - 1).attr("width", bb.width + 6).attr("height", bb.height + 2)
                .attr("rx", 3).attr("fill", labelBg).attr("fill-opacity", labelBgOp).attr("pointer-events", "none");
            return sel;
        };

        // Value zone labels, in front of the bars, at the top of each zone. Each takes the
        // longest wording that fits its zone, measured, not estimated.
        let refTop = 0;
        if (zoneLabels.length) {
            const zfs = Math.max(8, settings.axisFontSize - 1);
            const zl = g.append("g").attr("class", "zone-labels").attr("pointer-events", "none");
            for (const zl0 of zoneLabels) {
                const avail = zl0.x1 - zl0.x0 - 8;
                const el = zl.append("text").attr("x", zl0.x0 + 4).attr("y", zfs + 2)
                    .attr("font-size", zfs).attr("font-weight", "600").attr("fill", zl0.color);
                let ok = false;
                for (const c of zl0.candidates) {
                    el.text(c);
                    const w = (el.node() as SVGTextElement).getComputedTextLength?.() ?? c.length * zfs * 0.6;
                    if (w <= avail) { ok = true; break; }
                }
                if (!ok) { el.remove(); continue; }
                withHalo(el);
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
            g.append("rect").attr("x", px - 6).attr("y", py - 4).attr("width", 116).attr("height", lines.length * lh + 6)
                .attr("fill", isHighContrast ? (this.host.colorPalette.background?.value ?? "#000000") : settings.statsBgColor)
                .attr("fill-opacity", isHighContrast ? 1 : Math.min(100, Math.max(0, settings.statsBgOpacity)) / 100)
                .attr("rx", 4);
            lines.forEach((line, i) => {
                g.append("text").attr("x", px).attr("y", py + i * lh + settings.axisFontSize)
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
            const shared: Shared = { lo, hi, rd, scaleRef: Math.max(Math.abs(all[0]), Math.abs(all[all.length - 1])), yMax };

            const np = keys.length;
            const cols = settings.smColumns >= 1
                ? Math.min(np, Math.round(settings.smColumns))
                : Math.max(1, Math.min(np, Math.round(Math.sqrt(np * (width / Math.max(1, height)) / 1.6))));
            const rows = Math.ceil(np / cols);
            const gapPx = 14;
            // Bands outside the grid: the shared legend on top, and room at the bottom for
            // the clipped-axis notice so it does not sit on the last panel's axis title.
            legendBand = settings.showLegend
                ? Math.max(6, settings.legendFontSize || Math.max(8, settings.axisFontSize - 1)) + 18 : 0;
            const bottomBand = rd.clamped ? 14 : 0;
            bottomBandG = bottomBand;
            const gridH = height - legendBand - bottomBand;
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
        }
        this.renderTruncationNotice(width);
        this.renderWatermark(width, height);

        // No Free badge is drawn. It was licensing UI of the visual's own, which
        // Microsoft's guidance advises against, and it behaved as a watermark on
        // the free tier while offering nothing to click. Power BI's predefined
        // notifications carry the purchase path instead - see
        // applyLicenseNotifications().
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

        return {
            cards: [
                card("ibcs_card", "IBCS", [
                    tog("ibcs_mode", "IBCS mode", "ibcs", "mode", s.ibcsMode),
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
                    tog("showCum",     lbl("Cumulative frequency"), "statistics", "showCumulative", s.showCumulative),
                    col("cumColor",    lbl("Cumulative line color"), "statistics", "cumulativeColor", s.cumulativeColor),
                    tog("showStats",   lbl("Stats panel"),       "statistics", "showStats",   s.showStats),
                    col("statsColor",  lbl("Stats text color"),  "statistics", "statsColor",  s.statsColor),
                    col("statsBg",     lbl("Stats panel background"), "statistics", "statsBgColor", s.statsBgColor),
                    num("statsBgOp",   lbl("Stats panel opacity %"),  "statistics", "statsBgOpacity", s.statsBgOpacity),
                    col("labelBg",     "Label background",        "statistics", "labelBgColor", s.labelBgColor),
                    num("labelBgOp",   "Label background opacity %", "statistics", "labelBgOpacity", s.labelBgOpacity),
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
                card("zones_card", lbl("Value zones"), [
                    tog("z_show",   lbl("Show value zones"), "zones", "show", s.zShow),
                    num("z_cut1",   lbl("First cut"),        "zones", "cut1", s.zCut1),
                    num("z_cut2",   lbl("Second cut"),       "zones", "cut2", s.zCut2),
                    col("z_c1",     lbl("Low zone color"),    "zones", "color1", s.zColor1),
                    col("z_c2",     lbl("Middle zone color"), "zones", "color2", s.zColor2),
                    col("z_c3",     lbl("High zone color"),   "zones", "color3", s.zColor3),
                    tog("z_labels", lbl("Show zone labels"),  "zones", "showLabels", s.zLabels),
                    tog("z_value",  lbl("Show share of total value"), "zones", "showValueShare", s.zValueShare),
                ]),
                card("smallMultiples_card", lbl("Small multiples"), [
                    num("sm_cols",  lbl("Columns (0 = automatic)"), "smallMultiples", "columns", s.smColumns),
                    num("sm_tsize", lbl("Title font size"),          "smallMultiples", "titleFontSize", s.smTitleSize),
                    col("sm_tcol",  lbl("Title color"),              "smallMultiples", "titleColor", s.smTitleColor),
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

    public destroy(): void {
        // Power BI recrea el visual al cambiar de pagina: un temporizador vivo levantaria
        // la barra de Upgrade sobre un visual que ya no existe.
        this.cancelLicenseIcon();
        this.container.remove();
    }
}
