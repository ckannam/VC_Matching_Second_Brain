# JHTV Backers (Revealed Co-Investment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class "JHTV backers" layer to the Second Brain sourced from real co-investment history (`data/jhtv_investors.json`): a VC-page badge, a `#/backers` browse page, and tech→firm pins/bonuses — without changing `scoring.js`.

**Architecture:** Mirror the existing `jhtv_relationships.json` load/resolve path (`resolveRelationships` → `REL_BY_VC`/`UNMATCHED_RELS`). Add a parallel `resolveInvestors` → `INVESTORS_BY_VC`/`UNMATCHED_INVESTORS` plus a normalized company→backers index. Layer tech→firm signals onto `findVCsForTech`'s existing `sortScore` mechanism (the in-brief +0.1 bonus). All new fetches fail-soft; all logic lives in `index.html` (classic script) with plain-Node tests via the eval-marker pattern.

**Tech Stack:** Static site — `index.html` (classic `<script>`), `style.css`, Node CLI scripts, plain-Node `assert` tests (`exit(1)` on fail), `xlsx` dev dep for the converter.

## Global Constraints

- No build step; `index.html` is a classic script — new functions are globals, callable from inline `onclick`s. Preserve the `show*` (set `location.hash`) / `render*` (dispatched by `hashchange`) convention.
- **Do NOT change `scoring.js`** (weights `{portfolio:0.55, stageCheck:0.30, sector:0.15}`, all portfolio logic). Tech→firm signals layer on top of `vcFitScore` only.
- **Filter `type ∈ {venture, angel}` at load** (299 firms). `foundation` (5) + `public` (8) stay in the JSON but must never enter any UI-facing structure.
- **Case-b bonus is capped, not stacked:** relationship bonus = `max(inBrief?0.1:0, isBacker?0.1:0)` — a firm on both signals gets +0.1 total.
- **Case-a can add below-floor firms** (exact-tech investors pin to top even if unprofiled); case-b must not manufacture a below-floor match.
- All new `fetch()`s fail-soft: missing/empty `jhtv_investors.json` ⇒ no visible change anywhere.
- Tests: plain Node `assert`, `process.exit(fail?1:0)`, mirroring `test/scoring.test.js`. `index.html` logic is tested by extracting the code between the `// ── JHU Connections ──` and `// ── Search ──` markers and `eval`-ing it (documented pattern). Pure rendering is verified in-browser.
- Branding: navy `#003B6F`, gold `#C8973A` (already = "In VC brief"), rel badge navy. **New backer badge = emerald `#0E9F6E`** (distinct from both).
- Data shape of `data/jhtv_investors.json`: `{ meta:{counts:{venture,angel,foundation,public}}, investors:[{investor,type,companiesBacked[],companyCount,dealCount,totalInvested,firstDate,lastDate,deals[]}] }`, sorted by `companyCount` desc then `dealCount`.

---

### Task 1: Vendor the artifacts + converter test

**Files:**
- Create: `scripts/convert_jhtv_investors.js` (provided — commit as-is)
- Create: `data/jhtv_investors.json` (provided — commit as-is)
- Create: `data/source/Venture_Funding_-_Grouped_By_Investor.xlsx` (provided — commit as-is)
- Modify: `package.json` (add npm script)
- Test: `test/convert_jhtv_investors.test.js`

**Interfaces:**
- Produces: `data/jhtv_investors.json` with `meta.counts.{venture,angel,foundation,public}` and an `investors[]` array of records matching the Global-Constraints shape.

- [ ] **Step 1: Place the three provided files** at the paths above (they are pre-written/validated — do not author them). Confirm the JSON loads and has the expected totals:

Run: `node -e "const d=require('./data/jhtv_investors.json'); const c=d.meta.counts; console.log(c, 'array='+d.investors.length)"`
Expected: `{ venture: <n>, angel: <n>, foundation: 5, public: 8 } array=312` with `venture+angel = 299`.

> If the files are unavailable, STOP — the rest of the plan depends on them.

- [ ] **Step 2: Add the npm script** to `package.json` `scripts` (after `convert-taxonomy`):

```json
    "convert-jhtv-investors": "node scripts/convert_jhtv_investors.js",
```

- [ ] **Step 3: Write the failing converter test** — `test/convert_jhtv_investors.test.js`:

