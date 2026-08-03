// Guards the tech funding-profile ordering: deal-verified (v2) firms rank above
// preliminary (v1) firms, with already-invested pins on top. Extracts the REAL
// fitBand comparator from index.html (browser closure — not require-able) and the
// recentActivityHTML label, and exercises them on fixtures.
const assert = require('assert');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');

// ── fitBand (extracted verbatim from findVCsForTech) ──────────────────────────
const bandMatch = src.match(/const fitBand = r =>[\s\S]*?: 0;/);
assert.ok(bandMatch, 'could not extract fitBand from index.html');
let fitBand; eval('fitBand = ' + bandMatch[0].replace(/^const fitBand = /, '').replace(/;$/, ''));

assert.strictEqual(fitBand({ alreadyInvested: true }), 2, 'already-invested → band 2');
assert.strictEqual(fitBand({ unprofiledBacker: true }), 2, 'unprofiled backer → band 2');
assert.strictEqual(fitBand({ fit: { basis: 'full' } }), 1, 'v2 full → band 1');
assert.strictEqual(fitBand({ fit: { basis: 'portfolio' } }), 1, 'v2 portfolio → band 1');
assert.strictEqual(fitBand({ inBrief: true, fit: null }), 1, 'in-brief → band 1');
assert.strictEqual(fitBand({ fit: { basis: 'v1' } }), 0, 'v1 → band 0');

// ── full comparator: pin > v2 > v1, even when a v1 outscores a v2 ──────────────
const cmp = (a, b) => fitBand(b) - fitBand(a) || b.sortScore - a.sortScore || (b.tieKey || 0) - (a.tieKey || 0);
const picks = [
  { id: 'v1hi', fit: { basis: 'v1' }, sortScore: 0.90, tieKey: 0 },   // high-scoring v1
  { id: 'v2lo', fit: { basis: 'full' }, sortScore: 0.55, tieKey: 0 }, // lower-scoring v2
  { id: 'pin', alreadyInvested: true, fit: { basis: 'v1' }, sortScore: 1.6, tieKey: 0 },
  { id: 'v2hi', fit: { basis: 'portfolio' }, sortScore: 0.80, tieKey: 0 },
];
const order = [...picks].sort(cmp).map(p => p.id);
assert.deepStrictEqual(order, ['pin', 'v2hi', 'v2lo', 'v1hi'],
  'expected pin, then v2 by score, then v1 — even though v1hi(0.90) outscores both v2s');

// ── recentActivityHTML label = "Last N investments" (count-accurate) ──────────
const fnMatch = src.match(/function recentActivityHTML\s*\([^)]*\)\s*\{[\s\S]*?\n  \}/);
assert.ok(fnMatch, 'could not extract recentActivityHTML');
let RECENT_BY_VC = {
  full: { dealCount: 160, deals: Array.from({ length: 10 }, (_, i) => ({ date: '2026-01-0' + ((i % 9) + 1), company: 'C' + i, sector: 'Drug Discovery', round: 'Series B', sizeMusd: 10 })) },
  thin: { dealCount: 3, deals: [{ date: '2025-06-01', company: 'X', sector: 'Biotechnology', round: 'Seed', sizeMusd: null }] },
};
let recentActivityHTML; eval('recentActivityHTML = ' + fnMatch[0]);
assert.ok(recentActivityHTML('full').includes('<summary>Last 10 investments</summary>'), 'full firm label');
assert.ok(recentActivityHTML('thin').includes('<summary>Last 1 investment</summary>'), 'single-deal label singular');
assert.strictEqual(recentActivityHTML('missing'), '', 'absent firm → empty');

console.log('tech_view_ordering OK');
