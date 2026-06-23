#!/usr/bin/env node
/**
 * JHTV Second Brain — VC Profile Generator
 * ─────────────────────────────────────────────────────────────────────────────
 * Researches a VC firm using the Claude API (web_fetch tool), scores each
 * technology in data/technologies.json against the VC's investment thesis,
 * and appends a new entry to data/vcs.json.
 *
 * Usage:  node scripts/generate_vc.js "Andreessen Horowitz"
 * Requires: ANTHROPIC_API_KEY environment variable
 *
 * After running, review the new entry in data/vcs.json, then:
 *   git add data/vcs.json && git commit -m "feat: add <VC name>" && git push
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const vcName = process.argv[2];

if (!vcName) {
  console.error('Usage: node scripts/generate_vc.js "<VC Name>"');
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY environment variable is not set');
  process.exit(1);
}

const dataDir   = path.join(__dirname, '..', 'data');
const vcsPath   = path.join(dataDir, 'vcs.json');
const techsPath = path.join(dataDir, 'technologies.json');

// TODO: implement AI-powered VC research and matching
// Steps:
//   1. Use Anthropic SDK + web_fetch tool to visit the VC's website and research their thesis
//   2. Extract: sectors, stage focus, key portfolio companies, investment thesis
//   3. Score each technology in technologies.json against the VC profile
//   4. Build a new VC entry with matchedTechs array
//   5. Append to vcs.json

console.log(`🤖 VC Profile Generator`);
console.log(`   Target: ${vcName}`);
console.log(`\n⚠  AI generation not yet implemented.`);
console.log(`   To add this VC manually, edit data/vcs.json and add an entry like:\n`);

const slug = vcName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

console.log(JSON.stringify({
  id: slug,
  name: vcName,
  aliases: [],
  focus: '',
  sectors: [],
  stage: [],
  matchedTechs: []
}, null, 2));

console.log(`\n   Then run: git add data/vcs.json && git commit -m "feat: add ${vcName}" && git push`);
