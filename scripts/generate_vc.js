#!/usr/bin/env node
/**
 * JHTV Second Brain — VC Profile Generator
 *
 * Researches a VC firm using the Claude API (web_search + web_fetch),
 * scores all 74 technologies against the VC's thesis, picks the top 4,
 * and appends a provisional entry to data/vcs.json.
 *
 * Usage:  ANTHROPIC_API_KEY=sk-... node scripts/generate_vc.js "Lux Capital"
 *
 * After running, review the appended entry in data/vcs.json, then:
 *   git add data/vcs.json && git commit -m "feat: add <VC name> (provisional)" && git push
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// ── Args / env ────────────────────────────────────────────────────────────────

const vcName = process.argv[2];
if (!vcName) { console.error('Usage: node scripts/generate_vc.js "<VC Name>"'); process.exit(1); }
if (!process.env.ANTHROPIC_API_KEY) { console.error('❌ Set ANTHROPIC_API_KEY'); process.exit(1); }

const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const dataDir   = path.join(__dirname, '..', 'data');
const vcsPath   = path.join(dataDir, 'vcs.json');
const techsPath = path.join(dataDir, 'technologies.json');

// ── Industry → JHTV domain mapping ───────────────────────────────────────────
// Maps normalized VC investment focus keywords → which JHTV tech domains score high.
// Keys are lowercase substrings to match against extracted VC focus strings.

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
  'deep tech':           null,   // null = matches all domains at low weight
  'healthcare':          null,
  'health care':         null,
};

// Maturity tier per domain — used for check-size scoring.
// 'early' = pre-clinical/pre-product; 'mid' = clinical/MVP; 'commercial' = revenue-stage
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
  // Returns Set of JHTV domains this VC is interested in, plus a boolean for "matches all"
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
  if (!techStage) return 0.5; // unknown — neutral
  const techNorm = techStage.toLowerCase();
  const stageMap = {
    'seed':       ['pre-clinical','pre-product','concept','early'],
    'series a':   ['pre-clinical','clinical','mvp','pilot'],
    'series b':   ['clinical','commercial','revenue'],
    'growth':     ['commercial','revenue','scale'],
    'late stage': ['commercial','revenue','scale'],
  };
  for (const vs of vcStages) {
    const compatible = stageMap[vs.toLowerCase()] || [];
    if (compatible.some(s => techNorm.includes(s))) return 1;
  }
  return 0.2;
}

function checkSizeScore(vcMin, vcMax, techDomain) {
  const maturity = DOMAIN_MATURITY[techDomain] || 'mid';
  // Check-size tiers (in $M): early < 5, mid 2–20, commercial > 10
  if (maturity === 'early'  && vcMax <= 15) return 1;
  if (maturity === 'mid'    && vcMin >= 1 && vcMax <= 50) return 1;
  if (maturity === 'commercial' && vcMin >= 10) return 1;
  return 0.4;
}

function scoreTech(tech, vcProfile) {
  const { matched, matchesAll } = mapFocusTodomains(vcProfile.investmentFocus);
  const techDomains = tech.sectors || [];

  // Industry score
  let industryScore;
  if (matchesAll && matched.size === 0) {
    industryScore = 0.3; // "healthcare" / "deep tech" alone — low discrimination
  } else if (matchesAll) {
    industryScore = 0.5;
  } else {
    const hits = techDomains.filter(d => matched.has(d)).length;
    industryScore = techDomains.length > 0 ? hits / techDomains.length : 0;
    if (matchesAll) industryScore = Math.max(industryScore, 0.4);
  }

  // Stage score
  const stage = stageScore(vcProfile.stages, tech.stage);

  // Check size score (use first tech domain for maturity lookup)
  const checkSz = checkSizeScore(vcProfile.checkSizeMin, vcProfile.checkSizeMax, techDomains[0]);

  return 0.5 * industryScore + 0.3 * stage + 0.2 * checkSz;
}

// ── Claude research ───────────────────────────────────────────────────────────

async function researchVC(name) {
  console.log(`\n🔍 Researching "${name}" via Claude…`);

  const userPrompt = `You are a VC research analyst. Research the venture capital firm "${name}" using web search, then return a JSON object with exactly these fields:

{
  "fullName": "Official full name of the firm",
  "aliases": ["common shorter name", "abbreviation if any"],
  "investmentFocus": ["list of 3-8 specific industries/verticals they invest in"],
  "stages": ["Seed", "Series A", "Series B", "Growth"],
  "checkSizeMin": 1,
  "checkSizeMax": 20,
  "thesis": "1-2 sentence description of their investment thesis"
}

For investmentFocus, be specific (e.g. "Digital Health", "Medical Devices", "Life Sciences", "Oncology", "Cybersecurity", "Clean Tech") not generic.
For stages, only include stages they actually invest in.
For checkSize, use millions USD. If unknown, use 1 for min and 25 for max.

Return ONLY valid JSON, no other text.`;

  const messages = [{ role: 'user', content: userPrompt }];

  // Agentic loop — handles both server-side tool execution and explicit tool_use turns
  for (let i = 0; i < 6; i++) {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages,
    });

    const textBlocks = response.content.filter(b => b.type === 'text').map(b => b.text);
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

    if (response.stop_reason === 'end_turn') {
      const text = textBlocks.join('');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Could not extract JSON from response:\n' + text);
      const profile = JSON.parse(jsonMatch[0]);
      console.log(`✅ Profile extracted:`);
      console.log(`   Name:   ${profile.fullName}`);
      console.log(`   Focus:  ${profile.investmentFocus.join(', ')}`);
      console.log(`   Stages: ${profile.stages.join(', ')}`);
      console.log(`   Check:  $${profile.checkSizeMin}M – $${profile.checkSizeMax}M`);
      return profile;
    }

    if (response.stop_reason === 'tool_use' && toolUseBlocks.length > 0) {
      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: toolUseBlocks.map(b => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: 'Search results retrieved. Please compile the final JSON now.',
        })),
      });
      continue;
    }

    // Unexpected stop — try to salvage any text
    const text = textBlocks.join('');
    if (text) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    }
    throw new Error(`Unexpected stop_reason: ${response.stop_reason}`);
  }

  throw new Error('Research loop exceeded maximum iterations');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🤖 JHTV VC Profile Generator`);
  console.log(`   Target: ${vcName}\n`);

  // Research the VC
  const vcProfile = await researchVC(vcName);

  // Load technologies
  const techs = JSON.parse(fs.readFileSync(techsPath, 'utf8'));

  // Score and rank all techs
  console.log(`\n📊 Scoring ${techs.length} technologies…`);
  const scored = techs.map(t => ({ tech: t, score: scoreTech(t, vcProfile) }))
    .sort((a, b) => b.score - a.score || b.tech.sectors.filter(d => {
      const { matched } = mapFocusTodomains(vcProfile.investmentFocus);
      return matched.has(d);
    }).length - a.tech.sectors.filter(d => {
      const { matched } = mapFocusTodomains(vcProfile.investmentFocus);
      return matched.has(d);
    }).length);

  const top4 = scored.slice(0, 4);
  console.log(`\n🎯 Top 4 matches:`);
  top4.forEach(({ tech, score }) => {
    console.log(`   ${(score * 100).toFixed(0)}% — ${tech.name} [${tech.sectors.join(', ')}]`);
  });

  // Build vcs.json entry
  const slug = vcProfile.fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const newEntry = {
    id:           slug,
    name:         vcProfile.fullName,
    aliases:      vcProfile.aliases || [],
    focus:        vcProfile.thesis || '',
    sectors:      vcProfile.investmentFocus,
    stage:        vcProfile.stages,
    checkSize:    { min: vcProfile.checkSizeMin, max: vcProfile.checkSizeMax },
    matchedTechs: top4.map(({ tech }) => tech.id),
    vcOnePager:   null,
    provisional:  true,
  };

  // Append to vcs.json
  const vcs = JSON.parse(fs.readFileSync(vcsPath, 'utf8'));

  const existing = vcs.findIndex(v => v.id === newEntry.id);
  if (existing >= 0) {
    console.log(`\n⚠️  "${newEntry.name}" already exists in vcs.json — updating.`);
    vcs[existing] = newEntry;
  } else {
    vcs.push(newEntry);
  }

  fs.writeFileSync(vcsPath, JSON.stringify(vcs, null, 2));
  console.log(`\n✅ Written to data/vcs.json`);
  console.log(`\n📋 Next steps:`);
  console.log(`   1. Review the entry in data/vcs.json`);
  console.log(`   2. git add data/vcs.json && git commit -m "feat: add ${vcProfile.fullName} (provisional)" && git push`);
  console.log(`   3. Search "${vcProfile.fullName}" in the web app to verify`);
}

main().catch(err => {
  console.error('\n❌', err.message);
  process.exit(1);
});
