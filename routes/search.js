'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const dataDir = path.join(__dirname, '..', 'data');

function loadJSON(file) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
}

// GET /api/search?vc=<name>
router.get('/', (req, res) => {
  const query = (req.query.vc || '').trim().toLowerCase();
  if (!query) return res.json({ found: false, results: [] });

  const vcs  = loadJSON('vcs.json');
  const tech = loadJSON('technologies.json');
  const techMap = Object.fromEntries(tech.map(t => [t.id, t]));

  const match = vcs.find(vc =>
    vc.name.toLowerCase().includes(query) ||
    (vc.aliases || []).some(a => a.toLowerCase().includes(query))
  );

  if (!match) return res.json({ found: false, results: [] });

  const technologies = (match.matchedTechs || [])
    .map(id => techMap[id])
    .filter(Boolean);

  res.json({ found: true, vc: match, technologies });
});

// GET /api/technologies — full catalog
router.get('/technologies', (req, res) => {
  res.json(loadJSON('technologies.json'));
});

module.exports = router;
