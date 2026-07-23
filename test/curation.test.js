'use strict';
const assert = require('assert');
const { activeTechs, groupByCohortBucket } = require('../curation.js');
const TECHS = require('../data/technologies.json');
const STATUS = require('../data/tech_status.json');

let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('✓', n); } catch (e) { fail++; console.log('✗', n, '—', e.message); } };

const sample = [
  { id: 'a', name: 'A', sectors: ['Therapeutics'], cohort: 'Cohort 1' },
  { id: 'b', name: 'B', sectors: ['Therapeutics', 'Diagnostics'], cohort: 'Cohort 1' },
  { id: 'c', name: 'C', sectors: ['Digital Health'], cohort: 'Cohort 2' },
];

check('activeTechs excludes exactly the paused ids', () => {
  const out = activeTechs(sample, new Set(['b']));
  assert.deepStrictEqual(out.map(t => t.id), ['a', 'c']);
  assert.strictEqual(activeTechs(sample, []).length, 3);
});

check('groupByCohortBucket groups by cohort then bucket, multi-sector under each', () => {
  const g = groupByCohortBucket(sample);
  assert.deepStrictEqual(g.map(x => x.cohort), ['Cohort 1', 'Cohort 2']);
  const c1 = g[0].buckets;
  assert.deepStrictEqual(c1.map(x => x.bucket), ['Diagnostics', 'Therapeutics']);
  assert.deepStrictEqual(c1.find(x => x.bucket === 'Therapeutics').techs.map(t => t.id), ['a', 'b']);
  assert.deepStrictEqual(c1.find(x => x.bucket === 'Diagnostics').techs.map(t => t.id), ['b']);
});

check('every real tech has a non-empty cohort', () => {
  for (const t of TECHS) assert.ok(t.cohort, `${t.id} missing cohort`);
});

check('tech_status.pausedTechIds is a string[] of real tech ids', () => {
  const ids = new Set(TECHS.map(t => t.id));
  assert.ok(Array.isArray(STATUS.pausedTechIds));
  for (const id of STATUS.pausedTechIds) {
    assert.strictEqual(typeof id, 'string');
    assert.ok(ids.has(id), `paused id ${id} not in catalog`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
