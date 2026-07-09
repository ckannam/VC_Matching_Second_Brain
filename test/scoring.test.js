'use strict';
const assert = require('assert');
const { WEIGHTS, vcFitScore, fitTier, mapFocusToDomains } = require('../scoring.js');

let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('✓', n); } catch (e) { fail++; console.log('✗', n, '—', e.message); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// Weights sum to 1.
check('weights sum to 1.0', () => {
  assert(near(WEIGHTS.industry + WEIGHTS.stage + WEIGHTS.checkSize + WEIGHTS.geography, 1.0));
});

// Perfect fit → 1.0, Strong tier.
check('perfect-fit VC scores 1.0 / Strong', () => {
  const vc = { sectors:['Therapeutics'], stage:['Seed'], checkSize:{min:1,max:10}, geographicFocus:'Mid-Atlantic' };
  const tech = { sectors:['Therapeutics'], stage:'Seed' };
  const r = vcFitScore(vc, tech);
  assert(near(r.score, 1.0), `got ${r.score}`);
  assert.strictEqual(fitTier(r.score).cls, 'strong');
});

// Reconciled drift case: catch-all keyword ('healthcare') + full specific match
// must use max(fraction,0.5) = 1.0 (browser rule), NOT the backend's old flat 0.5.
check('catch-all + full specific match uses max(fraction,0.5)=1.0 industry', () => {
  const vc = { sectors:['healthcare','oncology'], stage:['Seed'], checkSize:{min:1,max:10}, geographicFocus:'Mid-Atlantic' };
  const tech = { sectors:['Therapeutics','Diagnostics'], stage:'Seed' };
  const r = vcFitScore(vc, tech);
  // industry=1.0, stage=1, geo=1.0, check: tech[0]=Therapeutics→early, max10≤15 →1  ⇒ full 1.0
  assert(near(r.score, 1.0), `got ${r.score}`);
});

// No-profile VC → null.
check('VC with no sectors/focus → null', () => {
  assert.strictEqual(vcFitScore({ sectors:[], focus:'' }, { sectors:['Therapeutics'], stage:'Seed' }), null);
});

// Poor fit dropped below 0.45.
check('wrong-sector wrong-stage VC scores low', () => {
  const vc = { sectors:['Digital Health'], stage:['Growth'], checkSize:{min:10,max:100}, geographicFocus:'West Coast' };
  const tech = { sectors:['Therapeutics'], stage:'Seed' };
  const r = vcFitScore(vc, tech);
  assert(r.score < 0.45, `got ${r.score}`);
});

// mapFocusToDomains catch-all flag + tolerant of null entries.
check('mapFocusToDomains flags catch-all and maps specifics', () => {
  const { matched, matchesAll } = mapFocusToDomains(['healthcare', 'oncology']);
  assert.strictEqual(matchesAll, true);
  assert(matched.has('Therapeutics') && matched.has('Diagnostics'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
