'use strict';
/* Shared VC↔tech scoring rubric — the SINGLE source of truth used by BOTH the
 * browser (index.html) and the backend (scripts/generate_vc.js). Previously the
 * logic was duplicated and had drifted (catch-all industry case: flat 0.5 in the
 * backend vs max(fraction,0.5) in the browser). The browser behavior is canonical.
 * Classic script for the browser + module.exports for Node. */

// Tunable weights (must sum to 1.0). Change scoring emphasis HERE — one place.
const WEIGHTS = { industry: 0.375, stage: 0.30, checkSize: 0.225, geography: 0.10 };

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

// vc: { sectors[], stage[], checkSize:{min,max}, geographicFocus, focus }
// tech: { sectors[], stage }
function vcFitScore(vc, tech) {
  const focus = (vc.sectors && vc.sectors.length) ? vc.sectors : (vc.focus ? [vc.focus] : []);
  if (!focus.length) return null;  // curated entries carry no profile data to score

  const { matched, matchesAll } = mapFocusToDomains(focus);
  const techDomains = tech.sectors || [];

  let industryScore;
  if (matchesAll && matched.size === 0) industryScore = 0.3;
  else {
    const hits = techDomains.filter(d => matched.has(d)).length;
    industryScore = techDomains.length ? hits / techDomains.length : 0;
    if (matchesAll) industryScore = Math.max(industryScore, 0.5);
  }

  const stageOk = techStageScore(vc.stage || [], tech.stage);

  const g = (vc.geographicFocus || '').toLowerCase();
  const geo = (!g || g.includes('national')) ? 0.8
    : (g.includes('mid-atlantic') || g.includes('east coast')) ? 1.0
    : (g.includes('west coast') || g.includes('international')) ? 0.4 : 0.7;

  const maturity = DOMAIN_MATURITY[techDomains[0]] || 'mid';
  const min = vc.checkSize ? vc.checkSize.min : undefined;
  const max = vc.checkSize ? vc.checkSize.max : undefined;
  let checkSz = 0.4;
  if (maturity === 'early' && max <= 15) checkSz = 1;
  else if (maturity === 'mid' && min >= 1 && max <= 50) checkSz = 1;

  return {
    // Term order (industry, stage, geography, checkSize) and left-to-right addition
    // are float-identical to the pre-refactor literal 0.375i+0.30s+0.10g+0.225c.
    // Do NOT reorder — a "tidy-up" that sorts these could shift scores across a tier boundary.
    score: WEIGHTS.industry * industryScore + WEIGHTS.stage * stageOk + WEIGHTS.geography * geo + WEIGHTS.checkSize * checkSz,
    sharedDomains: techDomains.filter(d => matched.has(d)),
    stageOk: stageOk === 1,
  };
}

function fitTier(score) {
  if (score >= 0.80) return { label: 'Strong fit',   cls: 'strong' };
  if (score >= 0.60) return { label: 'Good fit',     cls: 'good' };
  return { label: 'Possible fit', cls: 'possible' };
}

if (typeof module !== 'undefined' && module.exports)
  module.exports = { WEIGHTS, INDUSTRY_TO_DOMAIN, DOMAIN_MATURITY, mapFocusToDomains, techStageScore, vcFitScore, fitTier };
