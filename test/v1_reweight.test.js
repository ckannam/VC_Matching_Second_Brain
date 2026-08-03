// v1 rubric reweight: geography + check-size removed, redistributed to Sector 0.60 / Stage 0.40.
// (Live scoring.js only — generate_v1_baseline.js keeps its frozen 4-dim copy.)
const assert = require('assert');
const { vcFitScoreV1 } = require('../scoring');

const dxTech = { id: 'dx', name: 'Dx', sectors: ['Diagnostics'], stage: 'Series A' };
const txTech = { id: 'tx', name: 'Tx', sectors: ['Therapeutics'], stage: 'Series A' };
// VC whose stated sector maps (frozen table) to Diagnostics; carries check/geo that must now be ignored.
const dxVC = { id: 'v', sectors: ['diagnostics'], stage: ['Series A'], checkSize: { min: 1, max: 20 }, geographicFocus: 'Mid-Atlantic' };

// On-target: sector overlap 1.0 + stage compatible 1.0 → 0.60 + 0.40 = 1.0
const onTarget = vcFitScoreV1(dxVC, dxTech);
assert.ok(Math.abs(onTarget.score - 1.0) < 1e-9, 'perfect sector+stage → 1.0, got ' + onTarget.score);
assert.ok(!('check' in onTarget) && !('geo' in onTarget), 'v1 result must no longer carry check/geo fields');
assert.strictEqual(onTarget.basis, 'v1');

// Off-sector: Diagnostics VC vs Therapeutics tech → sector 0, stage 1.0 → 0.60·0 + 0.40·1 = 0.40
const offTarget = vcFitScoreV1(dxVC, txTech);
assert.ok(Math.abs(offTarget.score - 0.40) < 1e-9, 'off-sector, perfect-stage → 0.40, got ' + offTarget.score);
assert.ok(offTarget.score < 0.45, 'off-sector firm falls below the 0.45 fit floor → excluded');

// Geography must no longer move the score: same firm/tech, different geo → identical.
const dxVCwest = Object.assign({}, dxVC, { geographicFocus: 'West' });
assert.strictEqual(vcFitScoreV1(dxVCwest, txTech).score, offTarget.score, 'geography must not affect score');
// Check size must no longer move the score either.
const dxVCbigCheck = Object.assign({}, dxVC, { checkSize: { min: 500, max: 2000 } });
assert.strictEqual(vcFitScoreV1(dxVCbigCheck, txTech).score, offTarget.score, 'check size must not affect score');

console.log('v1_reweight OK');
