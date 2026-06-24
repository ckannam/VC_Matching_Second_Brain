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

const techs = files.map(filename => {
  // Strip _One_Pager.docx suffix
  const base = filename.replace(/_One_Pager\.docx$/i, '').replace(/\.docx$/i, '');
  const id   = slugify(base);
  const name = humanize(base);

  return {
    id,
    name,
    sectors:     [],
    stage:       '',
    pi:          '',
    description: '',
    onePager:    filename,
  };
});

// Sort alphabetically by name
techs.sort((a, b) => a.name.localeCompare(b.name));

fs.writeFileSync(OUT_PATH, JSON.stringify(techs, null, 2));
console.log(`✅ Wrote ${techs.length} technology entries to data/technologies.json`);
techs.forEach(t => console.log(`   ${t.id.padEnd(40)} ← ${t.onePager}`));
