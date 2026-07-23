# Raw scores + de-saturation + recency tiebreaker + up-to-6 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the v2 saturated ceiling (2048: 21 techs tied at 1.00, Frazier: 23 at 0.91) by de-saturating the portfolio score, add a recency + uncapped-depth tiebreaker and up-to-6 "equally strong" tied groups, and surface the raw decimal score in both directions.

**Architecture:** Replace `portfolioFit`'s hard `min(1, credit/K)` clamp with a smooth `1 − e^(−credit/K)` curve (monotonic in depth) and return the uncapped `depth`. Add a pure `selectWithTies` helper in `scoring.js`. A new offline script derives per-VC/per-domain recency into `data/vc_recency.json`, loaded fail-soft in the browser; ranking multiplies `depth × recency` as the tiebreak key. Display shows `tier · 0.NN` and renders a labeled tied group.

**Tech Stack:** Static site — `scoring.js` (dual classic-script + `module.exports`), `index.html` (classic script), `style.css`, Node CLI scripts, plain-Node `assert` tests (`exit(1)` on fail).

## Global Constraints

- **Weights unchanged:** `WEIGHTS = { portfolio: 0.55, stageCheck: 0.30, sector: 0.15 }`; StageCheck and Sector logic untouched. Only the portfolio *aggregation* and ranking/display change.
- De-saturation curve: `portfolioScore = 1 − Math.exp(−credit / PORTFOLIO_K)`, monotonic in `credit`, asymptote < 1. Start `PORTFOLIO_K = 3` (keeps 2048's mid-depth cluster ≈0.94 "Strong"); confirm by tuning against all 12 curated firms before committing.
- Tiebreak is **ordering-only**: `tieKey = depth × recency`, never changes `score`/tier.
- Up-to-6: extend past 4 **only** when the 5th is indistinguishable from the 4th (`|Δscore| < eps` and `|ΔtieKey| < eps`, `eps = 0.005`); cap at 6; mark the tied cluster.
- Score display: decimal beside the tier — `Strong fit · 0.93` — both directions.
- Fail-soft: missing `data/vc_recency.json` ⇒ neutral recency (all weights 1.0), no behavior change.
- `scoring.js` stays pure (recency passed in via the ranking layer, not fetched inside the scorer). Tests are plain Node `assert`, `process.exit(fail?1:0)`, mirroring `test/scoring.test.js`.
- Recency weight range `[0.5, 1.0]`; domain-level (not company-level).

---

### Task 1: De-saturate `portfolioFit` + return `depth`

**Files:**
- Modify: `scoring.js` (`portfolioFit` ~157-175; `PORTFOLIO_K` const ~21; `vcFitScore` return ~230)
- Test: `test/scoring.test.js` (update portfolio-credit cases)

**Interfaces:**
- Produces: `portfolioFit(companies, tech)` → `{ score, depth, hits } | null` where `score = 1 − e^(−credit/PORTFOLIO_K)`, `depth = credit` (uncapped). `vcFitScore(...)` return gains `depth` (0 when no portfolio).

- [ ] **Step 1: Update the constant.** In `scoring.js`, replace the `PORTFOLIO_K` declaration/comment (~line 16-21) with:

```javascript
// Saturation constant for the smooth portfolio curve `1 - exp(-credit/K)`. Replaces
// the old hard `min(1, credit/K)` clamp that pinned deep portfolios to a flat 1.0.
// Lower K = "Strong" reached with less depth + more spread at the top. Tuned to 3 so
// 2048's mid-depth cluster (credit ~8.5) lands ~0.94 while credit ~14 reaches ~0.99.
const PORTFOLIO_K = 3;
```

- [ ] **Step 2: Rewrite the aggregation + return in `portfolioFit`.** Replace the final `return` line:

```javascript
  // Smooth, monotonic-in-depth saturation: more/closer matching portfolio companies
  // always yield a higher score, asymptotically approaching (never clamping at) 1.0.
  // `depth` (uncapped credit) drives the tiebreak in the ranking layer.
  return { score: 1 - Math.exp(-credit / PORTFOLIO_K), depth: credit, hits };
```

- [ ] **Step 3: Thread `depth` through `vcFitScore`.** In the final `return` of `vcFitScore`, add `depth`:

```javascript
  return { score, sharedDomains, stageOk, basis, portfolioHits: pf ? pf.hits : 0, depth: pf ? pf.depth : 0 };
```

- [ ] **Step 4: Update the portfolio tests in `test/scoring.test.js`.** Replace the three credit-cases (`same-rung`, `adjacent-rung`, `domain-only`) and the saturation/linear cases with curve-based assertions. Replace the block from `check('same-rung portfolio company earns 1.0 credit'...` through `check('below saturation scales linearly...` with:

```javascript
const cs = (credit) => 1 - Math.exp(-credit / PORTFOLIO_K);
check('portfolio score follows the smooth curve, uncapped depth returned', () => {
  const r = portfolioFit([THER('Seed')], preClinTech);       // one same-rung company → credit 1.0
  assert(near(r.score, cs(1.0)), `got ${r.score}`);
  assert(near(r.depth, 1.0), `depth ${r.depth}`);
  assert.strictEqual(r.hits, 1);
});
check('adjacent-rung company adds 0.75 credit', () => {
  const r = portfolioFit([THER('Series A')], preClinTech);   // adjacent → 0.75
  assert(near(r.depth, 0.75), `depth ${r.depth}`);
  assert(near(r.score, cs(0.75)));
});
check('domain-only (unknown/far stage) adds 0.5 credit', () => {
  assert(near(portfolioFit([THER(undefined)], preClinTech).depth, 0.5));
  assert(near(portfolioFit([THER('Growth')], preClinTech).depth, 0.5));
});
check('deeper portfolio scores strictly higher (no ceiling clamp)', () => {
  const six  = portfolioFit(Array.from({ length: 6 },  () => THER('Seed')), preClinTech);
  const thirty = portfolioFit(Array.from({ length: 30 }, () => THER('Seed')), preClinTech);
  assert(thirty.score > six.score, `30-deep ${thirty.score} should beat 6-deep ${six.score}`);
  assert(thirty.score < 1 && six.score < 1, 'never clamps to exactly 1.0');
  assert(near(thirty.depth, 30));
});
check('no shared domain earns 0 depth and is not a hit', () => {
  const r = portfolioFit([{ name: 'x', domains: ['Cybersecurity'], stage: 'Seed' }], preClinTech);
  assert(near(r.depth, 0)); assert.strictEqual(r.hits, 0);
});
```

Then fix the two evidence-renormalization cases that hard-code `1 / PORTFOLIO_K`:
- In `"stated + portfolio → basis 'full'..."`: change the expected portfolio term from `(1 / PORTFOLIO_K)` to `cs(1.0)`.
- In `"portfolio only ... score = portfolioFit"`: change expected from `2 / PORTFOLIO_K` to `cs(2.0)` and the setup to two `THER('Seed')` companies.

- [ ] **Step 5: Run the tests.**

Run: `node test/scoring.test.js`
Expected: all pass. If `"portfolio evidence CAN reach Strong"` fails, that means `PORTFOLIO_K` needs raising slightly — note it for Step 6.

- [ ] **Step 6: Tune + eyeball against real data (write a throwaway probe).** Run:

```bash
node -e "
const s=require('./scoring.js'); const T=require('./data/technologies.json');
const V=require('./data/vcs.json'); const P=new Map(require('./data/vc_portfolios.json').map(e=>[e.vcId,e.companies]));
for(const id of ['2048-ventures','frazier-life-sciences','8vc','nea','felicis','lux-capital']){
  const vc=V.find(v=>v.id===id);
  const r=T.map(t=>{const f=s.vcFitScore(vc,t,P.get(id));return f?{n:t.name,s:f.score,d:f.depth}:null}).filter(Boolean).sort((a,b)=>b.s-a.s||b.d-a.d);
  const top=r[0].s, tied=r.filter(x=>Math.abs(x.s-top)<1e-9).length;
  console.log(id.padEnd(22),'top='+top.toFixed(3),'#tied@top='+tied,'| top6:',r.slice(0,6).map(x=>x.s.toFixed(2)).join(','));
}"
```
Expected: 2048 and Frazier no longer show a large `#tied@top`; top-6 scores are a descending spread (not all equal); deep firms still reach ≥0.80. If the top is still flat or Strong is unreachable, adjust `PORTFOLIO_K` (try 2.5–4) and re-run. Record the chosen value in the Step-1 comment.

- [ ] **Step 7: Commit.**

```bash
git add scoring.js test/scoring.test.js
git commit -m "feat: de-saturate portfolioFit (smooth curve + uncapped depth)"
```

---

### Task 2: `selectWithTies` pure helper

**Files:**
- Modify: `scoring.js` (add function near `fitTier`; add to `module.exports`)
- Test: `test/scoring.test.js` (append cases)

**Interfaces:**
- Produces: `selectWithTies(ranked, opts?)` where `ranked` is best-first `[{score, tieKey, ...}]`; `opts = { base=4, max=6, eps=0.005 }`. Returns a new array (length `base..max`) of the same items with an added boolean `tied`. Extends past `base` only when consecutive items are indistinguishable; marks the trailing indistinguishable cluster `tied:true`, else all `tied:false`.

- [ ] **Step 1: Write the failing tests** (append to `test/scoring.test.js`, before the final summary):

```javascript
check('selectWithTies keeps 4 when the 5th is distinguishable', () => {
  const ranked = [1.0, 0.9, 0.8, 0.7, 0.6].map((s, i) => ({ id: i, score: s, tieKey: 5 - i }));
  const out = selectWithTies(ranked);
  assert.strictEqual(out.length, 4);
  assert(out.every(x => x.tied === false));
});
check('selectWithTies extends to <=6 and flags the tied cluster', () => {
  const ranked = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5].map((s, i) => ({ id: i, score: s, tieKey: 2, }));
  const out = selectWithTies(ranked);
  assert.strictEqual(out.length, 6);              // capped at max
  assert(out.every(x => x.tied === true));        // all six are mutually indistinguishable
});
check('selectWithTies uses tieKey to break a score tie (no extension)', () => {
  const ranked = [0.9, 0.9, 0.9, 0.9, 0.9].map((s, i) => ({ id: i, score: s, tieKey: 10 - i }));
  const out = selectWithTies(ranked);             // tieKeys differ → 5th distinguishable from 4th
  assert.strictEqual(out.length, 4);
  assert(out.every(x => x.tied === false));
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `node test/scoring.test.js`
Expected: FAIL — `selectWithTies is not defined`.

- [ ] **Step 3: Implement** (add in `scoring.js` just before `fitTier`):

```javascript
// Given items ranked best-first (each { score, tieKey }), return up to `max`, extending
// past `base` only while consecutive items are indistinguishable (|Δscore|<eps AND
// |ΔtieKey|<eps). When extended, the trailing mutually-indistinguishable cluster is
// flagged `tied:true` so the UI can label it "equally strong". Otherwise `tied:false`.
function selectWithTies(ranked, { base = 4, max = 6, eps = 0.005 } = {}) {
  const n = ranked.length;
  const close = (a, b) => Math.abs(a.score - b.score) < eps && Math.abs((a.tieKey || 0) - (b.tieKey || 0)) < eps;
  if (n <= base) return ranked.map(x => ({ ...x, tied: false }));
  if (!close(ranked[base - 1], ranked[base])) return ranked.slice(0, base).map(x => ({ ...x, tied: false }));
  let end = base;
  while (end < Math.min(max, n) && close(ranked[end - 1], ranked[end])) end++;
  let clusterStart = base - 1;
  while (clusterStart > 0 && close(ranked[clusterStart - 1], ranked[base - 1])) clusterStart--;
  return ranked.slice(0, end).map((x, i) => ({ ...x, tied: i >= clusterStart }));
}
```

- [ ] **Step 4: Export it.** Add `selectWithTies` to the `module.exports` object in `scoring.js`.

- [ ] **Step 5: Run tests.**

Run: `node test/scoring.test.js`
Expected: all pass.

- [ ] **Step 6: Commit.**

```bash
git add scoring.js test/scoring.test.js
git commit -m "feat: selectWithTies helper (up-to-6 equally-strong groups)"
```

---

### Task 3: Recency data (`scripts/build_vc_recency.js` → `data/vc_recency.json`)

**Files:**
- Create: `scripts/build_vc_recency.js`
- Create: `data/vc_recency.json` (generated)
- Modify: `package.json` (npm script)
- Test: `test/build_vc_recency.test.js`

**Interfaces:**
- Produces: `data/vc_recency.json` = `{ generatedAt, note, byVc: { "<vcId>": { "<domain>": <0.5..1.0>, … } } }`.

- [ ] **Step 1: Write the generator** `scripts/build_vc_recency.js`:

```javascript
'use strict';
/* Per-VC, per-JHTV-domain recency weight from PitchBook deal dates. Ordering-only
 * signal for the matching tiebreak (recent activity in a tech's domain → higher).
 *   node scripts/build_vc_recency.js      (or: npm run build-vc-recency)
 * Source: data/source/vc_deals.json. Regenerate after refreshing that export. */
const fs = require('fs');
const path = require('path');

const DEALS = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/source/vc_deals.json'), 'utf8'));

// Mirror of scripts/generate_v1_baseline.js (PitchBook industry label → JHTV domains).
const PB_INDUSTRY_TO_DOMAIN = {
  'Biotechnology': ['Therapeutics'], 'Pharmaceuticals': ['Therapeutics'],
  'Other Pharmaceuticals and Biotechnology': ['Therapeutics'],
  'Drug Delivery': ['Medical Devices', 'Therapeutics'], 'Drug Discovery': ['Therapeutics', 'Research Technologies'],
  'Diagnostic Equipment': ['Diagnostics', 'Medical Devices'], 'Laboratory Services (Healthcare)': ['Research Technologies', 'Diagnostics'],
  'Therapeutic Devices': ['Medical Devices'], 'Surgical Devices': ['Medical Devices'], 'Other Devices and Supplies': ['Medical Devices'],
  'Monitoring Equipment': ['Medical Devices', 'Digital Health'], 'Discovery Tools (Healthcare)': ['Research Technologies'],
  'Clinics/Outpatient Services': ['Digital Health'], 'Enterprise Systems (Healthcare)': ['Digital Health'],
  'Other Healthcare Technology Systems': ['Digital Health'], 'Other Healthcare Services': ['Digital Health'],
  'Medical Records Systems': ['Digital Health'], 'Elder and Disabled Care': ['Digital Health'],
  'Alternative Energy Equipment': ['Clean Tech'],
};
const DEALS_FIRM_TO_VCID = {
  '2048 Ventures': '2048-ventures', '8VC': '8vc', 'Amplify Partners': 'amplify-partners', 'Dimension': 'dimension',
  'Felicis': 'felicis', 'Frazier Life Sciences': 'frazier-life-sciences', 'Fusion Fund': 'fusion-fund',
  'Hanabi Capital Management': 'hanabi-capital', 'Lux Capital': 'lux-capital', 'Mayfield': 'mayfield',
  'NEA': 'nea', 'Emergence Capital': 'emergence-capital',
};

// Deterministic "now" = latest deal date in the dataset. Linear decay to a 0.5 floor over 6 yr.
const NOW = DEALS.map(d => d.date).filter(Boolean).sort().pop();
const MS_YR = 365.25 * 24 * 3600 * 1000;
const FLOOR = 0.5;
function weightForAge(dateISO) {
  const age = (Date.parse(NOW) - Date.parse(dateISO)) / MS_YR;
  return Math.max(FLOOR, Math.min(1, 1 - (age / 6) * (1 - FLOOR)));
}

const byVc = {};
for (const [firm, vcId] of Object.entries(DEALS_FIRM_TO_VCID)) {
  const rows = DEALS.filter(r => r.firm === firm && r.date);
  const mostRecent = {}; // domain → newest ISO date
  for (const r of rows) {
    for (const dom of PB_INDUSTRY_TO_DOMAIN[r.industry] || []) {
      if (!mostRecent[dom] || r.date > mostRecent[dom]) mostRecent[dom] = r.date;
    }
  }
  const domains = {};
  for (const [dom, date] of Object.entries(mostRecent)) domains[dom] = +weightForAge(date).toFixed(3);
  if (Object.keys(domains).length) byVc[vcId] = domains;
}

const doc = { generatedAt: new Date().toISOString(),
  note: 'Per-VC per-JHTV-domain recency weight (0.5..1.0) from vc_deals.json dates. Tiebreak-only.',
  byVc };
fs.writeFileSync(path.join(__dirname, '../data/vc_recency.json'), JSON.stringify(doc, null, 2));
console.error('Wrote data/vc_recency.json for', Object.keys(byVc).length, 'firms (now =', NOW + ')');
```

- [ ] **Step 2: Add npm script** to `package.json` `scripts` (after `convert-jhtv-investors`):

```json
    "build-vc-recency": "node scripts/build_vc_recency.js",
```

- [ ] **Step 3: Generate + eyeball.**

Run: `node scripts/build_vc_recency.js`
Expected: `Wrote data/vc_recency.json for 12 firms (now = 2026-…)`.

- [ ] **Step 4: Write the test** `test/build_vc_recency.test.js`:

```javascript
'use strict';
const assert = require('assert');
const rec = require('../data/vc_recency.json');
let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('✓', n); } catch (e) { fail++; console.log('✗', n, '—', e.message); } };

