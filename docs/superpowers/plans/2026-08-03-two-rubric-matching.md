# Two-Rubric Matching + Deal-Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route firms with PitchBook deal data to the v2 (portfolio-led) rubric and firms without it to the ported v1 (four-dimension) rubric, driven by a rerunnable deals→derived-data pipeline, and surface a compact "Recent activity" (last-10 deals) block for deal-data firms.

**Architecture:** A single `scoreVC(vc, tech, portfolio)` dispatcher in `scoring.js` picks v2 when a portfolio exists, else the ported `vcFitScoreV1`. A build script derives portfolios / stage-focus / recency / last-10 from a committed `data/source/vc_deals.json` for every deal-data firm that is not one of the 12 hand-classified curated firms. The browser is unchanged in shape — it just calls `scoreVC` and renders the new block.

**Tech Stack:** Vanilla JS (classic scripts + `module.exports` guard), Node plain-assert test scripts (no runner), static GitHub Pages front end.

## Global Constraints

- No test runner: tests are plain Node scripts that `assert` and `process.exit(1)` on failure. Run one with `node test/<file>.test.js`; run all with `for f in test/*.test.js; do node "$f" || break; done` (exclude `grant_checker` if the sibling `../Grant Finder` repo is absent).
- `scoring.js` and any lib it loads are **dual** classic-script + `module.exports`-guarded so the browser `<script defer>` and Node `require` both work. Never add ES-module `import`/`export`.
- `taxonomy.js` loads before `scoring.js` in `index.html`; do not reorder.
- Branding colors (from `style.css`): navy `#003B6F`, light blue `#005A9C`, gold `#C8973A`. Domain colors live in `DOMAIN_COLORS` in `index.html`.
- Do NOT re-derive or alter the 12 curated hand-classified firms: `2048-ventures, 8vc, amplify-partners, dimension, felicis, frazier-life-sciences, fusion-fund, hanabi-capital, lux-capital, mayfield, nea, emergence-capital`. The derivation script skips any firm already present in `data/vc_portfolios.json`.
- Stage-mapping rules (already applied in the cataloged deal files, re-applied by the lib for safety): `Early Stage VC`→Series A, `Later Stage VC`→Series B, `Angel (individual)`/`Accelerator/Incubator*`→Seed; explicit Series letter wins; Series C+/PIPE/Buyout/IPO/2PO/Secondary→Growth.
- `vc json deal histories/by_firm/*.json` is gitignored staging. The committed source of truth is `data/source/vc_deals.json`.

---

## File Structure

- **Create** `scripts/lib/deal_mapping.js` — shared, dual-export: `PB_INDUSTRY_TO_DOMAIN`, `dealTypeToStage`, `dealTypeToVcStage`, `deriveStageFocus`. Single source for deal→domain/stage logic (consumed by baseline + new build script).
- **Modify** `scripts/generate_v1_baseline.js` — require the lib instead of its inline copies (no behavior change).
- **Create** `scripts/merge_backer_deals.js` — merge gitignored `by_firm/*.json` backer firms into committed `data/source/vc_deals.json` (idempotent; adds only firms not already present).
- **Create** `scripts/build_deal_derived.js` — read `data/source/vc_deals.json`, derive per non-hand-classified firm: portfolio → `data/vc_portfolios.json`; stage-focus → `vcs.json`; last-10 + dealCount → `data/vc_recent_deals.json`. Recency stays with existing `scripts/build_vc_recency.js` (run after).
- **Modify** `scoring.js` — add `vcFitScoreV1(vc, tech)` (ported) + `scoreVC(vc, tech, portfolio)` dispatcher; export both.
- **Modify** `index.html` — call `scoreVC` in `topTechsForVC` (~L826) and `findVCsForTech` (~L1200); fail-soft-load `data/vc_recent_deals.json`; render the "Recent activity" block in `renderVc`.
- **Modify** `scripts/generate_vc.js` — score new researched firms via `scoreVC` (→ v1, no portfolio).
- **Modify** `style.css` — `.recent-activity` block styles.
- **Modify** `CLAUDE.md` — document the two-rubric dispatch, the pipeline, and `vc_recent_deals.json`.
- **Test** `test/deal_mapping.test.js`, `test/scoring.test.js` (extend), `test/build_deal_derived.test.js`, `test/vc_recent_deals.test.js`.