```javascript
'use strict';
const assert = require('assert');
const data = require('../data/jhtv_investors.json');

let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('✓', n); } catch (e) { fail++; console.log('✗', n, '—', e.message); } };
const invs = data.investors;
const byType = t => invs.filter(i => i.type === t);

check('meta.counts add up to 312 investors', () => {
  const c = data.meta.counts;
  assert.strictEqual(c.venture + c.angel + c.foundation + c.public, 312);
  assert.strictEqual(c.foundation, 5);
  assert.strictEqual(c.public, 8);
});

check('venture + angel = 299 (the UI-eligible set)', () => {
  assert.strictEqual(byType('venture').length + byType('angel').length, 299);
});

check('every record is well-formed', () => {
  for (const i of invs) {
    assert.ok(typeof i.investor === 'string' && i.investor, 'investor name');
    assert.ok(['venture', 'angel', 'foundation', 'public'].includes(i.type), `type ${i.type}`);
    assert.ok(Array.isArray(i.companiesBacked), 'companiesBacked array');
    assert.strictEqual(i.companyCount, i.companiesBacked.length, `${i.investor} companyCount matches`);
    assert.ok(Number.isFinite(i.dealCount) && i.dealCount >= i.companyCount, 'dealCount >= companyCount');
    assert.ok(Number.isFinite(i.totalInvested), 'totalInvested number');
    assert.ok(Array.isArray(i.deals) && i.deals.length === i.dealCount, 'deals length matches dealCount');
  }
});

check('investors are sorted by companyCount desc then dealCount', () => {
  for (let k = 1; k < invs.length; k++) {
    const a = invs[k - 1], b = invs[k];
    assert.ok(a.companyCount > b.companyCount || (a.companyCount === b.companyCount && a.dealCount >= b.dealCount),
      `order at ${k}: ${a.investor} before ${b.investor}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 4: Run the test**

Run: `node test/convert_jhtv_investors.test.js`
Expected: `4 passed, 0 failed`. (If counts differ from 299/13, reconcile with the provided data before continuing — the numbers are load-bearing for later tests.)

- [ ] **Step 5: Commit**

```bash
git add scripts/convert_jhtv_investors.js data/jhtv_investors.json "data/source/Venture_Funding_-_Grouped_By_Investor.xlsx" package.json test/convert_jhtv_investors.test.js
git commit -m "feat: vendor jhtv_investors data + converter, with counts test"
```

---

### Task 2: Load + resolve investors in `index.html`

**Files:**
- Modify: `index.html` — `loadData()` (`~96-108`); new code in the `JHU Connections`↔`Search` marker region (before `// ── Search ──`, `line 445`)
- Test: `test/jhtv_investors_resolve.test.js`

**Interfaces:**
- Produces (globals in `index.html`, inside the extractable marker region):
  - `JHTV_INVESTORS` — array of venture/angel records only.
  - `INVESTORS_BY_VC` — `Map(vcId → investor record)`.
  - `UNMATCHED_INVESTORS` — array of venture/angel records with no `vcs.json` match.
  - `BACKERS_BY_COMPANY` — `Map(normalizedCompanyKey → investor record[])`.
  - `resolveInvestors()` — populates all four from `JHTV_INVESTORS` + `VCS`.
  - `normalizeCompanyKey(name)` — `string → string` (lowercase, strip punctuation & common suffixes).
- Consumes: `vcMatchingName(firmName)` (existing, `line 422`).

- [ ] **Step 1: Add the fail-soft fetch to `loadData()`.** In the `Promise.all` (`index.html:96-102`) add a 6th fetch and destructure a raw var; below `PORTFOLIO_BY_VC = ...` filter to venture/angel:

```javascript
      let portfolios, investorsRaw;
      [VCS, TECHS, JHU_CONNECTIONS, JHTV_RELATIONSHIPS, portfolios, investorsRaw] = await Promise.all([
        fetch('data/vcs.json').then(r => r.json()),
        fetch('data/technologies.json').then(r => r.json()),
        fetch('data/jhu_connections.json').then(r => r.json()),
        fetch('data/jhtv_relationships.json').then(r => r.ok ? r.json() : []).catch(() => []),
        fetch('data/vc_portfolios.json').then(r => r.ok ? r.json() : []).catch(() => []),
        fetch('data/jhtv_investors.json').then(r => r.ok ? r.json() : { investors: [] }).catch(() => ({ investors: [] })),
      ]);
      PORTFOLIO_BY_VC = new Map(portfolios.map(e => [e.vcId, e.companies]));
      JHTV_INVESTORS = (investorsRaw.investors || []).filter(i => i.type === 'venture' || i.type === 'angel');
```