check('covers the 12 curated firms', () => {
  for (const id of ['2048-ventures', '8vc', 'frazier-life-sciences', 'nea', 'felicis', 'lux-capital',
    'amplify-partners', 'dimension', 'fusion-fund', 'hanabi-capital', 'mayfield', 'emergence-capital'])
    assert.ok(rec.byVc[id], `${id} missing`);
});
check('all weights are in [0.5, 1.0]', () => {
  for (const doms of Object.values(rec.byVc))
    for (const w of Object.values(doms)) assert.ok(w >= 0.5 && w <= 1.0, `weight ${w} out of range`);
});
check('a firm active recently in Therapeutics scores it near 1.0', () => {
  // Frazier is a therapeutics fund with recent deals.
  assert.ok((rec.byVc['frazier-life-sciences'] || {})['Therapeutics'] >= 0.8);
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 5: Run the test.**

Run: `node test/build_vc_recency.test.js`
Expected: `3 passed, 0 failed`. (If the Therapeutics assertion fails, inspect `data/vc_recency.json` — Frazier's newest Therapeutics deal may be older than expected; relax the threshold to match reality rather than forcing it.)

- [ ] **Step 6: Commit.**

```bash
git add scripts/build_vc_recency.js data/vc_recency.json package.json test/build_vc_recency.test.js
git commit -m "feat: build_vc_recency (per-VC per-domain recency weights)"
```

---

### Task 4: VC→tech direction — recency ranking + decimal cards + tied group

**Files:**
- Modify: `index.html` — `loadData` (~96-114), `topTechsForVC` (~618-626), `foundHTML` (~876-877), `techCardHTML` (~881-901)
- Modify: `style.css` — `.tied-group`, `.tech-score`

**Interfaces:**
- Consumes: `selectWithTies`, `vcFitScore(...).depth` (scoring.js); `RECENCY_BY_VC`.
- Produces: `topTechsForVC(vc)` → `[{ t, score, fit, tieKey, tied }]` (best-first, length 4–6); `techDomainRecency(rec, tech)` → number.

- [ ] **Step 1: Load recency in `loadData`.** Add a 7th fetch to the `Promise.all` and assign after `JHTV_INVESTORS`:

```javascript
        fetch('data/vc_recency.json').then(r => r.ok ? r.json() : { byVc: {} }).catch(() => ({ byVc: {} })),
```
Add `recencyRaw` to the destructured list and, below the `JHTV_INVESTORS` line:
```javascript
      RECENCY_BY_VC = recencyRaw.byVc || {};
```
Declare `let RECENCY_BY_VC = {};` near the other top-level `let` data globals (e.g. beside `let PORTFOLIO_BY_VC`).

- [ ] **Step 2: Rework `topTechsForVC`** to rank by score then `tieKey`, and apply `selectWithTies`:

```javascript
  function techDomainRecency(rec, tech) {
    if (!rec) return 1;
    const ws = (tech.sectors || []).map(d => rec[d]).filter(x => x != null);
    return ws.length ? Math.max(...ws) : 1;
  }
  function topTechsForVC(vc) {
    const portfolio = PORTFOLIO_BY_VC.get(vc.id);
    const rec = RECENCY_BY_VC[vc.id] || null;
    const ranked = TECHS
      .map(t => { const fit = vcFitScore(vc, t, portfolio); return fit ? { t, score: fit.score, fit, tieKey: fit.depth * techDomainRecency(rec, t) } : null; })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || b.tieKey - a.tieKey || a.t.name.localeCompare(b.t.name));
    return selectWithTies(ranked, { base: 4, max: 6 });
  }
```

- [ ] **Step 3: Update `foundHTML`'s consumption.** Replace the matched-tech block (~876-877):

```javascript
      <p class="section-label">${techs.length} matched technolog${techs.length === 1 ? 'y' : 'ies'}
        <span class="score-note">— fit scores are model outputs (0–1), not probabilities</span></p>
      <div class="tech-grid">${techs.map(x => techCardHTML(x.t, null, matchReason(vc, x.t), x.score, x.tied)).join('')}</div>
```
Here `techs` is the array returned by `topTechsForVC(vc)` (objects, not bare techs). Confirm the caller passes it through: `foundHTML(vc, topTechsForVC(vc))` already does. If any tied item exists, prefix the grid with a divider — insert immediately before `<div class="tech-grid">`:
```javascript
      ${techs.some(x => x.tied) ? `<p class="tied-group">Top ${techs.filter(x => !x.tied).length} are clearly strongest; the rest are equally strong — not rank-ordered.</p>` : ''}
```

- [ ] **Step 4: Show the decimal on the card.** Change `techCardHTML`'s signature and title line:

```javascript
  function techCardHTML(t, accentColor, reason, score, tied) {
```
and inside, replace the `<h3 ...>` line with:
```javascript
        <h3 class="tech-card-title" onclick="viewTech('${t.id}')" title="View funding profile">${t.name}${typeof score === 'number' ? ` <span class="tech-score${tied ? ' tied' : ''}">${score.toFixed(2)}</span>` : ''}</h3>
```
(Other callers of `techCardHTML` pass no `score` → the span is omitted; unchanged.)

- [ ] **Step 5: Styles** in `style.css`:

```css
.tech-score { font-size: .8rem; color: var(--muted); font-weight: 600; }
.tech-score.tied { color: #0E9F6E; }
.tied-group { font-size: .8rem; color: var(--muted); font-style: italic; margin: 4px 0 8px; }
.score-note { font-size: .72rem; color: var(--muted); font-weight: 400; font-style: italic; }
```

- [ ] **Step 6: Verify in the browser.**

```bash
python3 -m http.server 8094 >/tmp/sb.log 2>&1 &
```
Open `http://localhost:8094/index.html#/vc/2048-ventures`. Expected: matched-tech cards show a decimal score, the top cards have distinct (descending) scores instead of a flat block, and if a tie remains it renders 5–6 cards with the "equally strong" note. Open `#/vc/nea` — clean firm, 4 cards, sane. No console errors. Kill the server: `pkill -f "http.server 8094"`.

- [ ] **Step 7: Commit.**

```bash
git add index.html style.css
git commit -m "feat: VC→tech recency ranking, decimal scores, up-to-6 tied group"
```

---

### Task 5: tech→VC direction — recency tiebreak + decimal badge + tied group

**Files:**
- Modify: `index.html` — `findVCsForTech` (~976-990), `renderTech` fit-badge (~1138-1139) + prospect slice (~1163)
- Modify: `style.css` — reuse `.tied-group`

**Interfaces:**
- Consumes: `selectWithTies`, `techDomainRecency`, `RECENCY_BY_VC`, `vcFitScore(...).depth`.
- Produces: `findVCsForTech(tech)` rows gain `tieKey`; `renderTech` shows up-to-6 prospects with a tied group and a decimal in each fit badge.

- [ ] **Step 1: Add `tieKey` to rows in `findVCsForTech`.** Inside the `for (const vc of VCS)` loop, after `const fit = vcFitScore(...)`, compute recency and attach `tieKey` to every pushed row (both the `fit` and brief-only branches). Replace the two `rows.push({...})` for scored/brief-only to include:

```javascript
      const tieKey = fit ? fit.depth * techDomainRecency(RECENCY_BY_VC[vc.id] || null, tech) : 0;
```
and add `tieKey` to each `rows.push({ … })` object. Keep the existing unprofiled-pin push with `tieKey: 0`. Change the final sort to break ties by `tieKey`:
```javascript
    return [...unprofiledPins, ...rows].sort((a, b) => b.sortScore - a.sortScore || (b.tieKey||0) - (a.tieKey||0));
```

- [ ] **Step 2: Decimal in the fit badge.** In `renderTech`'s `fitRowHTML`, replace the tier-badge push (~1138-1139):

```javascript
      if (fit) {
        const t = fitTier(fit.score);
        badges.push(`<span class="pill fit-tier-${t.cls}">${t.label} · ${fit.score.toFixed(2)}</span>`);
      }
```

- [ ] **Step 3: Up-to-6 for prospects.** Replace the prospect slicing (~1163, `const firstRows = prospects.slice(0, 4)...` and the `moreRows` line) with a `selectWithTies`-driven split. First map prospects to the `{score,tieKey}` shape `selectWithTies` needs, then render:

```javascript
    const prospectRanked = prospects.map(p => ({ ...p, score: p.sortScore, tieKey: p.tieKey || 0 }));
    const shown = selectWithTies(prospectRanked, { base: 4, max: 6 });
    const tiedNote = shown.some(x => x.tied)
      ? `<p class="tied-group">Top ${shown.filter(x => !x.tied).length} are clearly strongest; the rest are equally strong — not rank-ordered.</p>` : '';
    const firstRows = tiedNote + shown.map(fitRowHTML).join('');
    const moreRows  = prospects.slice(shown.length).map(fitRowHTML).join('');
```
(`fitRowHTML` ignores the extra `score`/`tieKey`/`tied` fields it doesn't read, so passing the enriched objects is safe. Confirm the "Show N more" button count uses `prospects.length - shown.length`.)

- [ ] **Step 4: Verify in the browser.**

```bash
python3 -m http.server 8094 >/tmp/sb.log 2>&1 &
```
Open `http://localhost:8094/index.html#/tech/epiwatch`. Expected: each investor-fit row shows `Strong fit · 0.NN`; ordering among equal-tier firms reflects recency; a genuine tie renders up to 6 with the "equally strong" note; "Show N more" still works; no regression to backer pins/pills. No console errors. `pkill -f "http.server 8094"`.

- [ ] **Step 5: Commit.**

```bash
git add index.html style.css
git commit -m "feat: tech→VC decimal scores, recency tiebreak, up-to-6 tied group"
```

---

### Task 6: Docs — CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (Scoring section + Data files + Deferred/Scripts as needed)

- [ ] **Step 1: Update the Scoring section.** Note that `portfolioFit` now uses a smooth `1 − e^(−credit/PORTFOLIO_K)` curve (K=3) returning uncapped `depth` (the old `min(1, credit/K)` hard-cap description is superseded); ranking breaks score ties by `tieKey = depth × domain recency` and shows up to 6 via `selectWithTies`; scores render as decimals beside tiers in both directions.

- [ ] **Step 2: Add the data file + script.** Under Data files, document `data/vc_recency.json` (`{ byVc: { vcId: { domain: 0.5..1.0 } } }`, from `npm run build-vc-recency` / `scripts/build_vc_recency.js`, fail-soft-loaded → `RECENCY_BY_VC`, tiebreak-only). Add the spec+plan paths to the Deferred table.

- [ ] **Step 3: Commit.**

```bash
git add CLAUDE.md
git commit -m "docs: de-saturation + recency tiebreak + decimal scores in CLAUDE.md"
```

---

## Self-Review

**Spec coverage:** de-saturation curve + depth (Task 1) · selectWithTies/up-to-6 (Task 2, used in 4/5) · recency data (Task 3) · recency tiebreak both directions (Tasks 4, 5) · decimal display both directions (Tasks 4, 5) · tied-group rendering (Tasks 4, 5) · tests for curve/ties/recency (Tasks 1–3) · CLAUDE.md (Task 6) · fail-soft recency, weights unchanged, K tuning (Global Constraints + Task 1 Step 6). All spec sections map to a task.

**Placeholder scan:** every code/test step has complete code; tuning (Task 1 Step 6) is a concrete probe with a pass condition and an adjustment rule, not a TODO; browser steps give exact URLs + expected results.

**Type consistency:** `portfolioFit` → `{score, depth, hits}`; `vcFitScore` adds `depth`; `selectWithTies(ranked, {base,max,eps})` → items + `tied`; `topTechsForVC` → `[{t, score, fit, tieKey, tied}]` (consumed by `foundHTML`/`techCardHTML(t, accentColor, reason, score, tied)`); `techDomainRecency(rec, tech)` and `RECENCY_BY_VC[vcId][domain]` consistent across Tasks 3–5. `PORTFOLIO_K` repurposed (value 3) — tests updated in Task 1.
