#!/usr/bin/env node
// Ingest a PitchBook "Search Result Columns" investor export (CSV) into
// data/vc_pitchbook.json — a standalone catalog of investor data, kept SEPARATE
// from the curated data/vcs.json and NOT loaded by the live UI yet.
//
// This is pure cataloging: every column is preserved. Matching these firms to
// JHTV techs, reconciling overlap with vcs.json, and merging-at-load are all
// deferred (see CLAUDE.md Phase 3 + memory action items). The merge policy for
// that future phase: PitchBook wins on descriptive fields (focus/sectors/stage/
// checkSize/geographicFocus); matchedTechs + vcOnePager are JHTV-only and stay.
//
// Usage: node scripts/ingest_pitchbook.js [path-to-csv]
//   defaults to the most recent PitchBook_Search_Result_*.csv in repo root.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'vc_pitchbook.json');

// ── locate the CSV ──
function findCsv() {
  const arg = process.argv[2];
  if (arg) return path.resolve(arg);
  const hits = fs.readdirSync(ROOT)
    .filter(f => /^PitchBook_Search_Result.*\.csv$/i.test(f))
    .map(f => ({ f, m: fs.statSync(path.join(ROOT, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!hits.length) throw new Error('No PitchBook_Search_Result_*.csv found in ' + ROOT);
  return path.join(ROOT, hits[0].f);
}

// ── minimal RFC-4180 CSV parser (handles quotes, escaped quotes, CRLF) ──
function parseCSV(s) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c === '\r') { /* skip */ }
      else cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// ── field helpers ──
const clean = v => (v == null ? '' : String(v).trim());
const orNull = v => { const t = clean(v); return t === '' ? null : t; };
const splitList = v => clean(v).split(',').map(s => s.trim()).filter(Boolean);
const toNum = v => {
  const t = clean(v).replace(/,/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

function slugify(name) {
  return clean(name).toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'firm';
}

// PitchBook investment-type vocabulary → the tool's financing-stage vocabulary.
// Best-effort, lossless: the raw string is always preserved in
// preferredInvestmentTypes, so this mapping can be revisited when matching is
// turned on. Non-venture types (buyouts, debt, secondaries, IPO...) map to
// nothing — they don't describe a primary-round appetite.
const STAGE_ORDER = ['Pre-Seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Growth', 'Late Stage'];
const STAGE_MAP = {
  'Angel (individual)': ['Pre-Seed'],
  'Accelerator/Incubator': ['Pre-Seed'],
  'Seed Round': ['Seed'],
  'Restart - Early VC': ['Seed'],
  'Early Stage VC': ['Series A', 'Series B'],
  'Later Stage VC': ['Series C', 'Growth'],
  'Restart - Later VC': ['Growth'],
  'PE Growth/Expansion': ['Growth', 'Late Stage'],
};
function mapStages(types) {
  const set = new Set();
  types.forEach(t => (STAGE_MAP[t] || []).forEach(s => set.add(s)));
  return STAGE_ORDER.filter(s => set.has(s));
}

// Parse "0.05 - 3.00" ($M) → { min, max }. Returns null if unparseable/blank.
function parseAmount(v) {
  const t = clean(v);
  const m = t.match(/([\d.]+)\s*-\s*([\d.]+)/);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  const one = t.match(/^([\d.]+)$/);
  if (one) return { min: Number(one[1]), max: Number(one[1]) };
  return null;
}

// ── main ──
function main() {
  const csvPath = findCsv();
  const rows = parseCSV(fs.readFileSync(csvPath, 'utf8'));

  // header row is the one containing "Investor ID"
  const H = rows.findIndex(r => r.some(c => /Investor ID/i.test(c)));
  if (H < 0) throw new Error('Could not find header row (no "Investor ID" column) in ' + csvPath);
  const header = rows[H].map(clean);
  const col = name => header.indexOf(name);
  const idx = {
    pbId: col('Investor ID'), name: col('Investors'),
    lastCo: col('Last Investment Company'), types: col('Preferred Investment Types'),
    geo: col('Preferred Geography'), dealSize: col('Preferred Deal Size'),
    dryPowder: col('Dry Powder'), amount: col('Preferred Investment Amount'),
    verticals: col('Preferred Verticals'), pbIndustry: col('Preferred PitchBook Industry'),
    investments: col('Investments'), activePortfolio: col('Active Portfolio'),
    inv6m: col('Investments in the last 6 months'), inv12m: col('Investments in the last 12 months'),
    inv2y: col('Investments in the last 2 years'), inv5y: col('Investments in the last 5 years'),
    investorType: col('Primary Investor Type'), aum: col('AUM'),
    hq: col('HQ Location'), status: col('Investor Status'), desc: col('Description'),
  };

  const data = rows.slice(H + 1).filter(r => clean(r[idx.name]));

  const usedIds = new Set();
  const entries = data.map(r => {
    const name = clean(r[idx.name]);
    let id = slugify(name);
    if (usedIds.has(id)) id = id + '-' + clean(r[idx.pbId]);  // pbId is the true unique key
    usedIds.add(id);

    const verticals = splitList(r[idx.verticals]);
    const pbIndustries = splitList(r[idx.pbIndustry]);
    const types = splitList(r[idx.types]);
    const checkSize = parseAmount(r[idx.amount]);

    const entry = {
      id,
      pbId: clean(r[idx.pbId]),
      name,
      focus: clean(r[idx.desc]),
      // union kept for easy merge-at-load into vcs.json's `sectors`; the raw
      // vertical/industry lists are preserved separately for taxonomy work.
      sectors: [...new Set([...verticals, ...pbIndustries])],
      verticals,
      pbIndustries,
      stage: mapStages(types),                       // mapped (best-effort)
      preferredInvestmentTypes: types,               // raw (source of truth)
      geographicFocus: clean(r[idx.geo]),
      source: 'pitchbook',
      pitchbook: {
        aum: toNum(r[idx.aum]),
        hqLocation: clean(r[idx.hq]),
        primaryInvestorType: clean(r[idx.investorType]),
        investorStatus: clean(r[idx.status]),
        lastInvestmentCompany: orNull(r[idx.lastCo]),
        preferredInvestmentAmount: orNull(r[idx.amount]),
        preferredDealSize: orNull(r[idx.dealSize]),
        dryPowder: toNum(r[idx.dryPowder]),
        investments: toNum(r[idx.investments]),
        activePortfolio: toNum(r[idx.activePortfolio]),
        investmentsLast6m: toNum(r[idx.inv6m]),
        investmentsLast12m: toNum(r[idx.inv12m]),
        investmentsLast2y: toNum(r[idx.inv2y]),
        investmentsLast5y: toNum(r[idx.inv5y]),
      },
    };
    if (checkSize) entry.checkSize = checkSize;
    return entry;
  });

  fs.writeFileSync(OUT, JSON.stringify(entries, null, 2) + '\n');

  // summary
  const withAmount = entries.filter(e => e.checkSize).length;
  const withStage = entries.filter(e => e.stage.length).length;
  console.log(`Source: ${path.basename(csvPath)}`);
  console.log(`Wrote ${entries.length} investors → ${path.relative(ROOT, OUT)}`);
  console.log(`  with checkSize: ${withAmount}  with mapped stage: ${withStage}`);
}

main();