- [ ] **Step 2: Call `resolveInvestors()`** in `loadData()` immediately after the existing `resolveRelationships();` (`line 108`):

```javascript
      resolveRelationships();
      resolveInvestors();
```

- [ ] **Step 3: Add the resolver block** just before `// ── Search ──` (`line 445`), so it sits inside the eval-extractable region:

```javascript
  // ── JHTV Investors (revealed co-investment) ──────────────────────────────
  // data/jhtv_investors.json filtered to type ∈ {venture, angel}. INVESTORS_BY_VC
  // joins them to vcs.json via the same vcMatchingName() matcher; BACKERS_BY_COMPANY
  // powers the tech→firm "already invested in this tech" pin.
  let JHTV_INVESTORS     = [];
  let INVESTORS_BY_VC    = new Map();  // vc.id → investor record
  let UNMATCHED_INVESTORS = [];        // backers with no vcs.json entry
  let BACKERS_BY_COMPANY = new Map();  // normalized company → investor record[]

  function normalizeCompanyKey(name) {
    return (name || '')
      .toLowerCase()
      .replace(/[.,]/g, ' ')
      .replace(/\b(inc|llc|lp|ltd|corp|co|therapeutics|technologies|health|bio|labs|inc\.)\b/g, ' ')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function resolveInvestors() {
    INVESTORS_BY_VC = new Map();
    UNMATCHED_INVESTORS = [];
    BACKERS_BY_COMPANY = new Map();
    for (const inv of JHTV_INVESTORS) {
      const vc = vcMatchingName(inv.investor);
      if (vc) { if (!INVESTORS_BY_VC.has(vc.id)) INVESTORS_BY_VC.set(vc.id, inv); }
      else UNMATCHED_INVESTORS.push(inv);
      for (const company of inv.companiesBacked || []) {
        const key = normalizeCompanyKey(company);
        if (!key) continue;
        if (!BACKERS_BY_COMPANY.has(key)) BACKERS_BY_COMPANY.set(key, []);
        BACKERS_BY_COMPANY.get(key).push(inv);
      }
    }
  }

  // Backers whose companiesBacked includes this tech (exact-tech "already invested").
  function backersForTech(tech) {
    const keys = new Set([normalizeCompanyKey(tech.name), ...((tech.aliases || []).map(normalizeCompanyKey))]);
    const seen = new Set(), out = [];
    for (const key of keys) {
      if (!key) continue;
      for (const inv of BACKERS_BY_COMPANY.get(key) || []) {
        if (!seen.has(inv.investor)) { seen.add(inv.investor); out.push(inv); }
      }
    }
    return out.sort((a, b) => b.companyCount - a.companyCount);
  }
```

- [ ] **Step 4: Write the failing resolver test** — `test/jhtv_investors_resolve.test.js`. It extracts the marker region, evals it with mocked globals, and asserts resolution:

```javascript
'use strict';
const assert = require('assert');
const fs = require('fs');

// Extract the code between the JHU Connections and Search markers (documented pattern).
const html = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('// ── JHU Connections');
const end = html.indexOf('// ── Search');
assert.ok(start > 0 && end > start, 'markers found');
const region = html.slice(start, end);

// Fixture VCS (subset — the marquee firms that DO exist in vcs.json + their aliases).
const VCS = [
  { id: 'nea', name: 'NEA', aliases: [] },
  { id: 'catalio', name: 'Catalio Capital Management, LP', aliases: ['Catalio'] },
  { id: 'lux-capital', name: 'Lux Capital', aliases: ['Lux'] },
  { id: 'andreessen-horowitz', name: 'Andreessen Horowitz', aliases: ['a16z'] },
];
// Fixture investors: 4 resolvable, 4 expected-unmatched, 1 foundation (must never resolve).
let JHTV_INVESTORS = [
  { investor: 'New Enterprise Associates, inc.', type: 'venture', companiesBacked: ['Redox'], companyCount: 1, dealCount: 1, totalInvested: 1, deals: [] },
  { investor: 'Catalio Capital Management, LP', type: 'venture', companiesBacked: ['Foo'], companyCount: 1, dealCount: 1, totalInvested: 1, deals: [] },
  { investor: 'Lux Capital', type: 'venture', companiesBacked: ['Bar'], companyCount: 1, dealCount: 1, totalInvested: 1, deals: [] },
  { investor: 'Andreessen Horowitz', type: 'venture', companiesBacked: ['Baz'], companyCount: 1, dealCount: 1, totalInvested: 1, deals: [] },
  { investor: 'OrbiMed Advisors', type: 'venture', companiesBacked: [], companyCount: 0, dealCount: 0, totalInvested: 0, deals: [] },
  { investor: 'Third Rock Ventures', type: 'venture', companiesBacked: [], companyCount: 0, dealCount: 0, totalInvested: 0, deals: [] },
  { investor: 'Osage University Partners', type: 'venture', companiesBacked: [], companyCount: 0, dealCount: 0, totalInvested: 0, deals: [] },
  { investor: 'Camden Partners', type: 'venture', companiesBacked: [], companyCount: 0, dealCount: 0, totalInvested: 0, deals: [] },
  { investor: 'Some Foundation', type: 'foundation', companiesBacked: ['Redox'], companyCount: 1, dealCount: 1, totalInvested: 1, deals: [] },
];
// The load-time filter (venture/angel only) — mirror what loadData does before resolve.
JHTV_INVESTORS = JHTV_INVESTORS.filter(i => i.type === 'venture' || i.type === 'angel');

// Eval the region, exposing what we need. `let` decls in the region become locals of this Function.
const run = new Function('VCS', 'JHTV_INVESTORS', region + `
  resolveInvestors();
  return { INVESTORS_BY_VC, UNMATCHED_INVESTORS, BACKERS_BY_COMPANY, normalizeCompanyKey };
`);
const { INVESTORS_BY_VC, UNMATCHED_INVESTORS } = run(VCS, JHTV_INVESTORS);

let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('✓', n); } catch (e) { fail++; console.log('✗', n, '—', e.message); } };

check('marquee firms in vcs.json resolve', () => {
  for (const id of ['nea', 'catalio', 'lux-capital', 'andreessen-horowitz'])
    assert.ok(INVESTORS_BY_VC.has(id), `${id} did not resolve`);
});
check('firms not in vcs.json land in UNMATCHED_INVESTORS', () => {
  const names = UNMATCHED_INVESTORS.map(i => i.investor);
  for (const n of ['OrbiMed Advisors', 'Third Rock Ventures', 'Osage University Partners', 'Camden Partners'])
    assert.ok(names.includes(n), `${n} not in unmatched`);
});
check('foundation/public never resolve (filtered at load)', () => {
  for (const inv of INVESTORS_BY_VC.values()) assert.notStrictEqual(inv.type, 'foundation');
  assert.ok(!UNMATCHED_INVESTORS.some(i => i.type === 'foundation'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 5: Run test to verify it fails first (before Step 3 code exists)** — if implementing strictly TDD, run before adding Step 3:

Run: `node test/jhtv_investors_resolve.test.js`
Expected (pre-Step-3): FAIL — `resolveInvestors is not defined`. After Step 3: `3 passed, 0 failed`.

- [ ] **Step 6: Run the full test and the existing suite**

Run: `node test/jhtv_investors_resolve.test.js && node test/scoring.test.js && node test/taxonomy.test.js`
Expected: resolver `3 passed`; existing suites unchanged.

- [ ] **Step 7: Commit**

```bash
git add index.html test/jhtv_investors_resolve.test.js
git commit -m "feat: load + resolve JHTV investors (INVESTORS_BY_VC, backers index)"
```

---

### Task 3: VC-page "JHTV backer" badge

**Files:**
- Modify: `index.html` — add `backerBadgeHTML()`/`backerDetailHTML()` near `relBadgeHTML` (`line 441`); render in the VC header block (`~line 755`, where `REL_BY_VC` renders)
- Modify: `style.css` — `.backer-badge`, `.backer-detail`

**Interfaces:**
- Consumes: `INVESTORS_BY_VC` (Task 2).
- Produces: `backerBadgeHTML(inv)`, `backerDetailHTML(inv)` → HTML strings.

- [ ] **Step 1: Add the badge + detail helpers** after `relBadgeHTML` (`line 443`):

```javascript
  function fmtMoney(n) {
    if (!n) return null;
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (n >= 1e6) return '$' + Math.round(n / 1e6) + 'M';
    return '$' + Math.round(n / 1e3) + 'K';
  }
  function backerBadgeHTML(inv) {
    return `<span class="pill backer-badge">JHTV backer · ${inv.companyCount} compan${inv.companyCount === 1 ? 'y' : 'ies'}</span>`;
  }
  function backerDetailHTML(inv) {
    const money = fmtMoney(inv.totalInvested);
    const year = (inv.lastDate || '').slice(0, 4);
    const cos = inv.companiesBacked || [];
    const shown = cos.slice(0, 6).join(', ');
    const more = cos.length > 6 ? ` +${cos.length - 6} more` : '';
    const bits = [`Funded ${shown}${more}`, money ? `${money} total` : '', year ? `last check ${year}` : ''].filter(Boolean);
    return `<div class="backer-detail">${bits.join(' · ')}</div>`;
  }
