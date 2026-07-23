// convert_jhtv_investors.js
// Reads the "Venture Funding - Grouped By Investor" xlsx export and produces
// data/jhtv_investors.json — revealed co-investment history: firms that have
// actually written checks into JHTV/Hopkins companies, aggregated per investor.
//
// Usage: node scripts/convert_jhtv_investors.js [path-to-xlsx] [out-path]
// Requires: xlsx (already a dev dep in this repo)

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] ||
  path.join(__dirname, '../data/source/Venture_Funding_-_Grouped_By_Investor.xlsx');

// ── investor type classifier ────────────────────────────────────────────────
// LIVE categories: venture, angel.  DEFERRED (held for a later pass): foundation, public.
const PUBLIC = /\b(TEDCO|Maryland Venture Fund|Maryland Technology|BioHealth Innovation|Ben Franklin Technology|Economic Development|Department of|State of|NIST|NSF|NIH|NIDA|BioCrossroads|43North|VentureWell|i-Corps|Empire State|Development Authority|Development Corporation)\b/i;
const FOUND  = /\b(Foundation|Charitable|Trust|Endowment|Philanthrop)\b/i;
const ANGEL  = /\b(Angels?|Syndicate|Keiretsu|angelMD|Investor Network|Angel Investors)\b/i;

function classify(name) {
  if (PUBLIC.test(name)) return 'public';
  if (FOUND.test(name))  return 'foundation';
  if (ANGEL.test(name))  return 'angel';
  return 'venture';
}

function toISO(d) {
  if (typeof d !== 'string' || !d.includes('/')) return null;
  const [m, day, y] = d.split('/').map(Number);
  if (!y) return null;
  return `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

// ── read sheet ───────────────────────────────────────────────────────────────
const wb = XLSX.readFile(SRC);
const ws = wb.Sheets[wb.SheetNames[0]];
const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

// header row is the one containing 'Funding: ID'
const hdr = grid.findIndex(r => (r || []).some(c => c === 'Funding: ID'));
const C = {}; grid[hdr].forEach((label, i) => { if (label) C[label] = i; });
const col = {
  investor: C['Account: Account Name  ↑'],
  id:       C['Funding: ID'],
  company:  C['Funding: Receiving Account: Account Name'],
  amount:   C['Amount Awarded'],
  date:     C['Date Awarded'],
  bucket:   C['Funding: Round'],
  series:   C['Stage'],
};

const byInv = new Map();
let investor = null;
for (const r of grid.slice(hdr + 1)) {
  if (!r) continue;
  const name = r[col.investor];
  if (name && String(name).trim()) investor = String(name).trim();
  const company = r[col.company];
  if (!investor || company == null) continue;
  if (!byInv.has(investor)) byInv.set(investor, []);
  byInv.get(investor).push({
    company: String(company).trim(),
    amount:  typeof r[col.amount] === 'number' ? r[col.amount] : null,
    date:    toISO(r[col.date]),
    series:  (r[col.series] || '').toString().trim() || null,
    roundBucket: (r[col.bucket] || '').toString().trim() || null,
  });
}

// ── aggregate ─────────────────────────────────────────────────────────────────
const out = [];
for (const [inv, deals] of byInv) {
  const companies = [...new Set(deals.map(d => d.company))].sort();
  const dates = deals.map(d => d.date).filter(Boolean).sort();
  const total = deals.reduce((s, d) => s + (d.amount || 0), 0);
  out.push({
    investor: inv,
    type: classify(inv),
    companiesBacked: companies,
    companyCount: companies.length,
    dealCount: deals.length,
    totalInvested: total || null,
    firstDate: dates[0] || null,
    lastDate: dates[dates.length - 1] || null,
    deals: deals.sort((a, b) => (a.date || '').localeCompare(b.date || '')),
  });
}
// sort by revealed commitment: distinct JHTV companies backed, then deal count
out.sort((a, b) => b.companyCount - a.companyCount || b.dealCount - a.dealCount);

const meta = {
  generatedAt: new Date().toISOString(),
  source: path.basename(SRC),
  note: 'Revealed co-investment: firms that have funded JHTV/Hopkins companies. '
      + 'type=venture|angel are LIVE; type=foundation|public are DEFERRED (later pass).',
  counts: out.reduce((m, r) => (m[r.type] = (m[r.type]||0)+1, m), {}),
};
const doc = { meta, investors: out };

const dest = process.argv[3] || path.join(__dirname, '../data/jhtv_investors.json');
fs.writeFileSync(dest, JSON.stringify(doc, null, 2));
console.error('Wrote', dest);
console.error('Counts by type:', JSON.stringify(meta.counts));
console.error('LIVE (venture+angel):', (meta.counts.venture||0)+(meta.counts.angel||0),
              '| DEFERRED (foundation+public):', (meta.counts.foundation||0)+(meta.counts.public||0));
