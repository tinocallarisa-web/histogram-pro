#!/usr/bin/env node
/**
 * build-test.js — Histogram Pro
 *
 * Empaqueta una build de PRUEBA sin dejar rastro en el fuente: parchea, llama a
 * `pbiviz package` y restaura los ficheros al salir, pase lo que pase.
 *
 * Dos modos, y hacen falta los dos:
 *
 *   node build-test.js          isPro forzado a true   → guid ..._test
 *   node build-test.js --free   tier Free real         → guid ..._testfree
 *
 * El modo --free no parchea nada: el licenseManager no encuentra ningún plan
 * para ese guid y resuelve a Free por sí mismo. Es la única forma de ver el
 * camino gratuito, porque con el guid real Power BI sirve la versión instalada
 * desde AppSource y no la tuya. Cada modo lleva su propio sufijo: si lo
 * compartieran, Power BI trataría las dos builds como el mismo visual y al
 * importar la segunda seguirías viendo la primera.
 */

"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = __dirname;
const VISUAL_TS = path.join(ROOT, "src", "visual.ts");
const PBIVIZ_JSON = path.join(ROOT, "pbiviz.json");

// El campo, no el resultado de checkLicense(): con isPro ya en true, el early
// return de checkLicense() se encarga del resto.
const ISPRO_FIELD = "private isPro: boolean = false;";
const ISPRO_TRUE = "private isPro: boolean = true;";

const origVisual = fs.readFileSync(VISUAL_TS, "utf8");
const origPbiviz = fs.readFileSync(PBIVIZ_JSON, "utf8");

if (!origVisual.includes(ISPRO_FIELD)) {
    console.error("❌ ERROR: no se encontró el campo isPro en visual.ts");
    console.error(`   Se esperaba la línea: ${ISPRO_FIELD}`);
    console.error("   Si el fuente ya está parcheado, restaura con: git checkout src/visual.ts");
    process.exit(1);
}

let restored = false;
const restore = () => {
    if (restored) return;
    fs.writeFileSync(VISUAL_TS, origVisual, "utf8");
    fs.writeFileSync(PBIVIZ_JSON, origPbiviz, "utf8");
    restored = true;
    console.log("✅ Ficheros originales restaurados.");
};

process.on("exit", restore);
process.on("SIGINT", () => { restore(); process.exit(1); });

try {
    const freeMode = process.argv.includes("--free");

    if (freeMode) {
        console.log("🔧 isPro sin tocar  (--free: tier Free real)");
    } else {
        fs.writeFileSync(VISUAL_TS, origVisual.replace(ISPRO_FIELD, ISPRO_TRUE), "utf8");
        console.log("🔧 visual.ts parcheado (isPro = true)");
    }

    const pbivizObj = JSON.parse(origPbiviz);
    const realGuid = pbivizObj.visual.guid;
    if (realGuid.endsWith("_test") || realGuid.endsWith("_testfree")) {
        console.error("❌ ERROR: el guid ya lleva sufijo de test. Restaura pbiviz.json.");
        process.exit(1);
    }
    pbivizObj.visual.guid = realGuid + (freeMode ? "_testfree" : "_test");
    fs.writeFileSync(PBIVIZ_JSON, JSON.stringify(pbivizObj, null, 2), "utf8");
    console.log(`🔧 pbiviz.json parcheado (guid: ${pbivizObj.visual.guid})`);

    console.log("📦 Ejecutando pbiviz package …");
    const pbivizJs = path.join(ROOT, "node_modules", "powerbi-visuals-tools", "bin", "pbiviz.js");
    execSync(`node "${pbivizJs}" package`, { cwd: ROOT, stdio: "inherit" });
    console.log("✅ Build de TEST completado. El .pbiviz está en dist/");
} catch (err) {
    console.error("❌ Error durante el build:", err.message || err);
    restore();
    process.exit(1);
}
