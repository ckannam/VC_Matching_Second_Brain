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

// PitchBook deals export (recent slice, ~mid-2024 on). When present for a configured
// firm, we build a recent-deals portfolio and compute NEW-rubric (v2) matches from it.
const DEALS_PATH = path.join(__dirname, '../data/source/vc_deals.json');
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
// every other label is out-of-scope ([]) and, thanks to the saturating portfolio
// count, has no effect (so a firm's many software/fintech/aerospace deals are ignored).
const PB_INDUSTRY_TO_DOMAIN = {
  // Therapeutics
  'Biotechnology':                           ['Therapeutics'],
  'Pharmaceuticals':                         ['Therapeutics'],
  'Other Pharmaceuticals and Biotechnology': ['Therapeutics'],
  'Drug Delivery':                           ['Medical Devices', 'Therapeutics'],
  'Drug Discovery':                          ['Therapeutics', 'Research Technologies'],
  // Diagnostics
  'Diagnostic Equipment':                    ['Diagnostics', 'Medical Devices'],
  'Laboratory Services (Healthcare)':        ['Research Technologies', 'Diagnostics'],
  // Medical Devices
  'Therapeutic Devices':                     ['Medical Devices'],
  'Surgical Devices':                        ['Medical Devices'],
  'Other Devices and Supplies':              ['Medical Devices'],
  'Monitoring Equipment':                    ['Medical Devices', 'Digital Health'],
  // Research Technologies
  'Discovery Tools (Healthcare)':            ['Research Technologies'],
  // Digital Health
  'Clinics/Outpatient Services':             ['Digital Health'],
  'Enterprise Systems (Healthcare)':         ['Digital Health'],
  'Other Healthcare Technology Systems':     ['Digital Health'],
  'Other Healthcare Services':               ['Digital Health'],
  'Medical Records Systems':                 ['Digital Health'],
  'Elder and Disabled Care':                 ['Digital Health'],
  // Clean Tech
  'Alternative Energy Equipment':            ['Clean Tech'],
};

// PitchBook deal_type → round-ladder stage string for a PORTFOLIO company
// (companyStageToRung reads the token). The Series letter is the true round, whether
// PitchBook tagged it "Early Stage" or "Later Stage"; C+ collapses to the top rung.
function dealTypeToStage(dt) {
  const s = (dt || '').toLowerCase();
  const m = s.match(/series ([a-h])/);
  if (m) return 'Series ' + m[1].toUpperCase();
  if (s.includes('seed')) return 'Seed';
  if (s.includes('pe growth') || s.includes('buyout') || s.includes('lbo') || s.includes('pipe')) return 'Growth';
  if (s.includes('early stage')) return 'Series A';
  if (s.includes('later stage')) return 'Series C';
  return undefined; // secondary / joint venture / unknown → domain-only credit
}

// deal_type → a VC stage LABEL for techStageScore's vc.stage[] (keys: seed, series a,
// series b, growth, late stage). Series C+ and buyout/PIPE collapse to Growth.
function dealTypeToVcStage(dt) {
  const s = (dt || '').toLowerCase();
  if (s.includes('seed')) return 'Seed';
  const m = s.match(/series ([a-h])/);
  if (m) return m[1] === 'a' ? 'Series A' : m[1] === 'b' ? 'Series B' : 'Growth';
  if (s.includes('early stage')) return 'Series A';
  return 'Growth'; // later stage / pe / buyout / pipe
}

// A firm's stage FOCUS from its deals: VC stages that are ≥10% of its rounds (always at
// least the modal stage), in ladder order. Reflects where the firm actually writes checks.
function deriveStageFocus(rows) {
  const counts = {};
  for (const r of rows) { const st = dealTypeToVcStage(r.deal_type); if (st) counts[st] = (counts[st] || 0) + 1; }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  let focus = Object.keys(counts).filter(k => counts[k] / total >= 0.10);
  if (!focus.length) { const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]; if (top) focus = [top[0]]; }
  return ['Seed', 'Series A', 'Series B', 'Growth', 'Late Stage'].filter(s => focus.includes(s));
}

// Map each deals-firm string to a curated vcId. Firms in the deals export but with a
// stage-% read off the one-pager get an explicit stageFocus override (2048).
const DEALS_FIRM_TO_VCID = {
  '2048 Ventures': '2048-ventures', '8VC': '8vc', 'Amplify Partners': 'amplify-partners',
  'Dimension': 'dimension', 'Felicis': 'felicis', 'Frazier Life Sciences': 'frazier-life-sciences',
  'Fusion Fund': 'fusion-fund', 'Hanabi Capital Management': 'hanabi-capital', 'Lux Capital': 'lux-capital',
};
const STAGE_FOCUS_OVERRIDE = {
  '2048-ventures': { stageFocus: ['Pre-Seed', 'Seed', 'Series A'], note: 'Seed/Early 95% · Series A 5% (one-pager)' },
};

// vcId → { dealsFirm, stageFocus, stageNote }, built from whatever firms the export has.
const V2_FIRM_CONFIG = {};
for (const [dealsFirm, vcId] of Object.entries(DEALS_FIRM_TO_VCID)) {
  const rows = DEALS.filter(r => r.firm === dealsFirm);
  if (!rows.length) continue;
  const ov = STAGE_FOCUS_OVERRIDE[vcId];
  V2_FIRM_CONFIG[vcId] = {
    dealsFirm,
    stageFocus: ov ? ov.stageFocus : deriveStageFocus(rows),
    stageNote: ov ? ov.note : 'derived from deal history',
  };
}

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
    // Tie-break by actual portfolio overlap (portfolioHits) before domain count and
    // name, so the surfaced picks are the most deal-supported among equal scores.
    .sort((a, b) => b.f.score - a.f.score || b.f.portfolioHits - a.f.portfolioHits
                 || b.f.sharedDomains.length - a.f.sharedDomains.length
                 || a.t.name.localeCompare(b.t.name));
  // Broad multi-domain funds saturate the score ceiling — many techs tie at the top and
  // the top-4 is then decided by tie-break. Record the tie count so that's transparent.
  const topScore = ranked.length ? ranked[0].f.score : 0;
  const topScoreTies = ranked.filter(x => Math.abs(x.f.score - topScore) < 1e-9).length;
  return {
    source: `${cfg.dealsFirm} recent deals (${inScope} JHTV-relevant of ${total}) + stage focus ${cfg.stageNote}`,
    stageFocus: cfg.stageFocus,
    portfolioCompanies: inScope,
    topScoreTies,
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
  const v2 = r.newRubricMatches;
  console.log(nm(r.name), v2 ? `[v2: ${v2.portfolioCompanies} JHTV deals, ${v2.topScoreTies} tied at top]` : '[v2: no deals data]');
  console.log('   old v1:', names(r.oldRubricMatches.map(x => x.id)));
  if (v2)
    console.log('   new v2:', v2.techs.map(x => `${x.name} (${x.score}, ${x.tier})`).join(', '));
}
console.log('');
