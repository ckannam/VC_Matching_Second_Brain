'use strict';
/* Shared VC↔tech scoring rubric — the SINGLE source of truth used by BOTH the
 * browser (index.html) and the backend (scripts/generate_vc.js).
 * Classic script for the browser + module.exports for Node.
 *
 * RUBRIC v2 (portfolio-led, July 2026 — boss-approved reframe):
 *   Fit = 0.55·Portfolio + 0.30·StageCheck + 0.15·Sector      (geography removed)
 * Portfolio = the VC's actual portfolio companies (data/vc_portfolios.json,
 * scraped from firm websites) scored against the tech by shared domain + stage
 * proximity — revealed behavior dominates stated preference.
 * Scores renormalize over available evidence; see vcFitScore's basis table. */

// Tunable weights (must sum to 1.0). Change scoring emphasis HERE — one place.
const WEIGHTS = { portfolio: 0.55, stageCheck: 0.30, sector: 0.15 };

// "About this many genuinely similar portfolio companies = full marks."
// Saturating count, NOT a fraction (a fraction would punish large diversified
// firms) and NOT a max (one lucky hit shouldn't score full). Tuned to 6 so a
// deep/pure-play portfolio earns Strong while a generalist with a small
// relevant arm lands Good/Possible (K=3 flattened the top firms into a tie).
const PORTFOLIO_K = 6;

// Firms scored on self-described sectors alone (no scraped portfolio) cannot
// earn "Strong fit" — revealed behavior beats stated preference. Caps the
// 'stated' basis at the top of the "Good" band (Strong is >= 0.80).
const STATED_MAX = 0.75;

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
  'lab tech':            ['Research Technologies'],
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

