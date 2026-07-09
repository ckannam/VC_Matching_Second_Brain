'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildEntry } = require('../scripts/generate_vc.js');

const techs = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/technologies.json'), 'utf8'));
let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('✓', n); } catch (e) { fail++; console.log('✗', n, '—', e.message); } };

check('buildEntry produces a 4-tech provisional entry via shared scoring', () => {
  const profile = {
    fullName: 'Test Bio Ventures', aliases: ['TBV'],
    investmentFocus: ['Therapeutics','Oncology'], stages: ['Seed','Series A'],
    checkSizeMin: 1, checkSizeMax: 10, thesis: 'test', geographicFocus: 'Mid-Atlantic',
  };
  const e = buildEntry(profile, techs);
  assert.strictEqual(e.provisional, true);
  assert.strictEqual(e.vcOnePager, null);
  assert.strictEqual(e.matchedTechs.length, 4, `got ${e.matchedTechs.length}`);
  assert.deepStrictEqual(e.checkSize, { min: 1, max: 10 });
  assert(e.matchedTechs.every(id => techs.some(t => t.id === id)), 'matchedTechs are real ids');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
