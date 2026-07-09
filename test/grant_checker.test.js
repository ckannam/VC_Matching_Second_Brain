'use strict';
const assert = require('assert');
const path = require('path');
const { GRANT_FIELDS, techToGrantPrefill, emptyGrantData, overlayLive } = require('../grant_checker.js');
// The shared engine, loaded from the sibling Grant Finder checkout (local dev only).
const { getGrants } = require(path.resolve(__dirname, '../../Grant Finder/grant_engine.js'));

const ENGINE_KEYS = [
  'ventureStage','entityType','technologyType','jhuSchool','leadRole','jhtv',
  'licensing','siteMiner','siteMinerDays','marylandBased','baltimoreArea',
  'teamSize','dilutive','sedi','stemCells','diseaseArea','hasSbirPhaseI',
];

let pass = 0, fail = 0;
function check(name, fn){ try { fn(); pass++; console.log('✓', name); } catch(e){ fail++; console.log('✗', name, '—', e.message); } }

// 1. Every schema field id is a real engine key (no typos, no drift).
check('schema field ids ⊆ engine input keys', () => {
  for (const f of GRANT_FIELDS) assert(ENGINE_KEYS.includes(f.id), `unknown field id: ${f.id}`);
});

// 2. emptyGrantData covers every engine key.
check('emptyGrantData has every engine key', () => {
  const d = emptyGrantData();
  for (const k of ENGINE_KEYS) assert(k in d, `missing key: ${k}`);
});

// 3. A filled data object drives the shared engine to 28 grants.
check('getGrants(filled data) returns all 28 grants', () => {
  const d = Object.assign(emptyGrantData(), {
    ventureStage:'seed', technologyType:'therapeutic', jhuSchool:'som',
    jhtv:'yes', marylandBased:'yes', diseaseArea:'cancer',
  });
  const grants = getGrants(d);
  assert.strictEqual(grants.length, 28, `got ${grants.length}`);
  assert(grants.every(g => ['eligible','conditional','ineligible'].includes(g.s)), 'bad status');
});

// 4. techToGrantPrefill maps a seed therapeutic tech correctly.
check('techToGrantPrefill maps stage + sector', () => {
  const d = techToGrantPrefill({ stage:'Seed', sectors:['Therapeutics'] });
  assert.strictEqual(d.ventureStage, 'seed');
  assert.strictEqual(d.technologyType, 'therapeutic');
  assert.strictEqual(d.jhtv, 'yes');
  assert.strictEqual(d.jhuSchool, 'other_jhu');
});

// 5. overlayLive replaces the deadline from a live entry, and is a safe no-op otherwise.
check('overlayLive overlays deadlineLabel and passes through when absent', () => {
  const g = { id: 'mii', deadline: 'static' };
  const overlaid = overlayLive(g, { mii: { deadlineLabel: 'Oct 15, 2026' } });
  assert.strictEqual(overlaid.deadline, 'Oct 15, 2026');
  assert.strictEqual(overlayLive(g, {}).deadline, 'static', 'no live entry → unchanged');
  assert.strictEqual(overlayLive(g, null).deadline, 'static', 'null map → unchanged');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
