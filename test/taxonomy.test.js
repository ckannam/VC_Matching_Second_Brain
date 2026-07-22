'use strict';
const assert = require('assert');
const { VC_KEYWORD_TAXONOMY, BUCKET_TO_DOMAIN, CYBER_KEYWORDS, DOMAIN_SELF_MAP, CATCH_ALL } = require('../taxonomy.js');

let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('✓', n); } catch (e) { fail++; console.log('✗', n, '—', e.message); } };

check('taxonomy loads a full keyword map', () => {
  const n = Object.keys(VC_KEYWORD_TAXONOMY).length;
  assert(n >= 300, `only ${n} keywords loaded`);
});

check('every keyword has a primary bucket + a secondary array', () => {
  for (const [k, v] of Object.entries(VC_KEYWORD_TAXONOMY)) {
    assert(typeof v.primary === 'string' && v.primary, `${k} missing primary`);
    assert(Array.isArray(v.secondary), `${k} secondary not an array`);
  }
});

check('every bucket used by the taxonomy exists in the crosswalk', () => {
  const buckets = new Set();
  for (const v of Object.values(VC_KEYWORD_TAXONOMY)) {
    buckets.add(v.primary);
    v.secondary.forEach(b => buckets.add(b));
  }
  for (const b of buckets) assert(b in BUCKET_TO_DOMAIN, `bucket "${b}" not in BUCKET_TO_DOMAIN`);
});

check('crosswalk keeps 7 JHTV domains and drops the 3 non-JHTV buckets', () => {
  assert.strictEqual(BUCKET_TO_DOMAIN['Climate & Clean Tech'], 'Clean Tech');
  assert.strictEqual(BUCKET_TO_DOMAIN['Agricultural & Food Tech'], 'Agricultural Tech');
  assert.strictEqual(BUCKET_TO_DOMAIN['Therapeutics'], 'Therapeutics');
  for (const b of ['Robotics, AI & Software', 'Industrial & Manufacturing', 'Aerospace, Defense & Quantum'])
    assert.strictEqual(BUCKET_TO_DOMAIN[b], null, `${b} should crosswalk to null`);
});

check('every crosswalk target is one of the 8 JHTV domains (or null)', () => {
  const JHTV = new Set(['Therapeutics', 'Diagnostics', 'Medical Devices', 'Digital Health',
    'Research Technologies', 'Clean Tech', 'Agricultural Tech', 'Cybersecurity']);
  for (const [b, d] of Object.entries(BUCKET_TO_DOMAIN))
    assert(d === null || JHTV.has(d), `${b} → ${d} is not a JHTV domain`);
});

check('DOMAIN_SELF_MAP covers all 8 JHTV display domains', () => {
  const targets = new Set(Object.values(DOMAIN_SELF_MAP));
  for (const d of ['Therapeutics', 'Diagnostics', 'Medical Devices', 'Digital Health',
    'Research Technologies', 'Clean Tech', 'Agricultural Tech', 'Cybersecurity'])
    assert(targets.has(d), `${d} missing from DOMAIN_SELF_MAP`);
});

check('cyber + catch-all overlays are present', () => {
  assert(CYBER_KEYWORDS.includes('cybersecurity') && CYBER_KEYWORDS.includes('infosec'));
  assert(CATCH_ALL.includes('deep tech') && CATCH_ALL.includes('healthcare'));
});

check('spot-check known keyword classifications', () => {
  assert.strictEqual(VC_KEYWORD_TAXONOMY['oncology'].primary, 'Therapeutics');
  assert.strictEqual(VC_KEYWORD_TAXONOMY['food tech'].primary, 'Agricultural & Food Tech');
  assert.strictEqual(VC_KEYWORD_TAXONOMY['quantum'].primary, 'Aerospace, Defense & Quantum');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