```

- [ ] **Step 2: Render on the VC page.** At the VC-header relationship line (`index.html:755`), add the backer badge/detail directly above the existing `REL_BY_VC` line:

```javascript
          ${INVESTORS_BY_VC.has(vc.id) ? `<div class="rel-line">${backerBadgeHTML(INVESTORS_BY_VC.get(vc.id))}</div>${backerDetailHTML(INVESTORS_BY_VC.get(vc.id))}` : ''}
```

- [ ] **Step 3: Add styles** to `style.css` (near the existing `.rel-badge` rules):

```css
.backer-badge { background: #0E9F6E; color: #fff; }
.backer-detail { font-size: 0.85rem; color: #475569; margin-top: 4px; }
```

- [ ] **Step 4: Verify in the browser**

Run: `python3 -m http.server 8092` then open `http://localhost:8092/index.html#/vc/nea` (or any VC that resolves to a backer — pick one from `INVESTORS_BY_VC`; confirm via console `[...INVESTORS_BY_VC.keys()]`).
Expected: emerald "JHTV backer · N companies" badge + a detail line (companies, `$XM` total, "last check YYYY"). No console errors. A VC with no backer record shows no badge (unchanged).

- [ ] **Step 5: Commit**

```bash
git add index.html style.css
git commit -m "feat: JHTV backer badge + detail on VC pages"
```

---

### Task 4: `#/backers` browse page

**Files:**
- Modify: `index.html` — nav button (`line 25`), `showBackers()`/`renderBackers()`, route in `dispatchRoute` (`line 565`)
- Modify: `style.css` — `.backer-row` list styles (reuse existing list classes where possible)

**Interfaces:**
- Consumes: `JHTV_INVESTORS`, `INVESTORS_BY_VC` inverse (resolve by record), `vcMatchingName`, `fmtMoney`, `triggerResearch`.
- Produces: `showBackers()`, `renderBackers()`.

- [ ] **Step 1: Add the nav button** after the "Saved briefs" button (`index.html:25`):

```html
      <button class="nav-link" onclick="showBackers()">JHTV backers</button>
```

- [ ] **Step 2: Add the route** in `dispatchRoute` after the `#/grants` line (`line 565`):

```javascript
    if (h === '#/backers')      return renderBackers();
```

- [ ] **Step 3: Add `showBackers`/`renderBackers`** near `showSavedBriefs`/`renderSavedBriefs` (`~line 240`):

```javascript
  function showBackers() { location.hash = '#/backers'; }

  function renderBackers() {
    // Resolve each backer to a vcId once (for the clickable link).
    const rows = JHTV_INVESTORS
      .slice()
      .sort((a, b) => b.companyCount - a.companyCount || b.dealCount - a.dealCount)
      .map(inv => {
        const vc = vcMatchingName(inv.investor);
        const money = fmtMoney(inv.totalInvested);
        const years = [(inv.firstDate || '').slice(0, 4), (inv.lastDate || '').slice(0, 4)].filter(Boolean).join('–');
        const cos = (inv.companiesBacked || []).slice(0, 8).join(', ') + ((inv.companiesBacked || []).length > 8 ? '…' : '');
        const nameHTML = vc
          ? `<a href="#/vc/${vc.id}" class="vc-fit-name">${inv.investor}</a>`
          : `<span class="vc-fit-name">${inv.investor}</span>
             <button class="rel-chip" onclick="triggerResearch('${inv.investor.replace(/'/g, "\\'")}')" title="Not yet profiled">research</button>`;
        const stats = [`${inv.companyCount} companies`, `${inv.dealCount} deals`, money, years].filter(Boolean).join(' · ');
        return `<div class="backer-row"><div class="vc-fit-main">${nameHTML}</div>
                  <div class="vc-fit-detail">${stats}${cos ? ` — ${cos}` : ''}</div></div>`;
      }).join('');

    showResults().innerHTML = `
      <div class="catalog-section">
        <div class="catalog-header">
          <h2>JHTV backers — ${JHTV_INVESTORS.length} firms</h2>
          <button class="view-all-link" onclick="showDomainBrowse()">← Back to catalog</button>
        </div>
        <p class="section-label">Firms that have actually invested in JHTV/Hopkins companies, by companies backed.</p>
        <div class="vc-fit-list">${rows}</div>
      </div>`;
  }
