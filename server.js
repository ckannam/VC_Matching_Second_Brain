'use strict';

const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/search',    require('./routes/search'));
app.use('/api/download',  require('./routes/download'));

// Phase 2 stub — AI-powered VC profile generation + matching
app.post('/api/generate-vc', (_req, res) => {
  // TODO: call Claude API, research VC from public sources, score against technologies.json, save to vcs.json
  res.status(501).json({ error: 'AI VC generation not yet implemented' });
});

app.listen(PORT, () => {
  console.log(`JHTV Second Brain running at http://localhost:${PORT}`);
});
