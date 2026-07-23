'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Extract the code between the JHU Connections and Search markers (documented pattern).
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('// ── JHU Connections');
const end = html.indexOf('// ── Search');
assert.ok(start > 0 && end > start, 'markers found');
const region = html.slice(start, end);

// Fixture VCS — the marquee firms that DO exist in vcs.json (+ their aliases).
const VCS = [
  { id: 'nea', name: 'NEA', aliases: ['New Enterprise Associates'] },
  { id: 'catalio', name: 'Catalio Capital Management, LP', aliases: ['Catalio'] },
  { id: 'lux-capital', name: 'Lux Capital', aliases: ['Lux'] },
  { id: 'andreessen-horowitz', name: 'Andreessen Horowitz', aliases: ['a16z'] },
];
// Fixture investors: 4 resolvable, 4 expected-unmatched, 1 foundation (must never resolve).
let JHTV_INVESTORS = [
  { investor: 'New Enterprise Associates, inc.', type: 'venture', companiesBacked: ['Redox'], companyCount: 1, dealCount: 1, deals: [] },
  { investor: 'Catalio Capital Management', type: 'venture', companiesBacked: ['Foo'], companyCount: 1, dealCount: 1, deals: [] },
  { investor: 'Lux Capital', type: 'venture', companiesBacked: ['Bar'], companyCount: 1, dealCount: 1, deals: [] },
  { investor: 'Andreessen Horowitz', type: 'venture', companiesBacked: ['Baz'], companyCount: 1, dealCount: 1, deals: [] },
  { investor: 'OrbiMed Advisors', type: 'venture', companiesBacked: [], companyCount: 0, dealCount: 0, deals: [] },
  { investor: 'Third Rock Ventures, LLC', type: 'venture', companiesBacked: [], companyCount: 0, dealCount: 0, deals: [] },
  { investor: 'Osage University Partners', type: 'venture', companiesBacked: [], companyCount: 0, dealCount: 0, deals: [] },
  { investor: 'Camden Partners Holdings LLC', type: 'venture', companiesBacked: [], companyCount: 0, dealCount: 0, deals: [] },
  { investor: 'Some Foundation', type: 'foundation', companiesBacked: ['Redox'], companyCount: 1, dealCount: 1, deals: [] },
];
// Mirror loadData's load-time filter (venture/angel only) before resolve.
JHTV_INVESTORS = JHTV_INVESTORS.filter(i => i.type === 'venture' || i.type === 'angel');

// Eval the region; it declares `let JHTV_INVESTORS` itself, so inject the fixture by
// assignment (VCS is a free global the region reads, so it's a parameter).
const run = () => new Function('VCS', 'FIXTURE', region + `
  JHTV_INVESTORS = FIXTURE;
  resolveInvestors();
  return { INVESTORS_BY_VC, UNMATCHED_INVESTORS, BACKERS_BY_COMPANY, relationshipBonus, backersForTech, normalizeCompanyKey };
`)(VCS, JHTV_INVESTORS);

const { INVESTORS_BY_VC, UNMATCHED_INVESTORS, relationshipBonus } = run();

let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('✓', n); } catch (e) { fail++; console.log('✗', n, '—', e.message); } };

check('marquee firms in vcs.json resolve via vcMatchingName', () => {
  for (const id of ['nea', 'catalio', 'lux-capital', 'andreessen-horowitz'])
    assert.ok(INVESTORS_BY_VC.has(id), `${id} did not resolve`);
});

check('firms not in vcs.json land in UNMATCHED_INVESTORS', () => {
  const names = UNMATCHED_INVESTORS.map(i => i.investor);
  for (const n of ['OrbiMed Advisors', 'Third Rock Ventures, LLC', 'Osage University Partners', 'Camden Partners Holdings LLC'])
    assert.ok(names.includes(n), `${n} not in unmatched`);
});

check('foundation/public never resolve (filtered at load)', () => {
  for (const inv of INVESTORS_BY_VC.values()) assert.notStrictEqual(inv.type, 'foundation');
  assert.ok(!UNMATCHED_INVESTORS.some(i => i.type === 'foundation'));
});

check('relationship bonus is capped at 0.1 (no stacking with in-brief)', () => {
  assert.strictEqual(relationshipBonus(false, false), 0);
  assert.strictEqual(relationshipBonus(true, false), 0.1);
  assert.strictEqual(relationshipBonus(false, true), 0.1);
  assert.strictEqual(relationshipBonus(true, true), 0.1);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
