// scripts/merge_backer_deals.js
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '../data/source/vc_deals.json');
const BYFIRM = path.join(__dirname, '../vc json deal histories/by_firm');
const CURATED = new Set(['2048 Ventures','8VC','Amplify Partners','Dimension','Emergence Capital',
  'Felicis','Frazier Life Sciences','Fusion Fund','Hanabi Capital Management','Lux Capital','Mayfield','NEA']);
const existing = JSON.parse(fs.readFileSync(SRC,'utf8'));
const have = new Set(existing.map(d => d.firm));
let added = 0;
for (const f of fs.readdirSync(BYFIRM)) {
  if (!f.endsWith('.json') || f === 'deals.json') continue;
  const rows = JSON.parse(fs.readFileSync(path.join(BYFIRM,f),'utf8'));
  const firm = rows[0].firm;
  if (CURATED.has(firm) || have.has(firm)) continue;   // idempotent
  existing.push(...rows); have.add(firm); added += rows.length;
}
existing.sort((a,b) => (a.firm.localeCompare(b.firm)) || (b.deal_date.localeCompare(a.deal_date)));
fs.writeFileSync(SRC, JSON.stringify(existing, null, 2));
console.log(`merged: +${added} deals, ${new Set(existing.map(d=>d.firm)).size} firms total`);
