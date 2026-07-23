'use strict';
/* Per-VC, per-JHTV-domain recency weight from PitchBook deal dates. Ordering-only
 * signal for the matching tiebreak (recent activity in a tech's domain → higher).
 *   node scripts/build_vc_recency.js      (or: npm run build-vc-recency)
 * Source: data/source/vc_deals.json. Regenerate after refreshing that export. */
const fs = require('fs');
const path = require('path');

const DEALS = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/source/vc_deals.json'), 'utf8'));

// Mirror of scripts/generate_v1_baseline.js (PitchBook industry label → JHTV domains).
const PB_INDUSTRY_TO_DOMAIN = {
  'Biotechnology': ['Therapeutics'], 'Pharmaceuticals': ['Therapeutics'],
  'Other Pharmaceuticals and Biotechnology': ['Therapeutics'],
  'Drug Delivery': ['Medical Devices', 'Therapeutics'], 'Drug Discovery': ['Therapeutics', 'Research Technologies'],
  'Diagnostic Equipment': ['Diagnostics', 'Medical Devices'], 'Laboratory Services (Healthcare)': ['Research Technologies', 'Diagnostics'],
  'Therapeutic Devices': ['Medical Devices'], 'Surgical Devices': ['Medical Devices'], 'Other Devices and Supplies': ['Medical Devices'],
  'Monitoring Equipment': ['Medical Devices', 'Digital Health'], 'Discovery Tools (Healthcare)': ['Research Technologies'],
  'Clinics/Outpatient Services': ['Digital Health'], 'Enterprise Systems (Healthcare)': ['Digital Health'],
  'Other Healthcare Technology Systems': ['Digital Health'], 'Other Healthcare Services': ['Digital Health'],
  'Medical Records Systems': ['Digital Health'], 'Elder and Disabled Care': ['Digital Health'],
  'Alternative Energy Equipment': ['Clean Tech'],
};
const DEALS_FIRM_TO_VCID = {
  '2048 Ventures': '2048-ventures', '8VC': '8vc', 'Amplify Partners': 'amplify-partners', 'Dimension': 'dimension',
  'Felicis': 'felicis', 'Frazier Life Sciences': 'frazier-life-sciences', 'Fusion Fund': 'fusion-fund',
  'Hanabi Capital Management': 'hanabi-capital', 'Lux Capital': 'lux-capital', 'Mayfield': 'mayfield',
  'NEA': 'nea', 'Emergence Capital': 'emergence-capital',
};

// Deterministic "now" = latest deal date in the dataset. Linear decay to a 0.5 floor over 6 yr.
const NOW = DEALS.map(d => d.deal_date).filter(Boolean).sort().pop();
const MS_YR = 365.25 * 24 * 3600 * 1000;
const FLOOR = 0.5;
function weightForAge(dateISO) {
  const age = (Date.parse(NOW) - Date.parse(dateISO)) / MS_YR;
  return Math.max(FLOOR, Math.min(1, 1 - (age / 6) * (1 - FLOOR)));
}

const byVc = {};
for (const [firm, vcId] of Object.entries(DEALS_FIRM_TO_VCID)) {
  const rows = DEALS.filter(r => r.firm === firm && r.deal_date);
  const mostRecent = {}; // domain → newest ISO date
  for (const r of rows) {
    for (const dom of PB_INDUSTRY_TO_DOMAIN[r.industry] || []) {
      if (!mostRecent[dom] || r.deal_date > mostRecent[dom]) mostRecent[dom] = r.deal_date;
    }
  }
  const domains = {};
  for (const [dom, date] of Object.entries(mostRecent)) domains[dom] = +weightForAge(date).toFixed(3);
  if (Object.keys(domains).length) byVc[vcId] = domains;
}

const doc = {
  generatedAt: new Date().toISOString(),
  note: 'Per-VC per-JHTV-domain recency weight (0.5..1.0) from vc_deals.json dates. Tiebreak-only.',
  byVc,
};
fs.writeFileSync(path.join(__dirname, '../data/vc_recency.json'), JSON.stringify(doc, null, 2));
console.error('Wrote data/vc_recency.json for', Object.keys(byVc).length, 'firms (now =', NOW + ')');
