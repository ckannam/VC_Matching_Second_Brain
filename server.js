'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const { researchVC, buildEntry } = require('./scripts/generate_vc');

const app = express();
app.use(express.json());

// ── CORS ──────────────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  const origin  = req.headers.origin || '';
  const allowed = /^https:\/\/ckannam\.github\.io$|^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  if (allowed.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// ── In-memory job store ───────────────────────────────────────────────────────
// Jobs are lost on server restart. For persistence across restarts or
// multiple instances, replace with a Redis queue or database.
const jobs = {};

// ── GitHub helpers ────────────────────────────────────────────────────────────

const REPO_OWNER = 'ckannam';
const REPO_NAME  = 'VC_Matching_Second_Brain';
const VCS_API    = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/data/vcs.json`;

function ghHeaders() {
  return {
    Authorization:  `Bearer ${process.env.GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent':   'jhtv-vc-research',
    Accept:         'application/vnd.github+json',
  };
}

async function commitVcEntry(newEntry) {
  const getRes = await fetch(VCS_API, { headers: ghHeaders() });
  if (!getRes.ok) throw new Error(`GitHub GET vcs.json failed: ${getRes.status}`);
  const { sha, content } = await getRes.json();

  const vcs = JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
  const idx  = vcs.findIndex(v => v.id === newEntry.id);
  if (idx >= 0) vcs[idx] = newEntry; else vcs.push(newEntry);

  const putRes = await fetch(VCS_API, {
    method:  'PUT',
    headers: ghHeaders(),
    body:    JSON.stringify({
      message: `feat: add ${newEntry.name} (provisional)`,
      content: Buffer.from(JSON.stringify(vcs, null, 2)).toString('base64'),
      sha,
      branch:  'main',
    }),
  });

  // 409 = stale SHA from a concurrent request — retry once with a fresh SHA
  if (putRes.status === 409) {
    const retry   = await fetch(VCS_API, { headers: ghHeaders() });
    const { sha: freshSha, content: freshContent } = await retry.json();
    const freshVcs = JSON.parse(Buffer.from(freshContent, 'base64').toString('utf8'));
    const freshIdx = freshVcs.findIndex(v => v.id === newEntry.id);
    if (freshIdx >= 0) freshVcs[freshIdx] = newEntry; else freshVcs.push(newEntry);
    const retryPut = await fetch(VCS_API, {
      method:  'PUT',
      headers: ghHeaders(),
      body:    JSON.stringify({
        message: `feat: add ${newEntry.name} (provisional)`,
        content: Buffer.from(JSON.stringify(freshVcs, null, 2)).toString('base64'),
        sha:     freshSha,
        branch:  'main',
      }),
    });
    if (!retryPut.ok) throw new Error(`GitHub PUT vcs.json retry failed: ${retryPut.status}`);
    return;
  }

  if (!putRes.ok) throw new Error(`GitHub PUT vcs.json failed: ${putRes.status}`);
}

// ── Background research runner ────────────────────────────────────────────────

async function runResearch(vcName, jobId) {
  try {
    const vcProfile = await researchVC(vcName);
    const techs     = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'technologies.json'), 'utf8'));
    const entry     = buildEntry(vcProfile, techs);

    await commitVcEntry(entry);

    jobs[jobId] = { status: 'done', result: entry };
    console.log(`[job ${jobId}] done — ${entry.name}`);
  } catch (err) {
    jobs[jobId] = { status: 'error', error: err.message || 'Research failed' };
    console.error(`[job ${jobId}] error —`, err.message);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/research-vc
// Body: { vcName }
// Returns { jobId } immediately; research runs in background
app.post('/api/research-vc', (req, res) => {
  const { vcName } = req.body || {};
  if (!vcName?.trim()) return res.status(400).json({ error: 'vcName is required' });

  const jobId = crypto.randomUUID();
  jobs[jobId] = { status: 'running' };
  console.log(`[job ${jobId}] started — "${vcName.trim()}"`);

  runResearch(vcName.trim(), jobId); // fire-and-forget

  res.json({ jobId });
});

// GET /api/job/:jobId
// Returns { status: 'running' | 'done' | 'error', result?, error? }
app.get('/api/job/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`JHTV research server on port ${PORT}`));