---

## Task 1: Extract shared deal-mapping lib

**Files:**
- Create: `scripts/lib/deal_mapping.js`
- Modify: `scripts/generate_v1_baseline.js` (replace inline `PB_INDUSTRY_TO_DOMAIN`, `dealTypeToStage`, `dealTypeToVcStage`, `deriveStageFocus` with `require`)
- Test: `test/deal_mapping.test.js`

**Interfaces:**
- Produces: `module.exports = { PB_INDUSTRY_TO_DOMAIN, dealTypeToStage, dealTypeToVcStage, deriveStageFocus }`
  - `dealTypeToStage(dealType: string): 'Seed'|'Series A'|'Series B'|'Series C'|'Growth'|undefined` (portfolio round rung)
  - `dealTypeToVcStage(dealType: string): 'Seed'|'Series A'|'Series B'|'Growth'` (firm stage-focus label; Angel/Accelerator→'Seed')
  - `deriveStageFocus(rows: {deal_type}[]): string[]` (VC stages ≥10% of rounds, ladder order)
  - `PB_INDUSTRY_TO_DOMAIN: { [pbLabel: string]: string[] }`

- [ ] **Step 1: Write the failing test**

```js
// test/deal_mapping.test.js
const assert = require('assert');
const { dealTypeToStage, dealTypeToVcStage, deriveStageFocus, PB_INDUSTRY_TO_DOMAIN } =
  require('../scripts/lib/deal_mapping');

// explicit series wins; bare rules; angel/accelerator → Seed
assert.strictEqual(dealTypeToVcStage('Early Stage VC (Series B)'), 'Series B');
assert.strictEqual(dealTypeToVcStage('Later Stage VC (Series B)'), 'Series B');
assert.strictEqual(dealTypeToVcStage('Angel (individual)'), 'Seed');
assert.strictEqual(dealTypeToVcStage('Accelerator/Incubator (Non-Equity)'), 'Seed');
assert.strictEqual(dealTypeToVcStage('Seed Round'), 'Seed');
assert.strictEqual(dealTypeToVcStage('PIPE'), 'Growth');
// stage-focus: ≥10% threshold, ladder order
const focus = deriveStageFocus([
  {deal_type:'Seed Round'},{deal_type:'Seed Round'},{deal_type:'Early Stage VC (Series A)'},
  {deal_type:'Later Stage VC (Series B)'},
]);
assert.deepStrictEqual(focus, ['Seed','Series A','Series B']);
// domain map is a non-empty object
assert.ok(Object.keys(PB_INDUSTRY_TO_DOMAIN).length > 0);
console.log('deal_mapping OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/deal_mapping.test.js`
Expected: FAIL — `Cannot find module '../scripts/lib/deal_mapping'`

- [ ] **Step 3: Create the lib by moving the existing logic**

Create `scripts/lib/deal_mapping.js`. Copy verbatim from `scripts/generate_v1_baseline.js`: the `PB_INDUSTRY_TO_DOMAIN` object (starts ~L179), and the functions `dealTypeToStage` (L210), `dealTypeToVcStage` (L223), `deriveStageFocus` (L234). Append:

```js
module.exports = { PB_INDUSTRY_TO_DOMAIN, dealTypeToStage, dealTypeToVcStage, deriveStageFocus };
```

Add a header comment: `// Shared deal_type/industry → stage/domain mapping. Dual: require()d by scripts. Stage rules: Early→A, Later→B, Angel/Accelerator→Seed, explicit series wins, C+/PIPE/Buyout/IPO→Growth.`

- [ ] **Step 4: Point generate_v1_baseline.js at the lib**

In `scripts/generate_v1_baseline.js`, delete the four inline definitions and add near the top requires:

```js
const { PB_INDUSTRY_TO_DOMAIN, dealTypeToStage, dealTypeToVcStage, deriveStageFocus } =
  require('./lib/deal_mapping');
```

- [ ] **Step 5: Run tests to verify both pass**

