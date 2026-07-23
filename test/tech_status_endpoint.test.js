'use strict';
const assert = require('assert');
const { validatePausedIds } = require('../server.js');
let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('✓', n); } catch (e) { fail++; console.log('✗', n, '—', e.message); } };

check('accepts an array of strings', () => {
  const v = validatePausedIds({ pausedTechIds: ['a', 'b'] });
  assert.strictEqual(v.ok, true);
  assert.deepStrictEqual(v.pausedTechIds, ['a', 'b']);
});
check('accepts empty array', () => assert.strictEqual(validatePausedIds({ pausedTechIds: [] }).ok, true));
check('rejects non-array / non-strings / missing', () => {
  assert.strictEqual(validatePausedIds({ pausedTechIds: 'x' }).ok, false);
  assert.strictEqual(validatePausedIds({ pausedTechIds: [1, 2] }).ok, false);
  assert.strictEqual(validatePausedIds({}).ok, false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
