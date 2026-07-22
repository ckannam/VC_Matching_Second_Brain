'use strict';
/* v1 BASELINE SNAPSHOT (offline comparison artifact — does NOT touch live scoring).
 *
 *   node scripts/generate_v1_baseline.js        (or: npm run baseline-v1)
 *
 * The 12 curated VCs in the saved-brief section have `matchedTechs` that came from
 * their PDF one-pagers (separate human research), NOT from any rubric. This script
 * computes, for those 12 firms only, the top-4 techs they WOULD have matched under
 * the original v1 four-dimension rubric documented in JHTV_Second_Brain_Matching.docx:
 *
 *     Fit = 0.375·Industry + 0.30·Stage + 0.225·CheckSize + 0.10·Geography
 *
 * It is fully self-contained and embeds a FROZEN copy of the pre-taxonomy-upgrade
 * INDUSTRY_TO_DOMAIN table, so the baseline stays fixed even though the live
 * scoring.js has since replaced that table with the 324-keyword taxonomy. Output:
 * data/baseline_v1_matches.json — later diffed against the new-rubric + PitchBook run
 * to show how the rubric evolved. */

const fs   = require('fs');
const path = require('path');

const VCS   = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/vcs.json'), 'utf8'));
const TECHS = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/technologies.json'), 'utf8'));

const V1_WEIGHTS = { industry: 0.375, stage: 0.30, check: 0.225, geo: 0.10 };

// FROZEN snapshot of the original scoring.js INDUSTRY_TO_DOMAIN (8 domains). Do not
// "upgrade" this — the whole point is a fixed pre-taxonomy baseline.
const INDUSTRY_TO_DOMAIN = {
  'life sciences':       ['Therapeutics','Diagnostics','Digital Health','Medical Devices'],
  'life science':        ['Therapeutics','Diagnostics','Digital Health','Medical Devices'],
  'biotech':             ['Therapeutics','Diagnostics','Research Technologies'],
  'biotechnology':       ['Therapeutics','Diagnostics','Research Technologies'],
  'biopharma':           ['Therapeutics','Diagnostics'],
  'pharma':              ['Therapeutics'],
  'drug discovery':      ['Therapeutics','Research Technologies'],
  'therapeutics':        ['Therapeutics'],
  'diagnostics':         ['Diagnostics'],
  'digital health':      ['Digital Health'],
  'healthcare it':       ['Digital Health'],
  'health it':           ['Digital Health'],
  'healthtech':          ['Digital Health'],
  'health tech':         ['Digital Health'],
  'medtech':             ['Medical Devices'],
  'medical device':      ['Medical Devices'],
  'medical technology':  ['Medical Devices'],
  'surgical':            ['Medical Devices'],
  'oncology':            ['Diagnostics','Therapeutics'],
  'cancer':              ['Diagnostics','Therapeutics'],
  'neurology':           ['Medical Devices','Digital Health'],
  'neurotech':           ['Medical Devices','Digital Health'],
  'cardiovascular':      ['Medical Devices','Diagnostics'],
  'cardiology':          ['Medical Devices','Diagnostics'],
  'cleantech':           ['Clean Tech'],
  'clean tech':          ['Clean Tech'],
  'climate':             ['Clean Tech'],
  'sustainability':      ['Clean Tech'],
  'energy':              ['Clean Tech'],
  'agtech':              ['Agricultural Tech'],
  'agriculture':         ['Agricultural Tech'],
  'food tech':           ['Agricultural Tech'],
  'cybersecurity':       ['Cybersecurity'],
  'security':            ['Cybersecurity'],
  'infosec':             ['Cybersecurity'],
  'research tools':      ['Research Technologies','Diagnostics'],
  'research technologies':['Research Technologies'],
  'research technology': ['Research Technologies'],
  'lab tech':            ['Research Technologies'],
  'agricultural tech':   ['Agricultural Tech'],
  'agricultural technology':['Agricultural Tech'],
  'ai in healthcare':    ['Digital Health','Medical Devices'],
  'ai health':           ['Digital Health'],
  'deep tech':           null,
  'healthcare':          null,
  'health care':         null,
};

const DOMAIN_MATURITY = {
  'Therapeutics': 'early', 'Diagnostics': 'mid', 'Medical Devices': 'mid',
  'Digital Health': 'mid', 'Research Technologies': 'early', 'Clean Tech': 'early',
  'Agricultural Tech': 'early', 'Cybersecurity': 'mid',
};

// v1 focus → domains (flat set + broad-term flag).
function v1MapFocus(focusStrings) {
  const matched = new Set();
  let matchesAll = false;
  for (const f of focusStrings || []) {
    const fl = (f || '').toLowerCase();
    for (const [keyword, domains] of Object.entries(INDUSTRY_TO_DOMAIN)) {
      if (fl.includes(keyword)) {
        if (domains === null) matchesAll = true;
        else domains.forEach(d => matched.add(d));
      }
    }
  }
  return { matched, matchesAll };
}

