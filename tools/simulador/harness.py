# -*- coding: utf-8 -*-
"""Simulador Playwright de Histogram Pro 1.6: formato dinámico (F11), tarjeta Accesibilidad (D10), fx detectable por OKviz y
marca de agua común. Datos: Begudes Nord (ficticia), bultos por entrega, una fila por entrega.

    node build-test.js --free && rm -rf .tmp/sim_free && cp -r .tmp/drop .tmp/sim_free
    node build-test.js        && rm -rf .tmp/sim_pro  && cp -r .tmp/drop .tmp/sim_pro
    python tools/simulador/harness.py        → comprobaciones y capturas en tools/simulador/capturas/
    python tools/simulador/harness.py ficha  → imágenes de la ficha (60_* a 62_*)
"""
import asyncio, io, json, os, random, sys
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "capturas")
FALLOS = []

STUB = r"""
window.__ev = [];
window.powerbi = { visuals: { plugins: {} }, extensibility: {} };
(function(){
 function mkId(k){ return { __k:k, getKey(){return k;}, getSelector(){return {k};}, equals(o){return !!o && o.__k===k;}, includes(o){ return !!o && o.__k===k; } }; }
 window.__persist = [];
 window.__host = {
  eventService: { renderingStarted(){ __ev.push('S'); }, renderingFinished(){ __ev.push('F'); }, renderingFailed(o,m){ __ev.push('X'); console.error('FAILED', m); } },
  createSelectionManager(){ return { select(){ return Promise.resolve([]); }, clear(){ return Promise.resolve(); }, getSelectionIds(){ return []; },
     hasSelection(){ return false; }, registerOnSelectCallback(){}, showContextMenu(){ return Promise.resolve(); } }; },
  createSelectionIdBuilder(){ const k=[]; return { withCategory(c,i){ k.push(c.source.queryName+'='+c.values[i]); return this; },
     withMeasure(m){ k.push(m); return this; }, withSeries(){ return this; }, createSelectionId(){ return mkId(k.join('|')); } }; },
  createLocalizationManager(){ return { getDisplayName(k){ return k; } }; },
  tooltipService: { enabled(){ return true; }, show(o){ window.__tip = o; }, move(){}, hide(){} },
  subSelectionService: { subSelect(){}, updateRegionOutlines(){} },
  hostCapabilities: { allowInteractions: true }, locale: 'en-US',
  colorPalette: { isHighContrast: !!window.__sysHC, foreground:{value: window.__sysHC ? '#FFFF00' : '#252423'}, background:{value: window.__sysHC ? '#000000' : '#FFFFFF'},
    foregroundNeutralSecondary:{value:'#605E5C'}, foregroundSelected:{value:'#1AEBFF'}, getColor(k){ return {value:'#118DFF'}; } },
  fetchMoreData(){ return false; }, persistProperties(p){ __persist.push(p); }, launchUrl(){}, displayWarningIcon(){}, hideWarningIcon(){},
 };
 if (window.__license) window.__host.licenseManager = {
   getAvailableServicePlans(){ return Promise.resolve({ plans: [], isLicenseUnsupportedEnv: false, isLicenseInfoAvailable: true }); },
   notifyFeatureBlocked(){ return Promise.resolve(true); }, notifyLicenseRequired(){ return Promise.resolve(true); }, clearLicenseNotification(){ return Promise.resolve(true); } };
})();
"""


def dv(objects=None, dyn=None, panel=False, n=900):
    """dyn: None, 'uniform' (todas '#,0.0 "cases"') o 'mixed' (dos cadenas)."""
    rnd = random.Random(11)
    ids, val, vobj, pan = [], [], [], []
    for k in range(n):
        canal = "Horeca" if k % 3 else "Retail"
        base = 14 if canal == "Horeca" else 31
        ids.append(f"D-{k:05d}"); pan.append(canal)
        val.append(round(max(1, rnd.lognormvariate(0, 0.45) * base), 1))
        if dyn == "uniform": vobj.append({"general": {"formatString": '#,0.0 "cases"'}})
        elif dyn == "mixed": vobj.append({"general": {"formatString": '#,0.0 "cases"' if k % 2 else '#,0 "boxes"'}})
    cats = [{"source": {"displayName": "Delivery", "queryName": "D.Delivery", "roles": {"category": True}}, "values": ids}]
    if panel: cats.append({"source": {"displayName": "Channel", "queryName": "D.Channel", "roles": {"panel": True}}, "values": pan})
    v = {"source": {"displayName": "Cases per delivery", "queryName": "Sum(D.Cases)", "roles": {"measure": True}, "isMeasure": True, "format": "#,0.0"}, "values": val}
    if dyn: v["objects"] = vobj
    return {"metadata": {"columns": [c["source"] for c in cats] + [v["source"]], "objects": objects or {}},
            "categorical": {"categories": cats, "values": [v]}}


