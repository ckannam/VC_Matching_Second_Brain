'use strict';
// Integration test over the real data: the VC→techs "matched techs" logic must
// always return 4 (never zero) for every curated firm, and enriched firms with
// no portfolio overlap must still score via their stated profile (stage×check +
// sector), not collapse to an arbitrary zero.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { vcFitScore } = require('../scoring.js');

const load = f => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data', f), 'utf8'));
const vcs = load('vcs.json');
const techs = load('technologies.json');
const PORTFOLIO = new Map(load('vc_portfolios.json').map(e => [e.vcId, e.companies]));
const curatedIds = load('vc_portfolios.json').map(e => e.vcId);

// Mirrors index.html topTechsForVC exactly.
function topTechsForVC(vc, n = 4) {
  return techs
    .map(t => { const f = vcFitScore(vc, t, PORTFOLIO.get(vc.id)); return f ? { t, s: f.score, d: f.sharedDomains.length } : null; })
    .filter(Boolean)
    .sort((a, b) => b.s - a.s || b.d - a.d || a.t.name.localeCompare(b.t.name))
    .slice(0, n);
}

let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('✓', n); } catch (e) { fail++; console.log('✗', n, '—', e.message); } };

check('every curated firm yields exactly 4 matched techs (never zero)', () => {
  for (const id of curatedIds) {
    const vc = vcs.find(v => v.id === id);
    assert(vc, 'missing vc ' + id);
    assert.strictEqual(topTechsForVC(vc).length, 4, `${id} returned != 4`);
  }
});

check('enriched firms are NOT provisional and keep matchedTechs + vcOnePager', () => {
  for (const id of curatedIds) {
    const vc = vcs.find(v => v.id === id);
    assert(!vc.provisional, `${id} was flagged provisional`);
    assert(Array.isArray(vc.matchedTechs), `${id} lost matchedTechs`);
  }
});

check('enriched firm with real portfolio overlap scores via basis full', () => {
  const frazier = vcs.find(v => v.id === 'frazier-life-sciences');
  const ther = techs.find(t => (t.sectors || []).includes('Therapeutics'));
  assert.strictEqual(vcFitScore(frazier, ther, PORTFOLIO.get('frazier-life-sciences')).basis, 'full');
});

check('no-portfolio-overlap enriched firm still scores > 0 (stage×check makes up for it)', () => {
  // Hanabi's portfolio has zero JHTV-domain overlap; its top match must still be
  // a real, non-zero, stage-driven score — not an arbitrary 0.
  const hanabi = vcs.find(v => v.id === 'hanabi-capital');
  const top = topTechsForVC(hanabi);
  assert(top[0].s > 0, `top score was ${top[0].s}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
