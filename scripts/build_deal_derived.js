// scripts/build_deal_derived.js
// Derives portfolio / stage-focus / last-10 deals from data/source/vc_deals.json.
// Preserves hand-classified vc_portfolios.json entries (sourceUrl !== 'pitchbook-deals').
// Regenerates all 'pitchbook-deals' entries on each run (idempotent).
// Writes: data/vc_portfolios.json, data/vcs.json, data/vc_recent_deals.json

const fs = require('fs'), path = require('path');
const { PB_INDUSTRY_TO_DOMAIN, dealTypeToStage, deriveStageFocus } = require('./lib/deal_mapping');
const MAP = require('./lib/deals_firm_to_vcid');

/**
 * Derive portfolio, recent-deals, and stageFocus for one firm.
 * @param {string} vcId
 * @param {Array} rows  — deal rows for this firm
 * @returns {{ portfolio, recent, stageFocus }}
 */
function deriveFirm(vcId, rows) {
  const sorted = [...rows].sort((a, b) => b.deal_date.localeCompare(a.deal_date));
  const companies = rows.map(r => {
    const domains = PB_INDUSTRY_TO_DOMAIN[r.industry] || [];
    const stage = dealTypeToStage(r.deal_type);
    const c = { name: r.company, domains };
    if (stage) c.stage = stage;
    return c;
  });
  const recent = {
    dealCount: rows.length,
    deals: sorted.slice(0, 10).map(r => ({
      date: r.deal_date,
      company: r.company,
      sector: (PB_INDUSTRY_TO_DOMAIN[r.industry] && PB_INDUSTRY_TO_DOMAIN[r.industry].length > 0)
        ? PB_INDUSTRY_TO_DOMAIN[r.industry].join(', ')
        : r.industry,
      round: dealTypeToStage(r.deal_type) || r.deal_type,
      sizeMusd: r.deal_size_musd != null ? r.deal_size_musd : null,
    })),
  };
  return {
    portfolio: {
      vcId,
      sourceUrl: 'pitchbook-deals',
      scrapedAt: new Date().toISOString().slice(0, 10),
      note: 'derived from PitchBook deal history',
      companies,
    },
    recent,
    stageFocus: deriveStageFocus(rows),
  };
}

function main() {
  const deals = require('../data/source/vc_deals.json');
  const portfolios = require('../data/vc_portfolios.json');
  const vcs = require('../data/vcs.json');

  // Partition: keep hand-classified (sourceUrl !== 'pitchbook-deals'), drop previously derived
  const handClassified = portfolios.filter(p => p.sourceUrl !== 'pitchbook-deals');
  const handClassifiedIds = new Set(handClassified.map(p => p.vcId));

  // Group deals by firm
  const byFirm = {};
  deals.forEach(d => (byFirm[d.firm] = byFirm[d.firm] || []).push(d));

  const recentDeals = {};
  const derivedPortfolios = [];

  for (const [firm, rows] of Object.entries(byFirm)) {
    const vcId = MAP[firm];
    if (!vcId) continue;

    const { portfolio, recent, stageFocus } = deriveFirm(vcId, rows);

    // Always rebuild recent-deals for all 58 deal firms
    recentDeals[vcId] = recent;

    // Only add portfolio entry for firms NOT in hand-classified set
    if (!handClassifiedIds.has(vcId)) {
      derivedPortfolios.push(portfolio);
    }

    // For DERIVED firms: set stage unconditionally from deal data
    // For HAND-CLASSIFIED firms: leave stage untouched
    if (!handClassifiedIds.has(vcId)) {
      const vc = vcs.find(v => v.id === vcId);
      if (vc) vc.stage = stageFocus;
    }
  }

  // Net result: hand-classified first, then freshly derived
  const finalPortfolios = [...handClassified, ...derivedPortfolios];

  fs.writeFileSync(
    path.join(__dirname, '../data/vc_portfolios.json'),
    JSON.stringify(finalPortfolios, null, 2)
  );
  fs.writeFileSync(
    path.join(__dirname, '../data/vcs.json'),
    JSON.stringify(vcs, null, 2)
  );
  fs.writeFileSync(
    path.join(__dirname, '../data/vc_recent_deals.json'),
    JSON.stringify(recentDeals, null, 2)
  );

  console.log(
    `derived ${derivedPortfolios.length} portfolios from deal data (${Object.keys(recentDeals).length} firms' recent-deals); portfolios total ${finalPortfolios.length}`
  );
}

if (require.main === module) main();
module.exports = { deriveFirm };