def check(name, ok, detail=""):
    print(f"  {'OK   ' if ok else 'FALLO'} {name}{'  — ' + detail if detail else ''}")
    if not ok: FALLOS.append(name)


async def page(browser, build, data, W=900, H=520, view=0, sys_hc=False, license=False, name=None, bg="#FFFFFF"):
    drop = os.path.join(ROOT, ".tmp", build)
    guid = json.load(io.open(os.path.join(drop, "pbiviz.json"), encoding="utf-8"))["visual"]["guid"]
    pg = await browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=2)
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.set_content(f"<html><body style='margin:0;background:{bg}'><div id='host' style='position:relative;width:{W}px;height:{H}px;overflow:hidden'></div></body></html>")
    await pg.add_style_tag(path=os.path.join(drop, "visual.css"))
    await pg.add_script_tag(content=f"window.__sysHC = {json.dumps(sys_hc)}; window.__license = {json.dumps(license)};")
    await pg.add_script_tag(content=STUB)
    await pg.add_script_tag(path=os.path.join(drop, "visual.js"))
    await pg.evaluate("(g) => { window.__v = powerbi.visuals.plugins[g].create({ element: document.getElementById('host'), host: __host }); }", guid)
    await pg.evaluate("([dv, W, H, vm]) => __v.update({ dataViews: dv ? [dv] : [], viewport: {width: W, height: H}, type: 2, operationKind: 0, viewMode: vm })",
                      [data, W, H, view])
    await pg.wait_for_timeout(500)
    if name:
        await pg.screenshot(path=os.path.join(OUT, name + ".png"))
    ev = await pg.evaluate("() => __ev.join('')")
    check(f"{name or 'página'}: sin errores y eventos de render 1:1", not errs and ev.count("S") == ev.count("F") and "X" not in ev, f"eventos {ev} {errs[:2]}")
    return pg



TICKS = "() => Array.from(document.querySelectorAll('svg text')).map(t => t.textContent)"


async def ficha(b):
    async def shot(name, data, W, H):
        pg = await page(b, "sim_pro", data, W, H, name=name)
        await pg.close()
    await shot("60_central", dv(), 852, 354)


