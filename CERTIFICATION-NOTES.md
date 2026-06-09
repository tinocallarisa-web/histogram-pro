# Histogram Pro — Partner Center Certification Notes

> ⚠️ IMPORTANT: Copy this text into the "Notes for Certification" field EVERY time you submit.
> Microsoft clears this field after each review — you must re-paste it.

---

## Notes for Certification (copy-paste this block)

```
Source code (certification branch):
https://github.com/tinocallarisa-web/histogram-pro/tree/certification

Privacy Policy: https://tinocallarisa-web.github.io/histogram-pro/privacy.html
Terms of Use:   https://tinocallarisa-web.github.io/histogram-pro/terms.html
Support:        https://tinocallarisa-web.github.io/histogram-pro/support.html

License validation:
This visual uses the official Microsoft IVisualLicenseManager API.
No external license server is used. License is verified entirely via Microsoft AppSource.
Plan ID: histogram-pro-tcviz

Free tier (no license required):
- Histogram with 10 fixed bins
- Mean and median reference lines
- Basic axis controls
- Tooltips on hover

Pro tier (requires active AppSource license — plan ID: histogram-pro-tcviz):
- Configurable bins (2–100)
- Outlier trimming (lower/upper percentile)
- Normal distribution curve overlay
- Full statistics panel (n, μ, M, σ, min, max)
- Value labels on bars (count or %)
- Full color, opacity, and border controls

Testing instructions:
1. Import the .pbiviz file or use the sample .pbix included with the submission
2. Add any numeric column to the Values field well
3. WITHOUT a Pro license, verify:
   - Histogram renders with exactly 10 bins
   - Mean and median lines are visible
   - "Bins" setting in format pane has no effect
   - Pro badge strip shows at the bottom
4. WITH the test license key below, verify:
   - Bins setting (2–100) changes histogram shape
   - Outlier trim sliders work
   - Normal curve overlay appears when enabled
   - Statistics panel shows n, μ, M, σ, min, max

Test license key: [ADD YOUR TEST KEY FROM PARTNER CENTER HERE]
```

---

## Pre-submission Checklist

- [ ] Version bumped in `pbiviz.json` AND `package.json`
- [ ] `pbiviz package` ran without errors
- [ ] Rendering events present: `renderingStarted / renderingFinished / renderingFailed`
- [ ] Filter-in: bars dim correctly when other visuals filter (uses categorical highlights)
- [ ] Plan ID in `visual.ts` matches Partner Center exactly: `histogram-pro-tcviz`
- [ ] GitHub `certification` branch updated with this version's source
- [ ] Privacy/Terms/Support URLs are live on GitHub Pages
- [ ] Sample `.pbix` file included in submission
- [ ] Certification notes pasted in Partner Center (they clear each time!)

---

## AppSource URLs (set these in pbiviz.json and Partner Center)

| Field             | URL |
|-------------------|-----|
| Support           | https://tinocallarisa-web.github.io/histogram-pro/support.html |
| Privacy           | https://tinocallarisa-web.github.io/histogram-pro/privacy.html |
| Terms             | https://tinocallarisa-web.github.io/histogram-pro/terms.html |
| GitHub (cert)     | https://github.com/tinocallarisa-web/histogram-pro/tree/certification |

---

## Plan ID (must be exact)

`histogram-pro-tcviz`

## Version history

| Version   | Date       | Notes |
|-----------|------------|-------|
| 1.0.0.0   | 2026-06-09 | Initial AppSource submission |