Run: `node test/deal_mapping.test.js && node scripts/generate_v1_baseline.js`
Expected: `deal_mapping OK`, and the baseline regenerates `data/baseline_v1_matches.json` without error.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/deal_mapping.js scripts/generate_v1_baseline.js test/deal_mapping.test.js
git commit -m "refactor: extract shared deal_mapping lib from v1 baseline"
```

---

## Task 2: Merge backer deals into committed source

**Files:**
- Create: `scripts/merge_backer_deals.js`
- Modify: `data/source/vc_deals.json` (output — all deal-data firms)
- Test: (assertion inside the script's `--check` path; see Step 3)

**Interfaces:**
- Produces: `data/source/vc_deals.json` = union of existing curated deals + all `by_firm/*.json` backer firms (excludes the `by_firm/deals.json` aggregate and the 12 curated per-firm files already represented). Records keep the 10-field schema.

- [ ] **Step 1: Write the merge script**

```js
// scripts/merge_backer_deals.js
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '../data/source/vc_deals.json');
const BYFIRM = path.join(__dirname, '../vc json deal histories/by_firm');
const CURATED = new Set(['2048 Ventures','8VC','Amplify Partners','Dimension','Emergence Capital',
  'Felicis','Frazier Life Sciences','Fusion Fund','Hanabi Capital Management','Lux Capital','Mayfield','NEA']);
const existing = JSON.parse(fs.readFileSync(SRC,'utf8'));
const have = new Set(existing.map(d => d.firm));
let added = 0;
for (const f of fs.readdirSync(BYFIRM)) {
  if (!f.endsWith('.json') || f === 'deals.json') continue;
  const rows = JSON.parse(fs.readFileSync(path.join(BYFIRM,f),'utf8'));
  const firm = rows[0].firm;
  if (CURATED.has(firm) || have.has(firm)) continue;   // idempotent
  existing.push(...rows); have.add(firm); added += rows.length;
}
existing.sort((a,b) => (a.firm.localeCompare(b.firm)) || (b.deal_date.localeCompare(a.deal_date)));
fs.writeFileSync(SRC, JSON.stringify(existing, null, 2));
console.log(`merged: +${added} deals, ${new Set(existing.map(d=>d.firm)).size} firms total`);
```

- [ ] **Step 2: Run it, then run it again (idempotence)**

Run: `node scripts/merge_backer_deals.js && node scripts/merge_backer_deals.js`
Expected: first run `+N deals`; second run `+0 deals` (same firm total). Firm total = 12 curated + 46 backers = 58.

- [ ] **Step 3: Verify integrity**

Run:
```bash
node -e "const d=require('./data/source/vc_deals.json');const c={};d.forEach(x=>c[x.firm]=(c[x.firm]||0)+1);console.log('firms',Object.keys(c).length,'deals',d.length);const bad=d.filter(x=>Object.keys(x).length!==10);console.log('schema-bad',bad.length)"
```
Expected: `firms 58`, `schema-bad 0`.

- [ ] **Step 4: Commit**

```bash
git add scripts/merge_backer_deals.js data/source/vc_deals.json
git commit -m "feat: merge 46 backer firms' deals into committed vc_deals.json"
```

---

## Task 3: Add vcs.json entries + firm→vcId map

**Files:**
- Create: `scripts/lib/deals_firm_to_vcid.js` (name→id map, dual-export)
- Modify: `data/vcs.json` (add entries for backers not already present)
- Create: `scripts/add_backer_vcs.js` (one-time generator, idempotent)
- Test: `test/vc_recent_deals.test.js` (created here, asserts every deal firm resolves)

**Interfaces:**
- Produces: `DEALS_FIRM_TO_VCID: { [firmName: string]: vcId }` covering all 58 deal-data firms; each mapped `vcId` exists in `vcs.json`.

- [ ] **Step 1: Write the failing resolution test**

```js
// test/vc_recent_deals.test.js  (grows across Tasks 3 & 5)
const assert = require('assert');
const deals = require('../data/source/vc_deals.json');
const vcs = require('../data/vcs.json');
const MAP = require('../scripts/lib/deals_firm_to_vcid');
const ids = new Set(vcs.map(v => v.id));
for (const firm of new Set(deals.map(d => d.firm))) {
  assert.ok(MAP[firm], `no vcId mapping for deal firm "${firm}"`);
  assert.ok(ids.has(MAP[firm]), `vcId "${MAP[firm]}" (for "${firm}") missing from vcs.json`);
}
console.log('firm→vcId resolution OK');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test/vc_recent_deals.test.js`
Expected: FAIL — `Cannot find module '../scripts/lib/deals_firm_to_vcid'`

- [ ] **Step 3: Generate the map + missing vcs.json entries**

Write `scripts/add_backer_vcs.js`: for each distinct firm in `data/source/vc_deals.json`, compute `vcId = slug(firm)` (lowercase, non-alnum→`-`, collapse dashes). Build the name→id object and write `scripts/lib/deals_firm_to_vcid.js`:

```js
module.exports = { /* "Firm Name": "firm-id", … all 58 */ };
```

Reuse the 12 curated firms' existing `vcs.json` ids (map their firm names to the ids already in `vcs.json`, e.g. `"2048 Ventures":"2048-ventures"`). For each backer firm with no `vcs.json` entry, append:

```js
{ id, name: firm, aliases: [], focus: "", sectors: [], stage: [], matchedTechs: [],
  vcOnePager: null, geographicFocus: "", checkSize: { min: null, max: null } }
