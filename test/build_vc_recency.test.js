'use strict';
const assert = require('assert');
const rec = require('../data/vc_recency.json');
let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('✓', n); } catch (e) { fail++; console.log('✗', n, '—', e.message); } };

check('covers the curated firms that have JHTV-relevant deal history', () => {
  // Mayfield / Emergence / Hanabi have no health/bio deals, so they legitimately have
  // no recency entry (neutral 1.0 at runtime). The other 9 must be present.
  for (const id of ['2048-ventures', '8vc', 'amplify-partners', 'dimension', 'felicis',
    'frazier-life-sciences', 'fusion-fund', 'lux-capital', 'nea'])
    assert.ok(rec.byVc[id], `${id} missing`);
});

check('firms with no JHTV-relevant deals are absent (→ neutral recency at runtime)', () => {
  for (const id of ['mayfield', 'emergence-capital', 'hanabi-capital'])
    assert.ok(!rec.byVc[id], `${id} should be absent`);
});

check('all weights are in [0.5, 1.0]', () => {
  for (const doms of Object.values(rec.byVc))
    for (const w of Object.values(doms)) assert.ok(w >= 0.5 && w <= 1.0, `weight ${w} out of range`);
});

check('a therapeutics fund active recently scores Therapeutics near 1.0', () => {
  assert.ok((rec.byVc['frazier-life-sciences'] || {})['Therapeutics'] >= 0.8);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
