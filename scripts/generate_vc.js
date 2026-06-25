#!/usr/bin/env node
/**
 * JHTV Second Brain — VC Profile Generator
 *
 * CLI usage:  ANTHROPIC_API_KEY=sk-... node scripts/generate_vc.js "Lux Capital"
 *
 * Also imported by server.js — researchVC() and buildEntry() are exported
 * for use in the background-job research endpoint.
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk');

// ── Industry → JHTV domain mapping ───────────────────────────────────────────

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
  'Therapeutics':          'early',
  'Diagnostics':           'mid',
  'Medical Devices':       'mid',
  'Digital Health':        'mid',
  'Research Technologies': 'early',
  'Clean Tech':            'early',
  'Agricultural Tech':     'early',
  'Cybersecurity':         'mid',
};

// ── Scoring ───────────────────────────────────────────────────────────────────

function mapFocusTodomains(focusStrings) {
  const matched = new Set();
  let matchesAll = false;
  for (const f of focusStrings) {
    const fl = f.toLowerCase();
    for (const [keyword, domains] of Object.entries(INDUSTRY_TO_DOMAIN)) {
      if (fl.includes(keyword)) {
        if (domains === null) { matchesAll = true; }
        else { domains.forEach(d => matched.add(d)); }
      }
    }
  }
  return { matched, matchesAll };
}

function stageScore(vcStages, techStage) {
  if (!techStage) return 0.5;
  const techNorm = techStage.toLowerCase();
  // Maps VC investment stage → compatible tech stages (financing rounds + dev-stage keywords)
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

function geographyScore(vcGeoFocus) {
  const g = (vcGeoFocus || '').toLowerCase();
  if (!g || g.includes('national')) return 0.8;
  if (g.includes('mid-atlantic') || g.includes('east coast')) return 1.0;
  if (g.includes('west coast') || g.includes('international')) return 0.4;
  return 0.7;
}

function checkSizeScore(vcMin, vcMax, techDomain) {
  const maturity = DOMAIN_MATURITY[techDomain] || 'mid';
  if (maturity === 'early'      && vcMax <= 15) return 1;
  if (maturity === 'mid'        && vcMin >= 1 && vcMax <= 50) return 1;
  if (maturity === 'commercial' && vcMin >= 10) return 1;
  return 0.4;
}

function scoreTech(tech, vcProfile) {
  const { matched, matchesAll } = mapFocusTodomains(vcProfile.investmentFocus);
  const techDomains = tech.sectors || [];

  let industryScore;
  if (matchesAll && matched.size === 0) {
    industryScore = 0.3;
  } else if (matchesAll) {
    industryScore = 0.5;
  } else {
    const hits = techDomains.filter(d => matched.has(d)).length;
    industryScore = techDomains.length > 0 ? hits / techDomains.length : 0;
    if (matchesAll) industryScore = Math.max(industryScore, 0.4);
  }

  const stage   = stageScore(vcProfile.stages, tech.stage);
  const geo     = geographyScore(vcProfile.geographicFocus);
  const checkSz = checkSizeScore(vcProfile.checkSizeMin, vcProfile.checkSizeMax, techDomains[0]);

  // Weights: 37.5% industry, 30% stage, 22.5% check size, 10% geography
  return 0.375 * industryScore + 0.30 * stage + 0.10 * geo + 0.225 * checkSz;
}

// ── Claude research (exported) ────────────────────────────────────────────────

async function researchVC(name) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userPrompt = `You are a VC research analyst. Research the venture capital firm "${name}" using web search, then return a JSON object with exactly these fields:

{
  "fullName": "Official full name of the firm",
  "aliases": ["common shorter name", "abbreviation if any"],
  "investmentFocus": ["list of 3-8 specific industries/verticals they invest in"],
  "stages": ["Seed", "Series A", "Series B", "Growth"],
  "checkSizeMin": 1,
  "checkSizeMax": 20,
  "thesis": "1-2 sentence description of their investment thesis",
  "geographicFocus": "National | East Coast | Mid-Atlantic | West Coast | International"
}

For investmentFocus, be specific (e.g. "Digital Health", "Medical Devices", "Life Sciences", "Oncology", "Cybersecurity", "Clean Tech") not generic.
For stages, only include stages they actually invest in.
For checkSize, use millions USD. If unknown, use 1 for min and 25 for max.
For geographicFocus: use "National" if they invest across the US with no stated geographic restriction. Use "Mid-Atlantic" or "East Coast" if they have explicit focus or strong presence in Baltimore/DC/NY/Boston. Use "West Coast" if they primarily back Bay Area or LA companies. Use "International" if they focus outside the US.

Return ONLY valid JSON, no other text.`;

  const messages = [{ role: 'user', content: userPrompt }];

  for (let i = 0; i < 6; i++) {
    const response = await client.messages.create({
      model:      'claude-opus-4-8',
      max_tokens: 2048,
      tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
      messages,
    });

    const textBlocks    = response.content.filter(b => b.type === 'text').map(b => b.text);
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

    if (response.stop_reason === 'end_turn') {
      const text = textBlocks.join('');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Could not extract JSON from response:\n' + text);
      return JSON.parse(jsonMatch[0]);
    }

    if (response.stop_reason === 'tool_use' && toolUseBlocks.length > 0) {
      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: toolUseBlocks.map(b => ({
          type:        'tool_result',
          tool_use_id: b.id,
          content:     'Search results retrieved. Please compile the final JSON now.',
        })),
      });
      continue;
    }

    const text = textBlocks.join('');
    if (text) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    }
    throw new Error(`Unexpected stop_reason: ${response.stop_reason}`);
  }

  throw new Error('Research loop exceeded maximum iterations');
}

// ── Entry builder (exported) ──────────────────────────────────────────────────

function buildEntry(vcProfile, techs) {
  const { matched } = mapFocusTodomains(vcProfile.investmentFocus);
  const scored = techs
    .map(t => ({ tech: t, score: scoreTech(t, vcProfile) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.tech.sectors.filter(d => matched.has(d)).length
           - a.tech.sectors.filter(d => matched.has(d)).length;
    });

  const slug = vcProfile.fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return {
    id:              slug,
    name:            vcProfile.fullName,
    aliases:         vcProfile.aliases || [],
    focus:           vcProfile.thesis  || '',
    sectors:         vcProfile.investmentFocus,
    stage:           vcProfile.stages,
    checkSize:       { min: vcProfile.checkSizeMin, max: vcProfile.checkSizeMax },
    geographicFocus: vcProfile.geographicFocus || 'National',
    matchedTechs:    scored.slice(0, 4).map(({ tech }) => tech.id),
    vcOnePager:      null,
    provisional:     true,
  };
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (require.main === module) {
  const fs   = require('fs');
  const path = require('path');

  const vcName = process.argv[2];
  if (!vcName) { console.error('Usage: node scripts/generate_vc.js "<VC Name>"'); process.exit(1); }
  if (!process.env.ANTHROPIC_API_KEY) { console.error('❌ Set ANTHROPIC_API_KEY'); process.exit(1); }

  const dataDir   = path.join(__dirname, '..', 'data');
  const vcsPath   = path.join(dataDir, 'vcs.json');
  const techsPath = path.join(dataDir, 'technologies.json');

  async function main() {
    console.log(`🤖 JHTV VC Profile Generator — ${vcName}\n`);

    const vcProfile = await researchVC(vcName);
    console.log(`✅ ${vcProfile.fullName} | ${vcProfile.investmentFocus.join(', ')} | $${vcProfile.checkSizeMin}M–$${vcProfile.checkSizeMax}M`);

    const techs   = JSON.parse(fs.readFileSync(techsPath, 'utf8'));
    const newEntry = buildEntry(vcProfile, techs);

    const { matched } = mapFocusTodomains(vcProfile.investmentFocus);
    const scored = techs
      .map(t => ({ tech: t, score: scoreTech(t, vcProfile) }))
      .sort((a, b) => b.score - a.score);
    console.log(`\n🎯 Top 4 matches:`);
    scored.slice(0, 4).forEach(({ tech, score }) => {
      console.log(`   ${(score * 100).toFixed(0)}% — ${tech.name} [${tech.sectors.join(', ')}]`);
    });

    const vcs      = JSON.parse(fs.readFileSync(vcsPath, 'utf8'));
    const existing = vcs.findIndex(v => v.id === newEntry.id);
    if (existing >= 0) {
      console.log(`\n⚠️  "${newEntry.name}" already exists — updating.`);
      vcs[existing] = newEntry;
    } else {
      vcs.push(newEntry);
    }

    fs.writeFileSync(vcsPath, JSON.stringify(vcs, null, 2));
    console.log(`\n✅ Written to data/vcs.json`);
    console.log(`\n📋 Next: git add data/vcs.json && git commit -m "feat: add ${vcProfile.fullName} (provisional)" && git push`);
  }

  main().catch(err => { console.error('\n❌', err.message); process.exit(1); });
}

module.exports = { researchVC, buildEntry };
