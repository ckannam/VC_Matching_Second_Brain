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

// Saturation constant for the smooth portfolio curve `1 - exp(-credit/K)`, which
// replaces the old hard `min(1, credit/K)` clamp that pinned deep portfolios to a
// flat 1.0 (e.g. 2048 had 21 techs tied at 1.0). Lower K = "Strong" reached with
// less depth and more spread at the top. Tuned to 3 so 2048's mid-depth cluster
// (credit ~8.5) lands ~0.94 while its deepest (credit ~14) reaches ~0.99.
const PORTFOLIO_K = 3;

// Firms scored on self-described sectors alone (no scraped portfolio) cannot
// earn "Strong fit" — revealed behavior beats stated preference. Caps the
// 'stated' basis at the top of the "Good" band (Strong is >= 0.80).
const STATED_MAX = 0.75;

// Sector step's keyword dictionary now comes from the 324-keyword venture taxonomy
// (taxonomy.js). Dual-mode load, mirroring this module's own export guard: Node
// requires the sibling module; the browser reads the globals taxonomy.js declared
// first via <script defer>. A distinct local name (TAX) avoids re-declaring those
// top-level consts in the shared classic-script global scope.
const TAX = (typeof module !== 'undefined' && module.exports)
  ? require('./taxonomy.js')
  : { VC_KEYWORD_TAXONOMY, BUCKET_TO_DOMAIN, CYBER_KEYWORDS, DOMAIN_SELF_MAP, CATCH_ALL };

// Taxonomy keys longest-first — lets phrase-priority drop broad component words
// ("ai" when "ai in healthcare" also matched) before scoring.
const TAX_KEYS_BY_LEN = Object.keys(TAX.VC_KEYWORD_TAXONOMY).sort((a, b) => b.length - a.length);

const DOMAIN_MATURITY = {
  'Therapeutics': 'early', 'Diagnostics': 'mid', 'Medical Devices': 'mid',
  'Digital Health': 'mid', 'Research Technologies': 'early', 'Clean Tech': 'early',
  'Agricultural Tech': 'early', 'Cybersecurity': 'mid',
};

