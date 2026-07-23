'use strict';
const assert = require('assert');
const { WEIGHTS, PORTFOLIO_K, STATED_MAX, vcFitScore, fitTier, mapFocusToDomains, portfolioFit, techStageToRung, selectWithTies } = require('../scoring.js');

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

const cs = (credit) => 1 - Math.exp(-credit / PORTFOLIO_K);
check('portfolio score follows the smooth curve, uncapped depth returned', () => {
  const r = portfolioFit([THER('Seed')], preClinTech);      // one same-rung company → credit 1.0
  assert(near(r.score, cs(1.0)), `got ${r.score}`);
  assert(near(r.depth, 1.0), `depth ${r.depth}`);
  assert.strictEqual(r.hits, 1);
});

check('adjacent-rung company adds 0.75 credit', () => {
  const r = portfolioFit([THER('Series A')], preClinTech);  // rung 2 vs 1 → 0.75
  assert(near(r.depth, 0.75), `depth ${r.depth}`);
  assert(near(r.score, cs(0.75)));
});

check('domain-only (unknown/far stage) adds 0.5 credit', () => {
  assert(near(portfolioFit([THER(undefined)], preClinTech).depth, 0.5));
  assert(near(portfolioFit([THER('Growth')], preClinTech).depth, 0.5)); // rung 5 vs 1
});

check('deeper portfolio scores strictly higher (no ceiling clamp)', () => {
  const six    = portfolioFit(Array.from({ length: 6 },  () => THER('Seed')), preClinTech);
  const thirty = portfolioFit(Array.from({ length: 30 }, () => THER('Seed')), preClinTech);
  assert(thirty.score > six.score, `30-deep ${thirty.score} should beat 6-deep ${six.score}`);
  assert(thirty.score < 1 && six.score < 1, 'never clamps to exactly 1.0');
  assert(near(thirty.depth, 30));
});

check('no shared domain earns 0 depth and does not count as a hit', () => {
  const r = portfolioFit([{ name: 'x', domains: ['Cybersecurity'], stage: 'Seed' }], preClinTech);
  assert(near(r.depth, 0));
  assert.strictEqual(r.hits, 0);
});

// ── evidence renormalization (the four basis rows) ────────────────────
const statedPerfect = { sectors: ['Therapeutics'], stage: ['Seed'], checkSize: { min: 1, max: 10 } };
const emptyProfile  = { sectors: [], focus: '' };

check("stated + portfolio → basis 'full', 0.55·P + 0.30·SC + 0.15·Sec (uncapped)", () => {
  const r = vcFitScore(statedPerfect, preClinTech, [THER('Seed')]);
  // P = cs(1.0), SC = 0.5·1 + 0.5·1 = 1, Sec = 1
  assert.strictEqual(r.basis, 'full');
  assert(near(r.score, 0.55 * cs(1.0) + 0.30 * 1 + 0.15 * 1), `got ${r.score}`);
  assert.strictEqual(r.portfolioHits, 1);
});

check("portfolio only (the 12 curated firms' shape) → basis 'portfolio', score = portfolioFit", () => {
  const r = vcFitScore(emptyProfile, preClinTech, [THER('Seed'), THER('Seed')]);
  assert.strictEqual(r.basis, 'portfolio');
  assert(near(r.score, cs(2.0)), `got ${r.score}`);
  assert.strictEqual(r.portfolioHits, 2);
});

check("stated only → basis 'stated', capped at STATED_MAX (perfect fit → 0.75, Good not Strong)", () => {
  const r = vcFitScore(statedPerfect, preClinTech);
  assert.strictEqual(r.basis, 'stated');
  assert(near(r.score, STATED_MAX), `got ${r.score}`);
  assert.strictEqual(fitTier(r.score).cls, 'good');
  assert.strictEqual(r.portfolioHits, 0);
});

check('portfolio evidence CAN reach Strong where stated-only cannot', () => {
  const strongPortfolio = Array.from({ length: 6 }, () => THER('Seed')); // credit 6 → cs(6)≈0.86
  const r = vcFitScore(emptyProfile, preClinTech, strongPortfolio);
  assert(r.score >= 0.80 && fitTier(r.score).cls === 'strong', `got ${r.score}`);
});

check('neither stated profile nor portfolio → null (contract unchanged)', () => {
  assert.strictEqual(vcFitScore(emptyProfile, preClinTech), null);
  assert.strictEqual(vcFitScore(emptyProfile, preClinTech, []), null);
});

// ── sector: any shared domain = 1.0 (multi-domain penalty is dead) ────
check('multi-domain tech is not penalized: one covered domain = full sector credit (v1 halved it)', () => {
  // stage:['Growth'] mismatches a Seed tech → keeps the stated score under the
  // 0.75 cap so the sector contribution is visible.
  const vc = { sectors: ['medtech'], stage: ['Growth'], checkSize: { min: 1, max: 10 } };
  const r1 = vcFitScore(vc, { sectors: ['Medical Devices'], stage: 'Seed' });
  const r2 = vcFitScore(vc, { sectors: ['Therapeutics', 'Medical Devices'], stage: 'Seed' });
  assert(near(r1.score, r2.score), `one-domain ${r1.score} vs two-domain ${r2.score}`);
  assert(r2.sharedDomains.includes('Medical Devices'));
});

