#!/usr/bin/env node
/**
 * One-time enrichment of curated VC entries that lack profile data.
 *
 * The 12 PDF-curated VCs in data/vcs.json (Lux, NEA, Felicis, …) carry only
 * name/aliases/matchedTechs/vcOnePager. This script researches each via the
 * existing pipeline and MERGES the profile fields in, so the Tech Funding
 * Profile view can score them against every technology.
 *
 * Preserved untouched: id, name, matchedTechs (hand-reviewed), vcOnePager.
 * Filled in: focus, sectors, stage, checkSize, geographicFocus; new aliases
 * are unioned in. `provisional` is NOT set — these have real PDF briefs.
 *
 * Usage: ANTHROPIC_API_KEY=sk-... node scripts/enrich_curated_vcs.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { researchVC } = require('./generate_vc.js');

const VCS_PATH = path.join(__dirname, '..', 'data', 'vcs.json');

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Set ANTHROPIC_API_KEY');
    process.exit(1);
  }

  const vcs = JSON.parse(fs.readFileSync(VCS_PATH, 'utf8'));
  const targets = vcs.filter(v => !(v.sectors || []).length && !v.focus);
  console.log(`${targets.length} entries need enrichment: ${targets.map(v => v.name).join(', ')}\n`);

  let ok = 0, failed = [];
  for (const vc of targets) {
    process.stdout.write(`Researching ${vc.name}… `);
    try {
      const profile = await researchVC(vc.name);
      vc.focus           = profile.thesis || '';
      vc.sectors         = profile.investmentFocus || [];
      vc.stage           = profile.stages || [];
      vc.checkSize       = { min: profile.checkSizeMin, max: profile.checkSizeMax };
      vc.geographicFocus = profile.geographicFocus || 'National';
      vc.aliases         = [...new Set([...(vc.aliases || []), ...(profile.aliases || [])])];
      // id, name, matchedTechs, vcOnePager intentionally untouched
      fs.writeFileSync(VCS_PATH, JSON.stringify(vcs, null, 2) + '\n');  // save after each success
      ok++;
      console.log(`✓ sectors: [${vc.sectors.join(', ')}]`);
    } catch (err) {
      failed.push(vc.name);
      console.log(`✗ ${err.message}`);
    }
  }

  console.log(`\nDone: ${ok} enriched, ${failed.length} failed${failed.length ? ` (${failed.join(', ')})` : ''}`);
  console.log('Review the data/vcs.json diff (matchedTechs must be unchanged), then commit.');
}

main();