function mapFocusToDomains(focusStrings) {
  const matched = new Set();
  let matchesAll = false;
  for (const f of focusStrings) {
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

function techStageScore(vcStages, techStage) {
  if (!techStage) return 0.5;
  const techNorm = techStage.toLowerCase();
  const stageMap = {
    'seed':       ['pre-seed','newco','seed','pre-clinical','pre-product','concept','early','ind-enabling'],
    'series a':   ['seed','series a','pre-clinical','clinical','mvp','pilot','phase i','phase 1','phase ii','phase 2'],
    'series b':   ['series a','series b','clinical','commercial','revenue','phase ii','phase 2','phase iii','phase 3','fda'],
    'growth':     ['series b','series c','series d','growth','commercial','revenue','scale','fda-cleared'],
    'late stage': ['series b','series c','series d','growth','commercial','revenue','scale','public'],
  };
  for (const vs of vcStages) {
    const compatible = stageMap[vs.toLowerCase()] || [];
    if (compatible.some(s => techNorm.includes(s))) return 1;
  }
  return 0.2;
}

// ── Round ladder (portfolio stage proximity) ─────────────────────────
// 0 Pre-Seed · 1 Seed · 2 Series A · 3 Series B · 4 Series C · 5 Growth/Late

// Tech milestone string → ladder rung. Ordered rules: longer/more specific
// tokens first ("pre-clinical" before "clinical", "phase iii" before "phase i",
// "pre-seed" before "seed"). Unknown milestone → null (domain-only credit).
const TECH_STAGE_RUNGS = [
  ['pre-seed', 0],
  ['pre-clinical', 1], ['newco', 1], ['concept', 1], ['ind-enabling', 1],
  ['pre-product', 1], ['seed', 1],
  ['phase iii', 3], ['phase 3', 3], ['fda', 3],
  ['phase ii', 2], ['phase 2', 2], ['phase i', 2], ['phase 1', 2],
  ['clinical', 2], ['mvp', 2], ['pilot', 2],
  ['series a', 2], ['series b', 3], ['series c', 4], ['series d', 4],
  ['commercial', 5], ['revenue', 5], ['scale', 5], ['growth', 5], ['public', 5],
];
function techStageToRung(techStage) {
  if (!techStage) return null;
  const s = techStage.toLowerCase();
  for (const [token, rung] of TECH_STAGE_RUNGS) if (s.includes(token)) return rung;
  return null;
}

// Portfolio-company round string → ladder rung.
const COMPANY_STAGE_RUNGS = [
  ['pre-seed', 0], ['seed', 1],
  ['series a', 2], ['series b', 3], ['series c', 4],
  ['series d', 5], ['series e', 5], ['series f', 5],
  ['growth', 5], ['late', 5], ['ipo', 5], ['public', 5],
];
function companyStageToRung(stage) {
  if (!stage) return null;
  const s = String(stage).toLowerCase();
  for (const [token, rung] of COMPANY_STAGE_RUNGS) if (s.includes(token)) return rung;
  return null;
}

// The v2 core: score a VC's actual portfolio against a tech.
// companies: [{ name, domains: [], stage? }] from data/vc_portfolios.json.
// Per-company credit — shared domain + same rung 1.0 · adjacent rung 0.75 ·
// shared domain w/ unknown or distant stage 0.5 · no shared domain 0.
// Returns { score, hits } or null when there is no portfolio to judge.
function portfolioFit(companies, tech) {
  if (!companies || !companies.length) return null;
  const techDomains = tech.sectors || [];
  const techRung = techStageToRung(tech.stage);
  let credit = 0, hits = 0;
  for (const c of companies) {
    if (!(c.domains || []).some(d => techDomains.includes(d))) continue;
    let w = 0.5;
    const rung = companyStageToRung(c.stage);
    if (techRung !== null && rung !== null) {
      const dist = Math.abs(rung - techRung);
      if (dist === 0) w = 1.0;
      else if (dist === 1) w = 0.75;
    }
    credit += w;
    hits++;
  }
  return { score: Math.min(1, credit / PORTFOLIO_K), hits };
}

// Existing check-size heuristic, extracted (upgrade path: PitchBook round
// benchmarks slot in here behind an if-data-present guard).
function checkSizeScore(vc, techDomains) {
  const maturity = DOMAIN_MATURITY[techDomains[0]] || 'mid';
  const min = vc.checkSize ? vc.checkSize.min : undefined;
  const max = vc.checkSize ? vc.checkSize.max : undefined;
  if (maturity === 'early' && max <= 15) return 1;
  if (maturity === 'mid' && min >= 1 && max <= 50) return 1;
  return 0.4;
}

// vc:   { sectors[], stage[], checkSize:{min,max}, focus }   (stated profile)
// tech: { sectors[], stage }
// portfolioCompanies: optional [{ name, domains[], stage? }] for this VC.
//
// Evidence renormalization — scores whatever evidence exists:
//   stated + portfolio → 0.55·P + 0.30·SC + 0.15·Sec   (basis 'full')
//   portfolio only     → P                              (basis 'portfolio')
//   stated only        → (0.30·SC + 0.15·Sec) / 0.45    (basis 'stated')
//   neither            → null                           (contract unchanged)
function vcFitScore(vc, tech, portfolioCompanies) {
  const focus = (vc.sectors && vc.sectors.length) ? vc.sectors : (vc.focus ? [vc.focus] : []);
  const hasStated = focus.length > 0;
  const pf = portfolioFit(portfolioCompanies, tech);
  if (!hasStated && !pf) return null;

  const techDomains = tech.sectors || [];
  let sectorScore = 0, sharedDomains = [], stageCheck = 0, stageOk = false;
  if (hasStated) {
    const { matched, matchesAll } = mapFocusToDomains(focus);
    sharedDomains = techDomains.filter(d => matched.has(d));
    // Any shared domain = full sector credit — multi-domain techs are never
    // penalized (v1's hits/length fraction is gone). Catch-all-only = 0.5.
    sectorScore = sharedDomains.length ? 1.0 : (matchesAll ? 0.5 : 0);

    const stage = techStageScore(vc.stage || [], tech.stage);
    stageOk = stage === 1;
    stageCheck = 0.5 * stage + 0.5 * checkSizeScore(vc, techDomains);
  }

  let score, basis;
  if (hasStated && pf) {
    score = WEIGHTS.portfolio * pf.score + WEIGHTS.stageCheck * stageCheck + WEIGHTS.sector * sectorScore;
    basis = 'full';
  } else if (pf) {
    score = pf.score;
    basis = 'portfolio';
  } else {
    const rescaled = (WEIGHTS.stageCheck * stageCheck + WEIGHTS.sector * sectorScore) / (WEIGHTS.stageCheck + WEIGHTS.sector);
    score = Math.min(STATED_MAX, rescaled);  // no portfolio evidence → capped below Strong
    basis = 'stated';
  }

  return { score, sharedDomains, stageOk, basis, portfolioHits: pf ? pf.hits : 0 };
}

function fitTier(score) {
  if (score >= 0.80) return { label: 'Strong fit',   cls: 'strong' };
  if (score >= 0.60) return { label: 'Good fit',     cls: 'good' };
  return { label: 'Possible fit', cls: 'possible' };
}

if (typeof module !== 'undefined' && module.exports)
  module.exports = {
    WEIGHTS, PORTFOLIO_K, STATED_MAX, INDUSTRY_TO_DOMAIN, DOMAIN_MATURITY,
    mapFocusToDomains, techStageScore, techStageToRung, portfolioFit,
    checkSizeScore, vcFitScore, fitTier,
  };
