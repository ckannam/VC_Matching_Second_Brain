// test/vc_recent_deals.test.js
// Asserts every distinct firm in data/source/vc_deals.json has a deals_firm_to_vcid
// mapping AND that the mapped vcId exists in data/vcs.json.
// Run: node test/vc_recent_deals.test.js

const assert = require('assert');
const deals = require('../data/source/vc_deals.json');
const vcs = require('../data/vcs.json');
const MAP = require('../scripts/lib/deals_firm_to_vcid');
const ids = new Set(vcs.map(v => v.id));
for (const firm of new Set(deals.map(d => d.firm))) {
  assert.ok(MAP[firm], `no vcId mapping for deal firm "${firm}"`);
  assert.ok(ids.has(MAP[firm]), `vcId "${MAP[firm]}" (for "${firm}") missing from vcs.json`);
}
console.log('firm→vcId resolution OK');
