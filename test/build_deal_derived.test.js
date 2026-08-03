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
