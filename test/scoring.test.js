'use strict';
const assert = require('assert');
const { WEIGHTS, PORTFOLIO_K, vcFitScore, fitTier, mapFocusToDomains, portfolioFit, techStageToRung } = require('../scoring.js');

let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('✓', n); } catch (e) { fail++; console.log('✗', n, '—', e.message); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// ── v2 weights ────────────────────────────────────────────────────────
check('v2 weights sum to 1.0 (portfolio/stageCheck/sector, no geography)', () => {
  assert(near(WEIGHTS.portfolio + WEIGHTS.stageCheck + WEIGHTS.sector, 1.0));
  assert.strictEqual(WEIGHTS.geography, undefined);
  assert.strictEqual(WEIGHTS.portfolio, 0.55);
});

// ── tech milestone → ladder rung ──────────────────────────────────────
check('techStageToRung maps milestone strings onto the round ladder', () => {
  assert.strictEqual(techStageToRung('Pre-Clinical'), 1);   // Seed rung (NOT "clinical")
  assert.strictEqual(techStageToRung('NewCo'), 1);
  assert.strictEqual(techStageToRung('Seed'), 1);
  assert.strictEqual(techStageToRung('Phase I'), 2);        // Series A rung
  assert.strictEqual(techStageToRung('Phase III'), 3);      // Series B rung (NOT "phase i")
  assert.strictEqual(techStageToRung('Series A'), 2);
  assert.strictEqual(techStageToRung('Commercial'), 5);     // Growth rung
  assert.strictEqual(techStageToRung('Mystery milestone'), null);
});

// ── portfolioFit credits ──────────────────────────────────────────────
const THER = t => ({ name: 'x', domains: ['Therapeutics'], stage: t });
const preClinTech = { sectors: ['Therapeutics'], stage: 'Pre-Clinical' }; // rung 1

check('same-rung portfolio company earns 1.0 credit', () => {
  const r = portfolioFit([THER('Seed')], preClinTech);      // rung 1 vs 1
  assert(near(r.score, 1 / PORTFOLIO_K), `got ${r.score}`);
  assert.strictEqual(r.hits, 1);
});

check('adjacent-rung company earns 0.75 credit', () => {
  const r = portfolioFit([THER('Series A')], preClinTech);  // rung 2 vs 1
  assert(near(r.score, 0.75 / PORTFOLIO_K), `got ${r.score}`);
});

check('domain-only (unknown/far stage) earns 0.5 credit', () => {
  const rNoStage = portfolioFit([THER(undefined)], preClinTech);
  const rFar     = portfolioFit([THER('Growth')], preClinTech); // rung 5 vs 1
  assert(near(rNoStage.score, 0.5 / PORTFOLIO_K), `got ${rNoStage.score}`);
  assert(near(rFar.score, 0.5 / PORTFOLIO_K), `got ${rFar.score}`);
});

check('no shared domain earns 0 and does not count as a hit', () => {
  const r = portfolioFit([{ name: 'x', domains: ['Cybersecurity'], stage: 'Seed' }], preClinTech);
  assert(near(r.score, 0));
  assert.strictEqual(r.hits, 0);
});

check('saturating count: 3 strong matches in a 40-company portfolio = full 1.0 (not a fraction)', () => {
  const noise = Array.from({ length: 37 }, (_, i) => ({ name: 'n' + i, domains: [] }));
  const r = portfolioFit([THER('Seed'), THER('Seed'), THER('Seed'), ...noise], preClinTech);
  assert(near(r.score, 1.0), `got ${r.score}`);
  assert.strictEqual(r.hits, 3);
});

// ── evidence renormalization (the four basis rows) ────────────────────
const statedPerfect = { sectors: ['Therapeutics'], stage: ['Seed'], checkSize: { min: 1, max: 10 } };
const emptyProfile  = { sectors: [], focus: '' };

check("stated + portfolio → basis 'full', 0.55·P + 0.30·SC + 0.15·Sec", () => {
  const r = vcFitScore(statedPerfect, preClinTech, [THER('Seed')]);
  // P = 1/3, SC = 0.5·1 + 0.5·1 = 1, Sec = 1
  assert.strictEqual(r.basis, 'full');
  assert(near(r.score, 0.55 * (1 / 3) + 0.30 * 1 + 0.15 * 1), `got ${r.score}`);
  assert.strictEqual(r.portfolioHits, 1);
});

check("portfolio only (the 12 curated firms' shape) → basis 'portfolio', score = portfolioFit", () => {
  const r = vcFitScore(emptyProfile, preClinTech, [THER('Seed'), THER('Seed')]);
  assert.strictEqual(r.basis, 'portfolio');
  assert(near(r.score, 2 / 3), `got ${r.score}`);
  assert.strictEqual(r.portfolioHits, 2);
});

check("stated only → basis 'stated', rescaled /0.45; perfect fit = 1.0 Strong", () => {
  const r = vcFitScore(statedPerfect, preClinTech);
  assert.strictEqual(r.basis, 'stated');
  assert(near(r.score, 1.0), `got ${r.score}`);
  assert.strictEqual(fitTier(r.score).cls, 'strong');
  assert.strictEqual(r.portfolioHits, 0);
});

check('neither stated profile nor portfolio → null (contract unchanged)', () => {
  assert.strictEqual(vcFitScore(emptyProfile, preClinTech), null);
  assert.strictEqual(vcFitScore(emptyProfile, preClinTech, []), null);
});

// ── sector: any shared domain = 1.0 (multi-domain penalty is dead) ────
check('two-domain tech with one covered domain scores full sector (v1 gave 0.5)', () => {
  const vc = { sectors: ['medtech'], stage: ['Seed'], checkSize: { min: 1, max: 10 } };
  const tech = { sectors: ['Therapeutics', 'Medical Devices'], stage: 'Seed' };
  const r = vcFitScore(vc, tech); // stated-only: SC=1, Sec must be 1.0 → 1.0
  assert(near(r.score, 1.0), `got ${r.score}`);
  assert.deepStrictEqual(r.sharedDomains, ['Medical Devices']);
});

check('catch-all-only focus (no specific match) scores 0.5 sector', () => {
  const vc = { sectors: ['deep tech'], stage: ['Seed'], checkSize: { min: 1, max: 10 } };
  const r = vcFitScore(vc, preClinTech);
  // Sec = 0.5, SC = 1 → (0.30·1 + 0.15·0.5)/0.45
  assert(near(r.score, (0.30 + 0.15 * 0.5) / 0.45), `got ${r.score}`);
});

// ── geography is gone from scoring ────────────────────────────────────
check('geography no longer affects the score', () => {
  const east = vcFitScore({ ...statedPerfect, geographicFocus: 'Mid-Atlantic' }, preClinTech);
  const west = vcFitScore({ ...statedPerfect, geographicFocus: 'West Coast' }, preClinTech);
  assert(near(east.score, west.score));
});

// ── unchanged pieces ──────────────────────────────────────────────────
check('fitTier thresholds unchanged', () => {
  assert.strictEqual(fitTier(0.85).cls, 'strong');
  assert.strictEqual(fitTier(0.65).cls, 'good');
  assert.strictEqual(fitTier(0.50).cls, 'possible');
});

check('mapFocusToDomains still flags catch-all and maps specifics', () => {
  const { matched, matchesAll } = mapFocusToDomains(['healthcare', 'oncology']);
  assert.strictEqual(matchesAll, true);
  assert(matched.has('Therapeutics') && matched.has('Diagnostics'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