// Normalize a focus string for keyword matching (taxonomy rule 7: lowercase, split
// separators, strip punctuation, collapse whitespace). Hyphens/digits/& kept —
// taxonomy keys include "car-t", "3d printing", "b2b software".
function normalizeFocus(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[\/,|]/g, ' ')
    .replace(/[^a-z0-9&\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Whole-phrase membership: a keyword matches only on token boundaries, so short
// keys like "ai" don't hit inside "supply chain". Space-padding both sides makes
// the check exact for multi-word phrases too ("ai in healthcare").
function hasPhrase(fl, keyword) {
  return (' ' + fl + ' ').includes(' ' + keyword + ' ');
}

// VC focus strings → JHTV display domains, split into primary vs. secondary evidence.
// Returns { primary:Set, secondary:Set, matchesAll:bool }. Buckets that crosswalk to
// null (Robotics/AI/Software, Industrial, Aerospace) contribute nothing here.
function mapFocusToDomains(focusStrings) {
  const primary = new Set();
  const secondary = new Set();
  let matchesAll = false;

  const addBucket = (bucket, set) => {
    const d = TAX.BUCKET_TO_DOMAIN[bucket];
    if (d) set.add(d);
  };

  for (const raw of focusStrings) {
    const fl = normalizeFocus(raw);
    if (!fl) continue;

    // 1. Exact JHTV domain names round-trip to themselves (primary evidence).
    for (const [name, domain] of Object.entries(TAX.DOMAIN_SELF_MAP))
      if (hasPhrase(fl, name)) primary.add(domain);

    // 2. Cyber overlay — the taxonomy folded Cybersecurity into Robotics/AI/Software,
    //    but JHTV keeps it as a real domain with tagged techs.
    if (TAX.CYBER_KEYWORDS.some(k => hasPhrase(fl, k))) primary.add('Cybersecurity');

    // 3. Taxonomy keywords, phrase-priority: keep the most specific matches only
    //    (drop a keyword that is a substring of another matched keyword).
    const hits = TAX_KEYS_BY_LEN.filter(k => hasPhrase(fl, k));
    const specific = hits.filter(k => !hits.some(o => o !== k && o.includes(k)));
    for (const k of specific) {
      const entry = TAX.VC_KEYWORD_TAXONOMY[k];
      addBucket(entry.primary, primary);
      for (const sb of entry.secondary) addBucket(sb, secondary);
    }

    // 4. Broad catch-alls — eligible but unspecific.
    if (TAX.CATCH_ALL.some(k => hasPhrase(fl, k))) matchesAll = true;
  }

  // A domain proven primary shouldn't also count as weaker secondary evidence.
  for (const d of primary) secondary.delete(d);
  return { primary, secondary, matchesAll };
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
  // Smooth, monotonic-in-depth saturation: more/closer matching portfolio companies
  // always yield a higher score, asymptotically approaching (never clamping at) 1.0.
  // `depth` (uncapped credit) drives the tiebreak in the ranking layer.
  return { score: 1 - Math.exp(-credit / PORTFOLIO_K), depth: credit, hits };
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
    const { primary, secondary, matchesAll } = mapFocusToDomains(focus);
    const sharedPrimary   = techDomains.filter(d => primary.has(d));
    const sharedSecondary = techDomains.filter(d => secondary.has(d));
    sharedDomains = [...new Set([...sharedPrimary, ...sharedSecondary])];
    // Primary-bucket overlap = full sector credit; secondary-only = half; catch-all
    // only = 0.5. Multi-domain techs are never penalized (v1's hits/length is gone).
    sectorScore = sharedPrimary.length ? 1.0
                : sharedSecondary.length ? 0.5
                : (matchesAll ? 0.5 : 0);

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

  return { score, sharedDomains, stageOk, basis, portfolioHits: pf ? pf.hits : 0, depth: pf ? pf.depth : 0 };
}

// Given items ranked best-first (each { score, tieKey }), return up to `max`, extending
// past `base` only while consecutive items are indistinguishable (|Δscore|<eps AND
// |ΔtieKey|<eps). When extended, the trailing mutually-indistinguishable cluster is
// flagged `tied:true` so the UI can label it "equally strong"; otherwise all `tied:false`.
function selectWithTies(ranked, { base = 4, max = 6, eps = 0.005 } = {}) {
  const n = ranked.length;
  const close = (a, b) => Math.abs(a.score - b.score) < eps && Math.abs((a.tieKey || 0) - (b.tieKey || 0)) < eps;
  if (n <= base) return ranked.map(x => ({ ...x, tied: false }));
  if (!close(ranked[base - 1], ranked[base])) return ranked.slice(0, base).map(x => ({ ...x, tied: false }));
  let end = base;
  while (end < Math.min(max, n) && close(ranked[end - 1], ranked[end])) end++;
  let clusterStart = base - 1;
  while (clusterStart > 0 && close(ranked[clusterStart - 1], ranked[base - 1])) clusterStart--;
  return ranked.slice(0, end).map((x, i) => ({ ...x, tied: i >= clusterStart }));
}

function fitTier(score) {
  if (score >= 0.80) return { label: 'Strong fit',   cls: 'strong' };
  if (score >= 0.60) return { label: 'Good fit',     cls: 'good' };
  return { label: 'Possible fit', cls: 'possible' };
}

// ── v1 rubric (live, tunable copy — see scripts/generate_v1_baseline.js for the FROZEN copy) ──
// Ported verbatim from generate_v1_baseline.js so scoring.js can dispatch to v1 for
// firms without portfolio data. Do NOT DRY these into a shared module — the baseline
// script's copy is intentionally frozen for offline comparison artifact stability.

// Reweighted 2026-08-03: geography + check-size (both weak/proxy signals) removed and
// redistributed to Sector + Stage. Sector dominant (0.60) so off-domain firms fall below
// the 0.45 floor; stage (0.40) is the refinement. (Live copy only; baseline stays frozen.)
const V1_WEIGHTS = { industry: 0.60, stage: 0.40 };

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
function v1Fit(vc, tech) {
  const focus = (vc.sectors && vc.sectors.length) ? vc.sectors : (vc.focus ? [vc.focus] : []);
  const { matched, matchesAll } = v1MapFocus(focus);
  const techDomains = tech.sectors || [];
  const ind = v1Industry(matched, matchesAll, techDomains);
  const stage = v1Stage(vc.stage || [], tech.stage);
  const score = V1_WEIGHTS.industry * ind.score + V1_WEIGHTS.stage * stage;
  return { score, industry: ind.score, overlaps: ind.overlaps, stage };
}

function vcFitScoreV1(vc, tech) {
  const f = v1Fit(vc, tech);
  return { score: f.score, industry: f.industry, stage: f.stage, basis: 'v1' };
}

// Single dispatch point: deal-data firms (portfolio present) → v2, else → v1.
function scoreVC(vc, tech, portfolioCompanies) {
  if (Array.isArray(portfolioCompanies) && portfolioCompanies.length)
    return vcFitScore(vc, tech, portfolioCompanies);
  return vcFitScoreV1(vc, tech);
}

if (typeof module !== 'undefined' && module.exports)
  module.exports = {
    WEIGHTS, PORTFOLIO_K, STATED_MAX, DOMAIN_MATURITY,
    mapFocusToDomains, normalizeFocus, techStageScore, techStageToRung, portfolioFit,
    checkSizeScore, vcFitScore, fitTier, selectWithTies,
    vcFitScoreV1, scoreVC,
  };
