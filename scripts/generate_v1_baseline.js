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
const { vcFitScore, fitTier } = require('../scoring.js');   // live v2 rubric (unchanged)

const VCS   = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/vcs.json'), 'utf8'));
const TECHS = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/technologies.json'), 'utf8'));

// Optional PitchBook deals export (last ~3 yr). When present for a configured firm,
// we build a recent-deals portfolio and compute NEW-rubric (v2) matches from it.
const DEALS_PATH = '/Users/colekannam/Downloads/deals.json';
const DEALS = fs.existsSync(DEALS_PATH) ? JSON.parse(fs.readFileSync(DEALS_PATH, 'utf8')) : [];

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

// ── NEW rubric (v2) from PitchBook recent-deals portfolios ────────────────────
//
// The v2 portfolio component wants companies as { name, domains[], stage }. We build
// that from the deals export by classifying each deal's PitchBook `industry` label to
// JHTV domains and its `deal_type` to a round-ladder stage. Non-JHTV industries map to
// [] (out of scope — the saturating count ignores them, so 2048's many software deals
// have no effect, correctly). The VC's stated stage[] is overridden with the stage-%
// focus read off its one-pager; sectors/checkSize come from vcs.json.

// PitchBook industry label → JHTV display domains (label-based, reproducible — not
// second-guessed from company descriptions). Only JHTV-relevant labels are listed;
// everything else is treated as out-of-scope ([]).
const PB_INDUSTRY_TO_DOMAIN = {
  'Biotechnology':                        ['Therapeutics'],
  'Other Pharmaceuticals and Biotechnology': ['Therapeutics'],
  'Drug Delivery':                        ['Medical Devices', 'Therapeutics'],
  'Drug Discovery':                       ['Research Technologies', 'Therapeutics'],
  'Diagnostic Equipment':                 ['Diagnostics', 'Medical Devices'],
  'Discovery Tools (Healthcare)':         ['Research Technologies'],
  'Enterprise Systems (Healthcare)':      ['Digital Health'],
  'Other Healthcare Technology Systems':  ['Digital Health'],
  'Clinics/Outpatient Services':          ['Digital Health'],
  'Other Healthcare Services':            ['Digital Health'],
};

// PitchBook deal_type → round-ladder stage string (companyStageToRung reads the token).
function dealTypeToStage(dt) {
  const s = (dt || '').toLowerCase();
  if (s.includes('series a') || s.includes('early stage') || s.includes('later stage')) return 'Series A';
  if (s.includes('series b')) return 'Series B';
  if (s.includes('seed')) return 'Seed';
  if (s.includes('pre-seed')) return 'Pre-Seed';
  return undefined;
}

// Firms we have deals + a stage-% focus for. stageFocus is read off the one-pager.
const V2_FIRM_CONFIG = {
  '2048-ventures': {
    dealsFirm: '2048 Ventures',
    stageFocus: ['Pre-Seed', 'Seed', 'Series A'], // one-pager: Seed/Early 95% · Series A 5%
    stageNote: 'Seed/Early 95% · Series A 5% (one-pager)',
  },
};

function buildDealsPortfolio(dealsFirm) {
  const rows = DEALS.filter(r => r.firm === dealsFirm);
  const companies = rows.map(r => ({
    name: r.company,
    domains: PB_INDUSTRY_TO_DOMAIN[r.industry] || [],
    stage: dealTypeToStage(r.deal_type),
  }));
  const inScope = companies.filter(c => c.domains.length);
  return { companies, total: rows.length, inScope: inScope.length };
}

function computeV2(vc, cfg) {
  const { companies, total, inScope } = buildDealsPortfolio(cfg.dealsFirm);
  const scoreVc = { sectors: vc.sectors, stage: cfg.stageFocus, checkSize: vc.checkSize, focus: vc.focus };
  const ranked = TECHS
    .map(t => {
      const f = vcFitScore(scoreVc, t, companies);
      return f ? { t, f } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.f.score - a.f.score || b.f.sharedDomains.length - a.f.sharedDomains.length
                 || a.t.name.localeCompare(b.t.name));
  return {
    source: `${cfg.dealsFirm} last-3yr deals (${inScope} JHTV-relevant of ${total}) + stage focus ${cfg.stageNote}`,
    stageFocus: cfg.stageFocus,
    portfolioCompanies: inScope,
    techs: ranked.slice(0, 4).map(({ t, f }) => ({
      id: t.id,
      name: t.name,
      score: +f.score.toFixed(4),
      tier: fitTier(f.score).label,
      basis: f.basis,
      portfolioHits: f.portfolioHits,
      sharedDomains: f.sharedDomains,
    })),
  };
}

// ── Build the doc: old rubric (v1) vs new rubric (v2) per curated saved-brief firm ──
const curated = VCS.filter(v => v.vcOnePager && v.provisional !== true);
const techById = Object.fromEntries(TECHS.map(t => [t.id, t]));

const out = curated.map(vc => {
  const ranked = TECHS
    .map(t => ({ t, f: v1Fit(vc, t) }))
    .sort((a, b) => b.f.score - a.f.score || b.f.overlaps - a.f.overlaps || a.t.name.localeCompare(b.t.name));
  const oldRubricMatches = ranked.slice(0, 4).map(({ t, f }) => ({
    id: t.id,
    name: t.name,
    score: +f.score.toFixed(4),
    industry: +f.industry.toFixed(3),
    stage: +f.stage.toFixed(3),
    check: +f.check.toFixed(3),
    geo: +f.geo.toFixed(3),
  }));

  const cfg = V2_FIRM_CONFIG[vc.id];
  const newRubricMatches = cfg ? computeV2(vc, cfg) : null;

  return { vcId: vc.id, name: vc.name, provisional: !!vc.provisional, oldRubricMatches, newRubricMatches };
});

const outPath = path.join(__dirname, '../data/baseline_v1_matches.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

// Console: old (v1) vs new (v2) picks per firm; v2 only where deals+stage data exists.
console.log(`\nold-rubric (v1) vs new-rubric (v2) for ${out.length} curated firms  (data/baseline_v1_matches.json)\n`);
const nm = s => (s || '').slice(0, 26).padEnd(26);
const names = ids => ids.map(id => (techById[id] ? techById[id].name : id)).join(', ');
for (const r of out) {
  console.log(nm(r.name), r.newRubricMatches ? `[v2: ${r.newRubricMatches.portfolioCompanies} deals]` : '[v2: no deals data]');
  console.log('   old v1:', names(r.oldRubricMatches.map(x => x.id)));
  if (r.newRubricMatches)
    console.log('   new v2:', r.newRubricMatches.techs.map(x => `${x.name} (${x.score}, ${x.tier})`).join(', '));
}
console.log('');
