#!/usr/bin/env node
/**
 * JHTV Second Brain — Tech Data Enrichment
 *
 * Reads each .docx one-pager, uses Claude to extract stage, PI, and description,
 * and writes the results back into data/technologies.json.
 *
 * Usage:  ANTHROPIC_API_KEY=sk-... node scripts/enrich_tech_data.js
 *
 * Safe to re-run — only overwrites stage/pi/description, preserves sectors/id/onePager.
 */

'use strict';

const fs       = require('fs');
const path     = require('path');
const mammoth  = require('mammoth');
const Anthropic = require('@anthropic-ai/sdk');

if (!process.env.ANTHROPIC_API_KEY) { console.error('❌ Set ANTHROPIC_API_KEY'); process.exit(1); }

const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const docxDir   = path.join(__dirname, '..', 'one-pagers', 'Tech One Pagers');
const techsPath = path.join(__dirname, '..', 'data', 'technologies.json');

async function extractFromDocx(filePath) {
  const { value: text } = await mammoth.extractRawText({ path: filePath });
  if (!text.trim()) return null;

  const response = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages:   [{
      role:    'user',
      content: `Extract three fields from this JHTV technology one-pager. Return ONLY valid JSON, no other text.

{
  "stage": "development stage as described in the document — keep the original wording from the 'Development Status' section (e.g. 'Pre-clinical', 'IND-enabling', 'Phase I', 'Phase II Clinical Trial', 'MVP', 'Pilot', 'FDA-cleared', 'Commercial')",
  "pi": "Principal Investigator full name — first and last name only, empty string if not found",
  "description": "1-2 sentence plain-English summary of what this technology does and the problem it solves"
}

One-pager text:
---
${text.slice(0, 3000)}
---`,
    }],
  });

  const raw   = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return JSON.parse(match[0]);
}

async function main() {
  const techs      = JSON.parse(fs.readFileSync(techsPath, 'utf8'));
  const techByFile = Object.fromEntries(techs.map(t => [t.onePager, t]));

  const files = fs.readdirSync(docxDir).filter(f => f.endsWith('.docx'));
  console.log(`\n📄 Enriching ${files.length} tech one-pagers via Claude Haiku…\n`);

  let updated = 0;
  let skipped = 0;

  for (const file of files) {
    const tech = techByFile[file];
    if (!tech) {
      console.log(`  ⚠️  No entry for ${file} — skipping`);
      skipped++;
      continue;
    }

    process.stdout.write(`  ${tech.name.padEnd(40)}`);
    try {
      const extracted = await extractFromDocx(path.join(docxDir, file));
      if (!extracted) {
        console.log('⚠️  could not extract JSON');
        skipped++;
        continue;
      }
      if (extracted.stage)       tech.stage       = extracted.stage;
      if (extracted.pi)          tech.pi          = extracted.pi;
      if (extracted.description) tech.description = extracted.description;
      console.log(`✅  ${tech.stage}`);
      updated++;
    } catch (err) {
      console.log(`❌  ${err.message}`);
      skipped++;
    }
  }

  fs.writeFileSync(techsPath, JSON.stringify(techs, null, 2));
  console.log(`\n✅ Updated ${updated} entries, skipped ${skipped}`);
  console.log(`📋 Review data/technologies.json, then: git add data/technologies.json && git commit -m "feat: enrich tech stage/pi/description data" && git push`);
}

main().catch(err => { console.error('\n❌', err.message); process.exit(1); });