```

(`sectors`/`stage` are filled by Task 4; leaving them empty here is fine — those firms have portfolios so they never use v1.) Run: `node scripts/add_backer_vcs.js`.

- [ ] **Step 4: Run the resolution test**

Run: `node test/vc_recent_deals.test.js`
Expected: PASS — `firm→vcId resolution OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/add_backer_vcs.js scripts/lib/deals_firm_to_vcid.js data/vcs.json test/vc_recent_deals.test.js
git commit -m "feat: add vcs.json entries + firm→vcId map for backer firms"
```

---

## Task 4: Derive portfolios / stage-focus / last-10 from deals

**Files:**
- Create: `scripts/build_deal_derived.js`
- Modify: `data/vc_portfolios.json` (append derived firms), `data/vcs.json` (fill `stage`), `data/vc_recent_deals.json` (create)
- Test: `test/build_deal_derived.test.js`

**Interfaces:**
- Consumes: `deal_mapping` (Task 1), `deals_firm_to_vcid` (Task 3).
- Produces:
  - `data/vc_portfolios.json` entries `{ vcId, sourceUrl:"pitchbook-deals", scrapedAt, note, companies:[{name, domains[], stage?}] }` for firms **not already present**.
  - `data/vc_recent_deals.json`: `{ [vcId]: { dealCount, deals: [{ date:"YYYY-MM-DD", company, sector, round, sizeMusd }] } }` — the 10 newest deals per firm.

- [ ] **Step 1: Write the failing test (fixture-driven)**

```js
// test/build_deal_derived.test.js
const assert = require('assert');
const { deriveFirm } = require('../scripts/build_deal_derived');
const rows = [
  {firm:'X', company:'A', deal_date:'2026-01-01', deal_type:'Later Stage VC (Series B)', industry:'Drug Discovery', deal_size_musd:100},
  {firm:'X', company:'B', deal_date:'2025-06-01', deal_type:'Seed Round', industry:'Business/Productivity Software', deal_size_musd:5},
];
const out = deriveFirm('x', rows);
// portfolio: Drug Discovery maps to a JHTV domain, stage from deal_type
assert.ok(out.portfolio.companies.find(c => c.name==='A').stage === 'Series B');
assert.ok(Array.isArray(out.portfolio.companies[0].domains));
// last-10 newest-first, ≤10, correct fields
assert.strictEqual(out.recent.deals[0].company, 'A');
assert.strictEqual(out.recent.deals[0].round, 'Series B');
assert.strictEqual(out.recent.dealCount, 2);
// stage focus non-empty
assert.ok(out.stageFocus.length > 0);
console.log('build_deal_derived OK');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test/build_deal_derived.test.js`
Expected: FAIL — `Cannot find module '../scripts/build_deal_derived'`

- [ ] **Step 3: Implement `deriveFirm` + the file writer**

```js
// scripts/build_deal_derived.js
const fs = require('fs'), path = require('path');
const { PB_INDUSTRY_TO_DOMAIN, dealTypeToStage, deriveStageFocus } = require('./lib/deal_mapping');
const MAP = require('./lib/deals_firm_to_vcid');

