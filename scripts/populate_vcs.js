#!/usr/bin/env node
/**
 * populate_vcs.js — Builds data/vcs.json from the completed VC one-pager PDFs.
 *
 * For each PDF in one-pagers/VC One Pagers/Completed One Pagers :
 *   1. Extracts text via Python/pdfminer (already installed)
 *   2. Finds the "JHTV PORTFOLIO MATCHES" section
 *   3. Matches company names against the known tech IDs in data/technologies.json
 *   4. Writes the VC entry with matchedTechs[] and vcOnePager filename
 *
 * Run: node scripts/populate_vcs.js
 */
'use strict';

const fs    = require('fs');
const path  = require('path');
const { spawnSync } = require('child_process');

const ROOT       = path.join(__dirname, '..');
const VC_DIR     = path.join(ROOT, 'one-pagers', 'VC One Pagers', 'Completed One Pagers ');
const TECHS_PATH = path.join(ROOT, 'data', 'technologies.json');
const OUT_PATH   = path.join(ROOT, 'data', 'vcs.json');

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function extractPdfText(filePath) {
  const result = spawnSync('python3', ['-c', `
from pdfminer.high_level import extract_text
import sys
print(extract_text(sys.argv[1]))
`, filePath], { encoding: 'utf8', timeout: 30000 });
  if (result.error || result.status !== 0) {
    throw new Error(`pdfminer failed for ${filePath}: ${result.stderr}`);
  }
  return result.stdout;
}

// ── Load tech lookup ──────────────────────────────────────────────────────────

const techs = JSON.parse(fs.readFileSync(TECHS_PATH, 'utf8'));

// Map: normalizedKey → tech entry (exact keys)
const techLookup = new Map();
for (const t of techs) {
  techLookup.set(normalize(t.id),   t);
  techLookup.set(normalize(t.name), t);
}

// Also build prefix index: normalizedKey → tech, for partial name matches
// e.g. "brainbox" should match tech name "brainboxsolutions"
const techPrefixEntries = [...techLookup.entries()]; // [normKey, tech]

function lookupTech(candidate) {
  // 1. Exact match
  if (techLookup.has(candidate)) return techLookup.get(candidate);
  // 2. Prefix match: tech normalized name/id starts with candidate
  //    Require 8+ chars to avoid common words ("brain", "bio", etc.) matching
  if (candidate.length >= 8) {
    for (const [key, t] of techPrefixEntries) {
      if (key.startsWith(candidate)) return t;
    }
  }
  return null;
}

function findMatchedTechs(sectionText) {
  const found = new Map(); // id → tech (deduplicated)

  // Match line-by-line: company names appear on their own lines in the template.
  // This avoids false positives from content words inside descriptions.
  const lines = sectionText.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Try the full line first, then progressively shorter leading spans
    // (handles "BrainBox" which appears alone vs "Circlage  AI in the OR · NewCo" style)
    const variants = [line];
    // Also try just the first 1–3 whitespace-delimited tokens of the line
    const tokens = line.split(/\s+/);
    for (let len = Math.min(tokens.length - 1, 3); len >= 1; len--) {
      variants.push(tokens.slice(0, len).join(' '));
    }

    for (const v of variants) {
      const candidate = normalize(v);
      if (candidate.length < 3) continue;
      const t = lookupTech(candidate);
      if (t) {
        found.set(t.id, t);
        break;
      }
    }
  }

  return [...found.values()];
}

// ── VC name from filename ─────────────────────────────────────────────────────

function nameFromFilename(filename) {
  return filename
    .replace(/\.pdf$/i, '')
    .replace(/[_]?(One_?Pager|OnePager)[_]?/gi, '')
    .replace(/_/g, ' ')
    .trim()
    // Title-case each word (handles "emergence_capital" → "Emergence Capital")
    .replace(/\b\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    // Preserve known all-caps acronyms
    .replace(/\bNea\b/, 'NEA')
    .replace(/\b8 Vc\b/i, '8VC');
}

// ── VC name → aliases heuristic ──────────────────────────────────────────────

function guessAliases(name) {
  const aliases = [];
  // "Lux Capital" → "Lux"
  const words = name.split(/\s+/);
  if (words.length > 1) aliases.push(words[0]);
  return aliases;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const pdfFiles = fs.readdirSync(VC_DIR)
  .filter(f => f.endsWith('.pdf') && !f.startsWith('~$') && !f.startsWith('.'));

const vcs = [];
const issues = [];

for (const filename of pdfFiles.sort()) {
  const filePath = path.join(VC_DIR, filename);
  console.log(`\nProcessing: ${filename}`);

  let text;
  try {
    text = extractPdfText(filePath);
  } catch (e) {
    console.error(`  ❌ Failed to read PDF: ${e.message}`);
    issues.push({ file: filename, issue: 'PDF extraction failed' });
    continue;
  }

  const vcName = nameFromFilename(filename);

  // Find JHTV section
  const sectionStart = text.indexOf('JHTV PORTFOLIO MATCHES');
  const sectionEnd   = text.indexOf('WHO WE ARE MEETING WITH');

  let matchedTechs = [];
  if (sectionStart === -1) {
    console.log(`  ⚠️  No "JHTV PORTFOLIO MATCHES" section found`);
    issues.push({ file: filename, issue: 'Missing JHTV PORTFOLIO MATCHES section — add matchedTechs manually' });
  } else {
    const end = sectionEnd > sectionStart ? sectionEnd : text.length;
    const section = text.slice(sectionStart + 'JHTV PORTFOLIO MATCHES'.length, end);
    const matched = findMatchedTechs(section);
    matchedTechs = matched.map(t => t.id);
    console.log(`  ✅ Matched: ${matchedTechs.join(', ') || '(none)'}`);
    if (matchedTechs.length === 0) {
      issues.push({ file: filename, issue: 'Section found but no tech names matched — check manually' });
    } else if (matchedTechs.length !== 4) {
      issues.push({ file: filename, issue: `Expected 4 matches, found ${matchedTechs.length}: ${matchedTechs.join(', ')}` });
    }
  }

  const id = slugify(vcName);

  vcs.push({
    id,
    name:         vcName,
    aliases:      guessAliases(vcName),
    focus:        '',
    sectors:      [],
    stage:        [],
    matchedTechs,
    vcOnePager:   filename,
  });
}

fs.writeFileSync(OUT_PATH, JSON.stringify(vcs, null, 2));
console.log(`\n✅ Wrote ${vcs.length} VC entries to data/vcs.json`);

if (issues.length > 0) {
  console.log('\n⚠️  Issues requiring manual review:');
  for (const { file, issue } of issues) {
    console.log(`   ${file}: ${issue}`);
  }
}