```

- [ ] **Step 4: Add styles** to `style.css`:

```css
.backer-row { padding: 10px 0; border-bottom: 1px solid #E2E8F0; }
```

- [ ] **Step 5: Verify in the browser**

Open `http://localhost:8092/index.html#/backers`.
Expected: the "JHTV backers" nav button loads a ranked list of all 299 firms (top = highest `companyCount`); resolved firms are links, unresolved firms show a "research" chip; each row shows companies/deals/$/years + a truncated companies list. No console errors. Foundation/public firms are absent (`JHTV_INVESTORS` is pre-filtered).

- [ ] **Step 6: Commit**

```bash
git add index.html style.css
git commit -m "feat: #/backers browse page (all 299 venture/angel backers)"
```

---

### Task 5: Tech→firm — case-a pin + capped case-b bonus

**Files:**
- Modify: `index.html` — `findVCsForTech` (`863-877`), `renderTech`'s row renderer + prospect split (`994-1026`); add pure helper `relationshipBonus`
- Test: `test/jhtv_investors_resolve.test.js` (extend — `relationshipBonus` is exported from the same region)

**Interfaces:**
- Consumes: `INVESTORS_BY_VC`, `backersForTech` (Task 2), `vcFitScore`.
- Produces: `relationshipBonus(inBrief, isBacker)` → `0 | 0.1`; `findVCsForTech` rows gain `isBacker`, `alreadyInvested`, and (for pinned unprofiled firms) `unprofiledBacker` fields.

- [ ] **Step 1: Add the pure bonus helper** in the marker region (near `resolveInvestors`, so the eval test can reach it):

```javascript
  // Relationship sort bonus is CAPPED, not stacked: a firm that is both an
  // in-brief pick and a JHTV backer still gets +0.1 total (not +0.2).
  function relationshipBonus(inBrief, isBacker) { return (inBrief || isBacker) ? 0.1 : 0; }
```

- [ ] **Step 2: Extend the resolver test** (`test/jhtv_investors_resolve.test.js`) — add to the `return {...}` in the `new Function(...)` call: `relationshipBonus` and append checks:

```javascript
// (add relationshipBonus to the destructured return of run(...))
check('relationship bonus is capped at 0.1 (no stacking)', () => {
  const { relationshipBonus } = run(VCS, JHTV_INVESTORS);
  assert.strictEqual(relationshipBonus(false, false), 0);
  assert.strictEqual(relationshipBonus(true, false), 0.1);
  assert.strictEqual(relationshipBonus(false, true), 0.1);
  assert.strictEqual(relationshipBonus(true, true), 0.1);
});
```

- [ ] **Step 3: Run the extended test to verify it fails then passes**

Run: `node test/jhtv_investors_resolve.test.js`
Expected: after Step 1, `4 passed, 0 failed`.

- [ ] **Step 4: Rework `findVCsForTech`** (`index.html:863-877`) to add case-a pins and the capped case-b bonus:

```javascript
  function findVCsForTech(tech) {
    const rows = [];
    const backerNames = new Set(backersForTech(tech).map(i => i.investor)); // exact-tech investors
    for (const vc of VCS) {
      const briefMatch = (vc.matchedTechs || []).includes(tech.id);
      const inBrief = !!vc.vcOnePager && briefMatch;
      const backerRec = INVESTORS_BY_VC.get(vc.id);
      const isBacker = !!backerRec;
      const alreadyInvested = isBacker && backerNames.has(backerRec.investor);
      const fit = vcFitScore(vc, tech, PORTFOLIO_BY_VC.get(vc.id));
      const bonus = relationshipBonus(inBrief, isBacker);
      if (fit) {
        if (fit.score >= 0.45 || inBrief || alreadyInvested)
          rows.push({ vc, fit, inBrief, isBacker, alreadyInvested, backerRec,
                      sortScore: fit.score + bonus + (alreadyInvested ? 1 : 0) });
      } else if (briefMatch || alreadyInvested) {
        rows.push({ vc, fit: null, inBrief, isBacker, alreadyInvested, backerRec,
                    sortScore: 0.75 + (alreadyInvested ? 1 : 0) });
      }
    }
    // Unprofiled exact-tech investors (not in vcs.json) — pinned, non-scored rows.
    const profiled = new Set([...INVESTORS_BY_VC.values()].map(i => i.investor));
    const unprofiledPins = backersForTech(tech)
      .filter(inv => !profiled.has(inv.investor))
      .map(inv => ({ vc: null, fit: null, inBrief: false, isBacker: true, alreadyInvested: true,
                     backerRec: inv, unprofiledBacker: true, sortScore: 2 }));
    return [...unprofiledPins, ...rows].sort((a, b) => b.sortScore - a.sortScore);
  }
```

> `alreadyInvested` adds `+1` (pins above any 0–1 fit score); unprofiled pins use `sortScore:2` so they sit at the very top. Case-b `bonus` is the capped `relationshipBonus` (never stacks with in-brief).

- [ ] **Step 5: Update the row renderer in `renderTech`** (`index.html:994-1010`) to add the badges/pill and handle unprofiled pins:

```javascript
    const fitRowHTML = ({ vc, fit, inBrief, isBacker, alreadyInvested, backerRec, unprofiledBacker }) => {
      if (unprofiledBacker) {
        return `<div class="vc-fit-row"><div class="vc-fit-main">
            <span class="vc-fit-name">${backerRec.investor}</span>
            <span class="pill backer-badge">Already invested in ${tech.name}</span>
            <button class="rel-chip" onclick="triggerResearch('${backerRec.investor.replace(/'/g, "\\'")}')" title="Not yet profiled">research</button>
          </div>
          <div class="vc-fit-detail">Has funded ${backerRec.companyCount} JHTV compan${backerRec.companyCount === 1 ? 'y' : 'ies'}.</div></div>`;
      }
      const rel = REL_BY_VC.get(vc.id);
      const badges = [];
      if (alreadyInvested) badges.push(`<span class="pill backer-badge">Already invested in ${tech.name}</span>`);
      if (rel) badges.push(relBadgeHTML(rel));
      if (inBrief) badges.push('<span class="pill fit-badge-curated">In VC brief</span>');
      if (isBacker && !alreadyInvested) badges.push(`<span class="pill backer-pill">has funded ${backerRec.companyCount} JHTV compan${backerRec.companyCount === 1 ? 'y' : 'ies'}</span>`);
      if (fit) { const t = fitTier(fit.score); badges.push(`<span class="pill fit-tier-${t.cls}">${t.label}</span>`); }
      const parts = [];
      if (fit && fit.portfolioHits) parts.push(`has ${fit.portfolioHits} portfolio compan${fit.portfolioHits === 1 ? 'y' : 'ies'} like this`);
      if (fit && fit.sharedDomains.length) parts.push(`invests in ${fit.sharedDomains.join(' & ')}`);
      if (fit && fit.stageOk) parts.push(`backs ${tech.stage || 'this'}-stage companies`);
      const detail = [parts.length ? `${vc.name.split(' ')[0]} ${parts.join(' and ')}.` : '', rel && rel.note ? rel.note : ''].filter(Boolean).join(' · ');
      return vcFitRowHTML(vc, badges.join(''), detail);
    };
```