function deriveFirm(vcId, rows) {
  const sorted = [...rows].sort((a,b) => b.deal_date.localeCompare(a.deal_date));
  const companies = rows.map(r => {
    const domains = PB_INDUSTRY_TO_DOMAIN[r.industry] || [];
    const stage = dealTypeToStage(r.deal_type);
    const c = { name: r.company, domains };
    if (stage) c.stage = stage;
    return c;
  });
  const recent = {
    dealCount: rows.length,
    deals: sorted.slice(0,10).map(r => ({
      date: r.deal_date,
      company: r.company,
      sector: (PB_INDUSTRY_TO_DOMAIN[r.industry] || [r.industry]).join(', ') || r.industry,
      round: dealTypeToStage(r.deal_type) || r.deal_type,
      sizeMusd: r.deal_size_musd ?? null,
    })),
  };
  return {
    portfolio: { vcId, sourceUrl:'pitchbook-deals', scrapedAt: new Date().toISOString().slice(0,10),
                 note:'derived from PitchBook deal history', companies },
    recent,
    stageFocus: deriveStageFocus(rows),
  };
}

function main() {
  const deals = require('../data/source/vc_deals.json');
  const portfolios = require('../data/vc_portfolios.json');
  const vcs = require('../data/vcs.json');
  const haveP = new Set(portfolios.map(p => p.vcId));   // 12 hand-classified — skip
  const byFirm = {};
  deals.forEach(d => (byFirm[d.firm] = byFirm[d.firm] || []).push(d));
  const recent = {};
  for (const [firm, rows] of Object.entries(byFirm)) {
    const vcId = MAP[firm]; if (!vcId) continue;
    const { portfolio, recent: rec, stageFocus } = deriveFirm(vcId, rows);
    recent[vcId] = rec;
    if (!haveP.has(vcId)) portfolios.push(portfolio);         // never touch the 12
    const vc = vcs.find(v => v.id === vcId);
    if (vc && (!vc.stage || !vc.stage.length)) vc.stage = stageFocus;
  }
  fs.writeFileSync(path.join(__dirname,'../data/vc_portfolios.json'), JSON.stringify(portfolios,null,2));
  fs.writeFileSync(path.join(__dirname,'../data/vcs.json'), JSON.stringify(vcs,null,2));
  fs.writeFileSync(path.join(__dirname,'../data/vc_recent_deals.json'), JSON.stringify(recent,null,2));
  console.log(`derived ${Object.keys(recent).length} firms' recent-deals; portfolios now ${portfolios.length}`);
}
if (require.main === module) main();
module.exports = { deriveFirm };
```

- [ ] **Step 4: Run the unit test, then the build**

Run: `node test/build_deal_derived.test.js && node scripts/build_deal_derived.js && npm run build-vc-recency`
Expected: `build_deal_derived OK`; build prints derived-firm count; recency regenerates. Confirm the 12 hand-classified portfolios are unchanged:
```bash
node -e "const p=require('./data/vc_portfolios.json');console.log('portfolios',p.length,'has 2048',!!p.find(x=>x.vcId==='2048-ventures'&&x.sourceUrl!=='pitchbook-deals'))"
```
Expected: `has 2048 true` (still hand-classified, not overwritten).

- [ ] **Step 5: Commit**

```bash
git add scripts/build_deal_derived.js test/build_deal_derived.test.js data/vc_portfolios.json data/vcs.json data/vc_recent_deals.json data/vc_recency.json
git commit -m "feat: derive portfolios/stage-focus/last-10 from deal data"
```

---

## Task 5: Port v1 into scoring.js + add scoreVC dispatcher

**Files:**
- Modify: `scoring.js` (add `V1_WEIGHTS`, frozen `INDUSTRY_TO_DOMAIN`, `V1_STAGE_MAP`, `vcFitScoreV1`, `scoreVC`; extend `module.exports`)
- Test: `test/scoring.test.js` (extend)

**Interfaces:**
- Consumes: `DOMAIN_MATURITY` (already in `scoring.js`).
- Produces:
  - `vcFitScoreV1(vc, tech): { score, industry, stage, check, geo, basis:'v1' }`
  - `scoreVC(vc, tech, portfolioCompanies): { score, …, basis }` — returns `vcFitScore(...)` when `portfolioCompanies` is a non-empty array, else `vcFitScoreV1(vc, tech)`.

- [ ] **Step 1: Write the failing tests**

```js
// append to test/scoring.test.js
const { scoreVC, vcFitScoreV1, vcFitScore } = require('../scoring');
const tech = { id:'t', name:'T', sectors:['Diagnostics & Devices'], stage:'Series A' };
const vcStated = { id:'v', sectors:['diagnostics'], stage:['Series A'], checkSize:{min:1,max:20}, geographicFocus:'Mid-Atlantic' };
// no portfolio → v1
const s1 = scoreVC(vcStated, tech, undefined);
assert.strictEqual(s1.basis, 'v1');
assert.ok(s1.score > 0 && s1.score <= 1);
// v1 parity with generate_v1_baseline's v1Fit weighting (industry .375/stage .30/check .225/geo .10)
assert.ok(Math.abs(vcFitScoreV1(vcStated, tech).score - s1.score) < 1e-9);
// with portfolio → v2 (basis full/portfolio, never 'v1')
const pf = [{ name:'Co', domains:['Diagnostics & Devices'], stage:'Series A' }];
const s2 = scoreVC(vcStated, tech, pf);
assert.notStrictEqual(s2.basis, 'v1');
console.log('scoreVC dispatch OK');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test/scoring.test.js`
Expected: FAIL — `scoreVC is not a function`.

- [ ] **Step 3: Port v1 and add the dispatcher**

In `scoring.js`, above the `module.exports` guard, paste from `scripts/generate_v1_baseline.js`: `V1_WEIGHTS` (L31), the frozen `INDUSTRY_TO_DOMAIN` (L35–L88), `v1MapFocus` (L91), `v1Industry` (L108), `V1_STAGE_MAP` + `v1Stage` (L116–131), `v1Check` (L134), `v1Geo` (L144), `v1Fit` (L153). Then add:

```js
function vcFitScoreV1(vc, tech) {
  const f = v1Fit(vc, tech);
  return { score: f.score, industry: f.industry, stage: f.stage, check: f.check, geo: f.geo, basis: 'v1' };
}
// Single dispatch point: deal-data firms (portfolio present) → v2, else → v1.
function scoreVC(vc, tech, portfolioCompanies) {
  if (Array.isArray(portfolioCompanies) && portfolioCompanies.length)
    return vcFitScore(vc, tech, portfolioCompanies);
  return vcFitScoreV1(vc, tech);
}
```

Extend the exports object (L275) to include `vcFitScoreV1, scoreVC`.

- [ ] **Step 4: Run the full scoring + taxonomy suite**

Run: `node test/scoring.test.js && node test/taxonomy.test.js`
Expected: PASS including `scoreVC dispatch OK`.

- [ ] **Step 5: Commit**

```bash
git add scoring.js test/scoring.test.js
git commit -m "feat: port v1 rubric into scoring.js + add scoreVC dispatcher"
```

---

## Task 6: Wire index.html to scoreVC

**Files:**
- Modify: `index.html` (`topTechsForVC` ~L826, `findVCsForTech` ~L1200, `loadData` fetch list)
- Test: `test/vc_matched_techs.test.js` (extend — never-zero still holds; v1 path returns a score)

**Interfaces:**
- Consumes: `scoreVC` (Task 5), `PORTFOLIO_BY_VC` (existing), `vc_recent_deals.json` (loaded here, consumed by Task 7).

- [ ] **Step 1: Extend the never-zero / dispatch test**

The suite extracts the code between the `// ── JHU Connections ──` and `// ── Search ──` markers and evals it (see CLAUDE.md "Test harness pattern"). `topTechsForVC` is outside that region, so test it by requiring `scoring.js` directly and asserting dispatch: a VC with no portfolio still yields 4 techs with `basis:'v1'`.

