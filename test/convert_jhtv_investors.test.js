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

check('foundation + public = 13 (deferred)', () => {
  assert.strictEqual(byType('foundation').length + byType('public').length, 13);
});

check('every record is well-formed', () => {
  for (const i of invs) {
    assert.ok(typeof i.investor === 'string' && i.investor, 'investor name');
    assert.ok(['venture', 'angel', 'foundation', 'public'].includes(i.type), `type ${i.type}`);
    assert.ok(Array.isArray(i.companiesBacked), 'companiesBacked array');
    assert.strictEqual(i.companyCount, i.companiesBacked.length, `${i.investor} companyCount matches`);
    assert.ok(Number.isFinite(i.dealCount) && i.dealCount >= i.companyCount, `${i.investor} dealCount >= companyCount`);
    assert.ok(Array.isArray(i.deals) && i.deals.length === i.dealCount, `${i.investor} deals length matches dealCount`);
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