- [ ] **Step 6: Keep the rel/prospect split working with pins.** In `renderTech` (`1012-1013`), unprofiled pins (`vc:null`) must not break `REL_BY_VC.get(p.vc.id)`. Guard the filters:

```javascript
    const rels      = picks.filter(p => p.vc && REL_BY_VC.has(p.vc.id));
    const prospects = picks.filter(p => !p.vc || !REL_BY_VC.has(p.vc.id));
```

- [ ] **Step 7: Add the `.backer-pill` style** to `style.css`:

```css
.backer-pill { background: #D1FAE5; color: #065F46; }
```

- [ ] **Step 8: Verify no regression + new behavior in the browser**

Open `http://localhost:8092/index.html#/tech/epiwatch` (a tech with many scored VCs).
Expected: top-4 + "Show more" still render with correct tiers (no regression); any resolved backer shows the emerald "has funded N JHTV companies" pill and floats up modestly; a firm that is both in-brief and a backer is not double-boosted (still +0.1). Then open a tech whose exact name is in some backer's `companiesBacked` (find one via console: `[...BACKERS_BY_COMPANY.keys()]` vs `TECHS.map(t=>normalizeCompanyKey(t.name))`) — that backer is pinned at the very top with "Already invested in {tech}". No console errors.

- [ ] **Step 9: Run the full test suite**