```js
// append to test/vc_matched_techs.test.js
const { scoreVC } = require('../scoring');
const techs = require('../data/technologies.json');
const noPortfolioVC = { id:'z', sectors:['Diagnostics'], stage:['Series A'], checkSize:{min:1,max:20}, geographicFocus:'National' };
const scored = techs.map(t => scoreVC(noPortfolioVC, t, undefined)).filter(Boolean);
assert.ok(scored.length === techs.length && scored.every(s => s.basis === 'v1'));
console.log('index dispatch (v1 path) OK');
```

- [ ] **Step 2: Run to verify it fails (before wiring)**

Run: `node test/vc_matched_techs.test.js`
Expected: FAIL if `scoreVC` not exported (already done in Task 5 → this should PASS; if PASS, note the wiring below is the browser-side change the eval-region test can't cover, verified manually in Step 4).

- [ ] **Step 3: Replace `vcFitScore` calls with `scoreVC` and load recent deals**

In `index.html`:
- `topTechsForVC` (~L826): change `const fit = vcFitScore(vc, t, portfolio);` → `const fit = scoreVC(vc, t, portfolio);`
- `findVCsForTech` (~L1200): change `const fit = vcFitScore(vc, tech, PORTFOLIO_BY_VC.get(vc.id));` → `const fit = scoreVC(vc, tech, PORTFOLIO_BY_VC.get(vc.id));`
- In `loadData()`, add a fail-soft fetch of `data/vc_recent_deals.json` into a module-level `RECENT_BY_VC` object (mirror the existing `PORTFOLIO_BY_VC` fail-soft pattern): `let RECENT_BY_VC = {};` and on load `RECENT_BY_VC = await fetchJson('data/vc_recent_deals.json').catch(()=>({}));`

- [ ] **Step 4: Verify in the running app**

Run: `npx serve .` then load `#/vc/orbimed` (deal-data → v2 tiers) and a no-portfolio firm (v1 path). Confirm both render 4+ matched techs with scores and no console errors.

- [ ] **Step 5: Commit**

```bash
git add index.html test/vc_matched_techs.test.js
git commit -m "feat: dispatch matching via scoreVC + load vc_recent_deals"
```

---

## Task 7: "Recent activity" UI block

**Files:**
- Modify: `index.html` (`renderVc` — insert block under the VC header), `style.css` (`.recent-activity`)
- Test: manual (browser) + `test/vc_recent_deals.test.js` (data-shape assertions added here)

**Interfaces:**
- Consumes: `RECENT_BY_VC` (Task 6).

- [ ] **Step 1: Assert the data shape the UI depends on**

```js
// append to test/vc_recent_deals.test.js
const recent = require('../data/vc_recent_deals.json');
for (const [vcId, rec] of Object.entries(recent)) {
  assert.ok(typeof rec.dealCount === 'number');
  assert.ok(rec.deals.length <= 10);
  rec.deals.forEach(d => { assert.ok(d.date && d.company && d.round); });
}
console.log('vc_recent_deals shape OK');
```

- [ ] **Step 2: Run it**

Run: `node test/vc_recent_deals.test.js`
Expected: PASS — `vc_recent_deals shape OK`.

- [ ] **Step 3: Render the collapsed block in `renderVc`**

In `renderVc`, after the header, insert (only when `RECENT_BY_VC[vc.id]` exists):

```js
function recentActivityHTML(vcId) {
  const rec = RECENT_BY_VC[vcId]; if (!rec) return '';
  const fmt = d => { const [y,m]=d.split('-'); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m-1]+' '+y; };
  const rows = rec.deals.map(d => `<tr><td>${fmt(d.date)}</td><td>${d.company}</td><td>${d.sector||''}</td><td>${d.round}</td><td>${d.sizeMusd!=null?'$'+d.sizeMusd+'M':''}</td></tr>`).join('');
  const caveat = rec.dealCount < 10 ? `<p class="ra-caveat">Based on ${rec.dealCount} deals — all PitchBook logged.</p>` : '';
  return `<details class="recent-activity"><summary>Recent activity</summary>
    <table><thead><tr><th>Date</th><th>Company</th><th>Sector</th><th>Round</th><th>Size</th></tr></thead>
    <tbody>${rows}</tbody></table>${caveat}</details>`;
}
```

Call `recentActivityHTML(vc.id)` where the block belongs in the VC template.

- [ ] **Step 4: Add styles**

```css
/* style.css */
.recent-activity { margin: 12px 0; font-size: 0.85rem; }
.recent-activity > summary { color: #003B6F; font-weight: 600; cursor: pointer; }
.recent-activity table { width: 100%; border-collapse: collapse; margin-top: 8px; }
.recent-activity th { text-align: left; color: #005A9C; font-weight: 600; border-bottom: 2px solid #C8973A; padding: 4px 8px; }
.recent-activity td { padding: 4px 8px; border-bottom: 1px solid #eee; color: #444; }
.recent-activity .ra-caveat { color: #888; font-style: italic; margin-top: 6px; }
```

- [ ] **Step 5: Verify in the app**

Run: `npx serve .`; load `#/vc/orbimed` (block present, collapsed, 10 rows) and `#/vc/blackbird-laboratories-inc` (caveat "Based on 3 deals"). Confirm branding and that it's unobtrusive.

- [ ] **Step 6: Commit**

```bash
git add index.html style.css test/vc_recent_deals.test.js
git commit -m "feat: collapsed Recent activity block for deal-data firms"
```

---

## Task 8: Route generate_vc.js through scoreVC

**Files:**
- Modify: `scripts/generate_vc.js` (buildEntry's tech scoring)
- Test: `test/generate_vc.buildentry.test.js` (extend — new firm has no portfolio → v1 basis)

**Interfaces:**
- Consumes: `scoreVC` (Task 5).

- [ ] **Step 1: Extend the buildEntry test**

```js
// append to test/generate_vc.buildentry.test.js
const { scoreVC } = require('../scoring');
// a freshly-researched VC has no portfolio → v1
const fresh = { id:'new', sectors:['Diagnostics'], stage:['Series A'], checkSize:{min:1,max:15}, geographicFocus:'National' };
assert.strictEqual(scoreVC(fresh, require('../data/technologies.json')[0], undefined).basis, 'v1');
console.log('generate_vc v1 path OK');
```

- [ ] **Step 2: Run to verify current state**

Run: `node test/generate_vc.buildentry.test.js`
Expected: PASS (scoreVC exists). If buildEntry still calls `vcFitScore` directly, proceed to wire it.

- [ ] **Step 3: Swap buildEntry's scorer**

In `scripts/generate_vc.js` `buildEntry`, replace the `vcFitScore(vc, tech)` call used to pick top-4 `matchedTechs` with `scoreVC(vc, tech, undefined)` (new firms have no portfolio). Import `scoreVC` from `../scoring`.

- [ ] **Step 4: Run the test**

Run: `node test/generate_vc.buildentry.test.js`
Expected: PASS — `generate_vc v1 path OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate_vc.js test/generate_vc.buildentry.test.js
git commit -m "feat: score researched firms via scoreVC (v1 path)"
```

---

## Task 9: Docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the two-rubric system**

In `CLAUDE.md` Scoring section, add a subsection "Two-rubric dispatch (SHIPPED)": `scoreVC(vc, tech, portfolio)` picks v2 when a portfolio exists else the ported `vcFitScoreV1`; the degraded-v2 'stated' path is retired. Note the pipeline: `by_firm/*.json` (gitignored staging) → `scripts/merge_backer_deals.js` → `data/source/vc_deals.json` → `scripts/build_deal_derived.js` → `vc_portfolios.json` (46 derived, 12 hand kept) + `vcs.json` stage + `vc_recent_deals.json`; rerun only when deal data changes (new techs need no re-derivation). Add `data/vc_recent_deals.json` to Data files with its shape and the last-10 UI note. Add the four scripts to the Scripts section.

- [ ] **Step 2: Run the full suite as a final gate**

Run: `for f in test/*.test.js; do node "$f" || break; done` (exclude `grant_checker` if `../Grant Finder` absent)
Expected: every suite prints its OK line.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: two-rubric dispatch + deal-data pipeline"
```

---

## Self-review notes (addressed)

- **Spec coverage:** dispatch (T5), v1 port (T5), deals→committed (T2), derivation incl. last-10 + stage-focus + recency (T4 + build-vc-recency), vcs.json entries (T3), UI block + caveat (T7), generate_vc (T8), rerun contract (documented T9, tech-independence implied by derivation reading only deals), leave-12-alone (T4 skip via `haveP`). All covered.
- **Types:** `scoreVC`/`vcFitScoreV1` signatures consistent across T5/T6/T8; `deriveFirm` return shape consistent T4↔T7; `RECENT_BY_VC`/`vc_recent_deals.json` shape consistent T6↔T7.
- **No placeholders:** every code/test step carries real content.