check('catch-all-only focus (no specific match) scores 0.5 sector', () => {
  const vc = { sectors: ['deep tech'], stage: ['Growth'], checkSize: { min: 1, max: 10 } };
  const r = vcFitScore(vc, preClinTech);
  // Sec = 0.5, SC = 0.5·0.2 + 0.5·1 = 0.6 → (0.30·0.6 + 0.15·0.5)/0.45, under the cap
  assert(near(r.score, (0.30 * 0.6 + 0.15 * 0.5) / 0.45), `got ${r.score}`);
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

check('mapFocusToDomains flags catch-all and splits primary vs secondary', () => {
  // 'healthcare' → catch-all; 'oncology' → primary Therapeutics, secondary Diagnostics.
  const { primary, secondary, matchesAll } = mapFocusToDomains(['healthcare', 'oncology']);
  assert.strictEqual(matchesAll, true);
  assert(primary.has('Therapeutics'), 'oncology primary → Therapeutics');
  assert(secondary.has('Diagnostics'), 'oncology secondary → Diagnostics');
  assert(!primary.has('Diagnostics'), 'a secondary domain must not also be primary');
});

// The enriched-firm sectors are written as the 8 domain NAMES, so each must
// round-trip to itself as PRIMARY (guards the DOMAIN_SELF_MAP overlay).
check('all 8 JHTV domain names round-trip as primary through mapFocusToDomains', () => {
  const DOMAINS = ['Therapeutics', 'Diagnostics', 'Medical Devices', 'Digital Health',
    'Research Technologies', 'Clean Tech', 'Agricultural Tech', 'Cybersecurity'];
  DOMAINS.forEach(d => {
    const { primary } = mapFocusToDomains([d]);
    assert(primary.has(d), `${d} did not map to itself as primary`);
  });
});

// ── taxonomy upgrade: primary-weighted sector, crosswalk, cyber overlay ───
check('primary-bucket overlap scores strictly higher than secondary-only overlap', () => {
  const tech = { sectors: ['Therapeutics'], stage: 'Seed' };
  const stageMiss = ['Growth'];  // keeps stated score under the cap so sector shows
  const vcPrimary   = { sectors: ['pharma'],        stage: stageMiss, checkSize: { min: 1, max: 10 } };
  const vcSecondary = { sectors: ['animal health'], stage: stageMiss, checkSize: { min: 1, max: 10 } };
  const rP = vcFitScore(vcPrimary, tech);   // pharma → Therapeutics primary
  const rS = vcFitScore(vcSecondary, tech); // animal health → Therapeutics secondary
  assert(rP.score > rS.score, `primary ${rP.score} should beat secondary ${rS.score}`);
});

check('cyber overlay: cybersecurity/security/infosec map to the JHTV Cybersecurity domain', () => {
  for (const term of ['cybersecurity', 'security', 'infosec']) {
    const { primary } = mapFocusToDomains([term]);
    assert(primary.has('Cybersecurity'), `${term} did not map to Cybersecurity`);
  }
});

check('non-JHTV buckets crosswalk to nothing (no false matches for a biotech catalog)', () => {
  for (const term of ['quantum', 'saas', 'fintech', 'gaming']) {
    const { primary, secondary } = mapFocusToDomains([term]);
    assert.strictEqual(primary.size, 0, `${term} produced a primary domain`);
    assert.strictEqual(secondary.size, 0, `${term} produced a secondary domain`);
  }
});

check('whole-phrase matching: "supply chain" does not spuriously match "ai"', () => {
  const { primary } = mapFocusToDomains(['supply chain']);
  assert(!primary.has('Digital Health'), 'ai leaked in via substring of "chain"');
});

// ── selectWithTies (up-to-6 equally-strong groups) ────────────────────
check('selectWithTies keeps 4 when the 5th is distinguishable', () => {
  const ranked = [1.0, 0.9, 0.8, 0.7, 0.6].map((s, i) => ({ id: i, score: s, tieKey: 5 - i }));
  const out = selectWithTies(ranked);
  assert.strictEqual(out.length, 4);
  assert(out.every(x => x.tied === false));
});
check('selectWithTies extends to <=6 and flags the tied cluster', () => {
  const ranked = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5].map((s, i) => ({ id: i, score: s, tieKey: 2 }));
  const out = selectWithTies(ranked);
  assert.strictEqual(out.length, 6);
  assert(out.every(x => x.tied === true));
});
check('selectWithTies uses tieKey to break a score tie (no extension)', () => {
  const ranked = [0.9, 0.9, 0.9, 0.9, 0.9].map((s, i) => ({ id: i, score: s, tieKey: 10 - i }));
  const out = selectWithTies(ranked);
  assert.strictEqual(out.length, 4);
  assert(out.every(x => x.tied === false));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