Run: `for t in scoring taxonomy vc_matched_techs generate_vc.buildentry convert_jhtv_investors jhtv_investors_resolve; do node test/$t.test.js || break; done`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add index.html style.css test/jhtv_investors_resolve.test.js
git commit -m "feat: tech→firm JHTV-backer pins + capped bonus (scoring.js unchanged)"
```

---

### Task 6: Docs — CLAUDE.md + deferred items

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Add a "JHTV backers (revealed co-investment)" subsection** under the **Data files** section, describing `data/jhtv_investors.json` (shape, venture/angel filter, `INVESTORS_BY_VC`/`UNMATCHED_INVESTORS`/`BACKERS_BY_COMPANY`, `resolveInvestors` mirrors `resolveRelationships`), the emerald badge, the `#/backers` page, the tech→firm case-a pin + capped case-b bonus, and the regeneration path (`npm run convert-jhtv-investors`).

- [ ] **Step 2: Add to the Deferred table** the three deferred items from the spec:

```markdown
| Public + foundation funding sources | TEDCO, Maryland Venture Fund, Abell, NIH, Wellcome … — surface `type: public|foundation` (already tagged) as a separate non-dilutive category. UI/categorization pass, not a re-parse |
| Domain-tag the 99 backed companies | classify historical backed companies into the 8 JHTV domains → co-investment domain-overlap signal in tech→firm (only ~2 are current techs today) |
| Add marquee unmatched backers to vcs.json | OrbiMed, Third Rock, Osage, Camden … resolve to VC pages instead of only the browse list |
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: JHTV backers layer + deferred follow-ups in CLAUDE.md"
```

---

## Self-Review

**Spec coverage:** load/resolve (Task 2) · VC badge (Task 3) · browse all-299 (Task 4) · case-a pin incl. unprofiled + capped case-b bonus + no-regression (Task 5) · converter+counts test, resolver+guard+cap tests (Tasks 1,2,5) · CLAUDE.md + 3 deferred items (Task 6) · npm script (Task 1) · fail-soft + classic-script + emerald badge (Global Constraints). All spec sections map to a task.

**Placeholder scan:** every code/test step contains complete code; no TBD/TODO; verification steps give exact URLs/commands and expected results.

**Type consistency:** `resolveInvestors`, `INVESTORS_BY_VC`, `UNMATCHED_INVESTORS`, `BACKERS_BY_COMPANY`, `normalizeCompanyKey`, `backersForTech`, `relationshipBonus`, `backerBadgeHTML`/`backerDetailHTML`/`fmtMoney`, `showBackers`/`renderBackers` are defined once (Tasks 2–5) and consumed consistently; row-object fields (`isBacker`, `alreadyInvested`, `backerRec`, `unprofiledBacker`) introduced in Task 5 Step 4 are used by the Task 5 Step 5 renderer.

**Known dependency:** all tasks are blocked until the Task 1 artifacts are present on disk.