async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        if "ficha" in sys.argv:
            await ficha(b); await b.close(); print(f"{len(FALLOS)} fallos"); return
        print("F11 · formato dinámico")
        pg = await page(b, "sim_pro", dv(dyn="uniform"), name="01_formato_dinamico_comun")
        t = await pg.evaluate(TICKS)
        check("cadena dinámica común: el eje la usa", any("cases" in x for x in t), " ".join(t[:12]))
        await pg.close()
        pg = await page(b, "sim_pro", dv(dyn="mixed"), name="02_formato_dinamico_mixto")
        t = await pg.evaluate(TICKS)
        check("cadenas distintas: formato de la columna", not any("cases" in x or "boxes" in x for x in t), " ".join(t[:12]))
        await pg.close()
        pg = await page(b, "sim_pro", dv(), name="03_sin_formato_dinamico")
        await pg.close()

        print("D10 · Accesibilidad")
        pg = await page(b, "sim_pro", dv({"accessibility": {"highContrast": "on"}}), name="04_alto_contraste_forzado")
        fills = await pg.evaluate("() => Array.from(new Set(Array.from(document.querySelectorAll('rect[tabindex]')).map(r => r.getAttribute('fill'))))")
        check("alto contraste 'On': barras con los colores del alto contraste (negro sobre blanco)", fills and all(f in ("#000000", "none", "#FFFFFF") for f in fills), str(fills))
        await pg.close()
        pg = await page(b, "sim_pro", dv(), sys_hc=True, name="05_alto_contraste_windows")
        fills = await pg.evaluate("() => Array.from(new Set(Array.from(document.querySelectorAll('rect[tabindex]')).map(r => r.getAttribute('fill'))))")
        check("alto contraste de Windows: colores del tema", fills and all(f.upper() in ("#FFFF00", "NONE", "#000000", "#1AEBFF") for f in fills), str(fills))
        await pg.close()
        pg = await page(b, "sim_pro", dv(), name="06_normal")
        fills = await pg.evaluate("() => Array.from(new Set(Array.from(document.querySelectorAll('rect[tabindex]')).map(r => r.getAttribute('fill'))))")
        check("'Automático' sin tema de Windows: colores normales", fills and not any(f in ("#000000",) for f in fills), str(fills))
        await pg.close()
        pg = await page(b, "sim_pro", dv({"accessibility": {"minTextSize": 14}, "statistics": {"showStats": True}}), name="07_texto_minimo_14")
        sizes = await pg.evaluate("() => Array.from(document.querySelectorAll('svg text')).filter(t => t.textContent.trim()).map(t => parseFloat(getComputedStyle(t).fontSize))")   # las marcas vacías de d3 no se ven
        check("tamaño mínimo 14: ningún texto por debajo", sizes and min(sizes) >= 14, f"mín {min(sizes) if sizes else '-'}")
        await pg.close()
        pg = await page(b, "sim_pro", dv({"accessibility": {"focusColor": {"solid": {"color": "#D00000"}}, "focusWidth": 5}}))
        st = await pg.evaluate("() => { const c = document.querySelector('.histogram-pro-container'); return c.style.getPropertyValue('--hp-focus') + ' ' + c.style.getPropertyValue('--hp-focus-w'); }")
        check("foco: color y grosor de la tarjeta", st.strip() == "#D00000 5px", st)
        await pg.close()

        print("Panel de estadísticas según el tamaño")
        for nm, (W, H, esperado) in {"mosaico": (340, 130, 0), "pequeno": (360, 170, 3), "grande": (900, 520, 6)}.items():
            pg = await page(b, "sim_pro", dv({"statistics": {"showStats": True}}), W, H, name=f"11_stats_{nm}")
            nl = await pg.evaluate("() => document.querySelectorAll('.hp-stats text').length")
            check(f"panel de estadísticas en {W}x{H}: {esperado} líneas (no tapa el gráfico)", nl == esperado, str(nl))
            await pg.close()

        print("Panel de formato y fx")
        pg = await page(b, "sim_pro", dv())
        fm = await pg.evaluate("""() => { const m = __v.getFormattingModel(); const acc = m.cards.find(c => c.uid === 'accessibility_card');
            const bar = m.cards.find(c => c.uid === 'histogram_card').groups[0].slices.find(s => s.uid === 'barColor').control.properties.descriptor;
            return { acc: acc ? acc.groups[0].slices.map(s => s.control.properties.descriptor.propertyName) : null,
                     accNames: acc ? acc.groups[0].slices.map(s => s.displayName) : null,
                     sel: JSON.stringify(bar.selector), alt: bar.altConstantValueSelector, kind: bar.instanceKind,
                     revert: m.cards.every(c => c.revertToDefaultDescriptors && c.revertToDefaultDescriptors.length) }; }""")
        check("tarjeta Accesibilidad con sus 4 opciones", fm["acc"] == ["highContrast", "focusColor", "focusWidth", "minTextSize"], str(fm["acc"]))
        check("Accesibilidad sin '(Pro)' en los nombres", fm["accNames"] and not any("Pro" in n for n in fm["accNames"]), str(fm["accNames"]))
        check("barColor: ConstantOrRule, comodín y altConstantValueSelector null", fm["kind"] is not None and "dataViewWildcard" in fm["sel"] and fm["alt"] is None, str(fm))
        check("Reset to default en todas las tarjetas", fm["revert"])
        await pg.close()

        print("Marca de agua común")
        pg = await page(b, "sim_free", dv({"histogram": {"bins": 25}}), view=1, license=True, name="08_marca_vista_previa")
        await pg.wait_for_timeout(300)
        await pg.evaluate("([dv, W, H]) => __v.update({ dataViews: [dv], viewport: {width: W, height: H}, type: 2, viewMode: 1 })", [dv({"histogram": {"bins": 25}}), 900, 520])
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=os.path.join(OUT, "08_marca_vista_previa.png"))
        wm = await pg.evaluate("() => { const w = document.querySelector('.tcviz-wm'); return w ? { d: getComputedStyle(w).display, t: w.textContent } : null; }")
        old = await pg.evaluate("() => !!document.querySelector('.pro-watermark')")
        check("vista previa sin licencia: marca común con las funciones", wm and wm["d"] == "flex" and "Pro preview" in wm["t"], str(wm))
        check("la marca propia antigua ya no existe", not old)
        await pg.close()
        pg = await page(b, "sim_free", dv({"histogram": {"bins": 25}}), view=0, license=True, name="09_lectura_sin_marca")
        wm = await pg.evaluate("() => { const w = document.querySelector('.tcviz-wm'); return w ? getComputedStyle(w).display : null; }")
        check("vista de lectura: sin marca", wm == "none", str(wm))
        await pg.close()
        pg = await page(b, "sim_pro", None, 640, 400, name="10_landing")
        await pg.close()
        await b.close()
    print(f"\n{len(FALLOS)} fallos" + (": " + ", ".join(FALLOS) if FALLOS else ""))
    sys.exit(1 if FALLOS else 0)


if __name__ == "__main__":
    asyncio.run(main())
