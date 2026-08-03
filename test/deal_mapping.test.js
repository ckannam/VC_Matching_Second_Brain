const assert = require('assert');
const { dealTypeToStage, dealTypeToVcStage, deriveStageFocus, PB_INDUSTRY_TO_DOMAIN } =
  require('../scripts/lib/deal_mapping');

// explicit series wins; bare rules; angel/accelerator → Seed
assert.strictEqual(dealTypeToVcStage('Early Stage VC (Series B)'), 'Series B');
assert.strictEqual(dealTypeToVcStage('Later Stage VC (Series B)'), 'Series B');
assert.strictEqual(dealTypeToVcStage('Angel (individual)'), 'Seed');
assert.strictEqual(dealTypeToVcStage('Accelerator/Incubator (Non-Equity)'), 'Seed');
assert.strictEqual(dealTypeToVcStage('Seed Round'), 'Seed');
assert.strictEqual(dealTypeToVcStage('PIPE'), 'Growth');
// stage-focus: ≥10% threshold, ladder order
const focus = deriveStageFocus([
  {deal_type:'Seed Round'},{deal_type:'Seed Round'},{deal_type:'Early Stage VC (Series A)'},
  {deal_type:'Later Stage VC (Series B)'},
]);
assert.deepStrictEqual(focus, ['Seed','Series A','Series B']);
// domain map is a non-empty object
assert.ok(Object.keys(PB_INDUSTRY_TO_DOMAIN).length > 0);
console.log('deal_mapping OK');
