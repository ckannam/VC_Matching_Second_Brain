#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

const TECH_DIR  = path.join(__dirname, '..', 'one-pagers', 'Tech One Pagers');
const OUT_PATH  = path.join(__dirname, '..', 'data', 'technologies.json');

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function humanize(str) {
  // Turn underscores to spaces, preserve original capitalisation
  return str.replace(/_/g, ' ');
}

const files = fs.readdirSync(TECH_DIR)
  .filter(f => f.endsWith('.docx') && !f.startsWith('~$'));

// Merge by id: preserve enriched fields (sectors/stage/pi/description/cohort) for
// techs already in the catalog; only add stubs for new .docx files. A rebuild is
// therefore non-destructive. New techs default to Cohort 1 — set a new cohort label
// on them afterward for a fresh intake batch.
const existing = fs.existsSync(OUT_PATH) ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')) : [];
const byId = new Map(existing.map(t => [t.id, t]));

const techs = files.map(filename => {
  // Strip _One_Pager.docx suffix
  const base = filename.replace(/_One_Pager\.docx$/i, '').replace(/\.docx$/i, '');
  const id   = slugify(base);
  const name = humanize(base);
  const prev = byId.get(id) || {};

  return {
    id,
    name,
    sectors:     prev.sectors     || [],
    stage:       prev.stage       || '',
    pi:          prev.pi          || '',
    description: prev.description || '',
    cohort:      prev.cohort      || 'Cohort 1',
    onePager:    filename,
  };
});

// Sort alphabetically by name
techs.sort((a, b) => a.name.localeCompare(b.name));

fs.writeFileSync(OUT_PATH, JSON.stringify(techs, null, 2));
console.log(`✅ Wrote ${techs.length} technology entries to data/technologies.json`);
techs.forEach(t => console.log(`   ${t.id.padEnd(40)} ← ${t.onePager}`));