// 1. Industry (37.5%): fraction of the tech's sectors the VC's domains cover;
//    broad-terms-only → flat 0.3.
function v1Industry(matched, matchesAll, techDomains) {
  const overlap = techDomains.filter(d => matched.has(d));
  if (overlap.length) return { score: overlap.length / techDomains.length, overlaps: overlap.length };
  if (matchesAll)     return { score: 0.3, overlaps: 0 };
  return { score: 0, overlaps: 0 };
}

// 2. Stage (30%): v1 ladder — compatible 1.0, incompatible 0.2, tech stage absent 0.5.
const V1_STAGE_MAP = {
  'seed':       ['newco','pre-seed','seed','pre-clinical','concept','early'],
  'series a':   ['seed','series a','mvp','pilot','phase i','phase 1','phase ii','phase 2'],
  'series b':   ['series a','series b','clinical','commercial','phase ii','phase 2','phase iii','phase 3','fda'],
  'growth':     ['series b','series c','series d','growth','commercial','revenue','scale','fda'],
  'late stage': ['series b','series c','series d','growth','commercial','revenue','scale','public'],
};
function v1Stage(vcStages, techStage) {
  if (!techStage) return 0.5;
  const t = techStage.toLowerCase();
  for (const vs of vcStages || []) {
    const compat = V1_STAGE_MAP[vs.toLowerCase()] || [];
    if (compat.some(s => t.includes(s))) return 1;
  }
  return 0.2;
}

// 3. Check size (22.5%): domain-maturity proxy on the tech's first domain.
function v1Check(vc, techDomains) {
  const maturity = DOMAIN_MATURITY[techDomains[0]] || 'mid';
  const min = vc.checkSize ? vc.checkSize.min : undefined;
  const max = vc.checkSize ? vc.checkSize.max : undefined;
  if (maturity === 'early' && max <= 15) return 1;
  if (maturity === 'mid' && min >= 1 && max <= 50) return 1;
  return 0.4;
}

// 4. Geography (10%): same for every tech — purely the VC's stated focus.
function v1Geo(vc) {
  const g = (vc.geographicFocus || '').toLowerCase();
  if (!g) return 0.7;
  if (g.includes('mid-atlantic') || g.includes('east coast')) return 1.0;
  if (g.includes('national')) return 0.8;
  if (g.includes('west') || g.includes('international')) return 0.4;
  return 0.7;
}

function v1Fit(vc, tech) {
  const focus = (vc.sectors && vc.sectors.length) ? vc.sectors : (vc.focus ? [vc.focus] : []);
  const { matched, matchesAll } = v1MapFocus(focus);
  const techDomains = tech.sectors || [];
  const ind = v1Industry(matched, matchesAll, techDomains);
  const stage = v1Stage(vc.stage || [], tech.stage);
  const check = v1Check(vc, techDomains);
  const geo = v1Geo(vc);
  const score = V1_WEIGHTS.industry * ind.score + V1_WEIGHTS.stage * stage
              + V1_WEIGHTS.check * check + V1_WEIGHTS.geo * geo;
  return { score, industry: ind.score, overlaps: ind.overlaps, stage, check, geo };
}

// Curated saved-brief VCs only: PDF one-pager firms whose matchedTechs came from
// research rather than a rubric.
const curated = VCS.filter(v => v.vcOnePager && v.provisional !== true);
const techById = Object.fromEntries(TECHS.map(t => [t.id, t]));

const out = curated.map(vc => {
  const ranked = TECHS
    .map(t => ({ t, f: v1Fit(vc, t) }))
    .sort((a, b) => b.f.score - a.f.score || b.f.overlaps - a.f.overlaps || a.t.name.localeCompare(b.t.name));
  const top4 = ranked.slice(0, 4);
  return {
    vcId: vc.id,
    name: vc.name,
    provisional: !!vc.provisional,
    v1TopTechs: top4.map(({ t, f }) => ({
      id: t.id,
      score: +f.score.toFixed(4),
      industry: +f.industry.toFixed(3),
      stage: +f.stage.toFixed(3),
      check: +f.check.toFixed(3),
      geo: +f.geo.toFixed(3),
    })),
    currentMatchedTechs: vc.matchedTechs || [],
  };
});

const outPath = path.join(__dirname, '../data/baseline_v1_matches.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

// Console table: v1 picks vs. the current PDF picks, with overlap count.
console.log(`\nv1 baseline for ${out.length} curated firms  (data/baseline_v1_matches.json)\n`);
const name = s => (s || '').slice(0, 26).padEnd(26);
for (const r of out) {
  const v1ids = r.v1TopTechs.map(x => x.id);
  const pdf = r.currentMatchedTechs;
  const shared = v1ids.filter(id => pdf.includes(id)).length;
  console.log(name(r.name), `overlap ${shared}/4`);
  console.log('   v1 :', v1ids.map(id => (techById[id] ? techById[id].name : id)).join(', '));
  console.log('   pdf:', pdf.map(id => (techById[id] ? techById[id].name : id)).join(', ') || '(none)');
}
console.log('');
