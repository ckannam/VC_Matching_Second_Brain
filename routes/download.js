'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const onePagersDir = path.join(__dirname, '..', 'one-pagers');
const dataDir      = path.join(__dirname, '..', 'data');

// GET /api/download/:techId
router.get('/:techId', (req, res) => {
  const tech = JSON.parse(fs.readFileSync(path.join(dataDir, 'technologies.json'), 'utf8'))
    .find(t => t.id === req.params.techId);

  if (!tech) return res.status(404).json({ error: 'Technology not found' });
  if (!tech.onePager) return res.status(404).json({ error: 'No one-pager for this technology' });

  const filePath = path.join(onePagersDir, path.basename(tech.onePager));

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'PDF file not found on server' });
  }

  res.download(filePath, tech.onePager);
});

module.exports = router;
