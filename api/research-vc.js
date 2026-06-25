'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const REPO_OWNER = 'ckannam';
const REPO_NAME  = 'VC_Matching_Second_Brain';
const TECHS_URL  = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/data/technologies.json`;
const VCS_API    = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/data/vcs.json`;

// ── Industry → JHTV domain mapping ───────────────────────────────────────────

const INDUSTRY_TO_DOMAIN = {
  'life sciences':       ['Therapeutics','Diagnostics','Digital Health','Medical Devices'],
  'life science':        ['Therapeutics','Diagnostics','Digital Health','Medical Devices'],
  'biotech':             ['Therapeutics','Diagnostics','Research Technologies'],
  'biotechnology':       ['Therapeutics','Diagnostics','Research Technologies'],
  'biopharma':           ['Therapeutics','Diagnostics'],
  'pharma':              ['Therapeutics'],
  'drug discovery':      ['Therapeutics','Research Technologies'],
  'therapeutics':        ['Therapeutics'],
  'diagnostics':         ['Diagnostics'],
  'digital health':      ['Digital Health'],
  'healthcare it':       ['Digital Health'],
  'health it':           ['Digital Health'],
  'healthtech':          ['Digital Health'],
  'health tech':         ['Digital Health'],
  'medtech':             ['Medical Devices'],
  'medical device':      ['Medical Devices'],
  'medical technology':  ['Medical Devices'],
  'surgical':            ['Medical Devices'],
  'oncology':            ['Diagnostics','Therapeutics'],
  'cancer':              ['Diagnostics','Therapeutics'],
  'neurology':           ['Medical Devices','Digital Health'],
  'neurotech':           ['Medical Devices','Digital Health'],
  'cardiovascular':      ['Medical Devices','Diagnostics'],
  'cardiology':          ['Medical Devices','Diagnostics'],
  'cleantech':           ['Clean Tech'],
  'clean tech':          ['Clean Tech'],
  'climate':             ['Clean Tech'],
  'sustainability':      ['Clean Tech'],
  'energy':              ['Clean Tech'],
  'agtech':              ['Agricultural Tech'],
  'agriculture':         ['Agricultural Tech'],
  'food tech':           ['Agricultural Tech'],
  'cybersecurity':       ['Cybersecurity'],
  'security':            ['Cybersecurity'],
  'infosec':             ['Cybersecurity'],
  'research tools':      ['Research Technologies','Diagnostics'],
  'lab tech':            ['Research Technologies'],
  'ai in healthcare':    ['Digital Health','Medical Devices'],
  'ai health':           ['Digital Health'],
  'deep tech':           null,
  'healthcare':          null,
  'health care':         null,
};

const DOMAIN_MATURITY = {
  'Therapeutics':          'early',
  'Diagnostics':           'mid',
  'Medical Devices':       'mid',
  'Digital Health':        'mid',
  'Research Technologies': 'early',
  'Clean Tech':            'early',
  'Agricultural Tech':     'early',
  'Cybersecurity':         'mid',
};

// ── Scoring ───────────────────────────────────────────────────────────────────

function mapFocusTodomains(focusStrings) {
  const matched = new Set();
  let matchesAll = false;
  for (const f of focusStrings) {
    const fl = f.toLowerCase();
    for (const [keyword, domains] of Object.entries(INDUSTRY_TO_DOMAIN)) {
      if (fl.includes(keyword)) {
        if (domains === null) { matchesAll = true; }
        else { domains.forEach(d => matched.add(d)); }
      }
    }
  }
  return { matched, matchesAll };
}

function stageScore(vcStages, techStage) {
  if (!techStage) return 0.5;
  const techNorm = techStage.toLowerCase();
  const stageMap = {
    'seed':       ['pre-clinical','pre-product','concept','early'],
    'series a':   ['pre-clinical','clinical','mvp','pilot'],
    'series b':   ['clinical','commercial','revenue'],
    'growth':     ['commercial','revenue','scale'],
    'late stage': ['commercial','revenue','scale'],
  };
  for (const vs of vcStages) {
    const compatible = stageMap[vs.toLowerCase()] || [];
    if (compatible.some(s => techNorm.includes(s))) return 1;
  }
  return 0.2;
}

function checkSizeScore(vcMin, vcMax, techDomain) {
  const maturity = DOMAIN_MATURITY[techDomain] || 'mid';
  if (maturity === 'early'  && vcMax <= 15) return 1;
  if (maturity === 'mid'    && vcMin >= 1 && vcMax <= 50) return 1;
  if (maturity === 'commercial' && vcMin >= 10) return 1;
  return 0.4;
}

function scoreTech(tech, vcProfile) {
  const { matched, matchesAll } = mapFocusTodomains(vcProfile.investmentFocus);
  const techDomains = tech.sectors || [];

  let industryScore;
  if (matchesAll && matched.size === 0) {
    industryScore = 0.3;
  } else if (matchesAll) {
    industryScore = 0.5;
  } else {
    const hits = techDomains.filter(d => matched.has(d)).length;
    industryScore = techDomains.length > 0 ? hits / techDomains.length : 0;
    if (matchesAll) industryScore = Math.max(industryScore, 0.4);
  }

  const stage   = stageScore(vcProfile.stages, tech.stage);
  const checkSz = checkSizeScore(vcProfile.checkSizeMin, vcProfile.checkSizeMax, techDomains[0]);

  return 0.5 * industryScore + 0.3 * stage + 0.2 * checkSz;
}

// ── Claude research ───────────────────────────────────────────────────────────

async function researchVC(name) {
  const userPrompt = `You are a VC research analyst. Research the venture capital firm "${name}" using web search, then return a JSON object with exactly these fields:

{
  "fullName": "Official full name of the firm",
  "aliases": ["common shorter name", "abbreviation if any"],
  "investmentFocus": ["list of 3-8 specific industries/verticals they invest in"],
  "stages": ["Seed", "Series A", "Series B", "Growth"],
  "checkSizeMin": 1,
  "checkSizeMax": 20,
  "thesis": "1-2 sentence description of their investment thesis"
}

For investmentFocus, be specific (e.g. "Digital Health", "Medical Devices", "Life Sciences", "Oncology", "Cybersecurity", "Clean Tech") not generic.
For stages, only include stages they actually invest in.
For checkSize, use millions USD. If unknown, use 1 for min and 25 for max.

Return ONLY valid JSON, no other text.`;

  const messages = [{ role: 'user', content: userPrompt }];

  for (let i = 0; i < 6; i++) {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages,
    });

    const textBlocks    = response.content.filter(b => b.type === 'text').map(b => b.text);
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

    if (response.stop_reason === 'end_turn') {
      const text = textBlocks.join('');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Could not extract JSON from Claude response');
      return JSON.parse(jsonMatch[0]);
    }

    if (response.stop_reason === 'tool_use' && toolUseBlocks.length > 0) {
      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: toolUseBlocks.map(b => ({
          type:        'tool_result',
          tool_use_id: b.id,
          content:     'Search results retrieved. Please compile the final JSON now.',
        })),
      });
      continue;
    }

    const text = textBlocks.join('');
    if (text) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    }
    throw new Error(`Unexpected stop_reason: ${response.stop_reason}`);
  }

  throw new Error('Research loop exceeded maximum iterations');
}

// ── GitHub helpers ────────────────────────────────────────────────────────────

function ghHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_PAT}`,
    'Content-Type': 'application/json',
    'User-Agent':   'jhtv-vc-research',
  };
}

async function getCurrentVcs() {
  const res = await fetch(VCS_API, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`GitHub GET vcs.json failed: ${res.status}`);
  const { sha, content } = await res.json();
  return { sha, vcs: JSON.parse(Buffer.from(content, 'base64').toString('utf8')) };
}

async function commitUpdatedVcs(vcs, newEntry, sha) {
  const idx = vcs.findIndex(v => v.id === newEntry.id);
  if (idx >= 0) vcs[idx] = newEntry; else vcs.push(newEntry);

  const newContent = Buffer.from(JSON.stringify(vcs, null, 2)).toString('base64');
  const res = await fetch(VCS_API, {
    method: 'PUT',
    headers: ghHeaders(),
    body: JSON.stringify({
      message: `feat: add ${newEntry.name} (provisional)`,
      content: newContent,
      sha,
      branch: 'main',
    }),
  });

  // 409 = SHA stale (concurrent request) — retry once with fresh SHA
  if (res.status === 409) {
    const { sha: freshSha, vcs: freshVcs } = await getCurrentVcs();
    await commitUpdatedVcs(freshVcs, newEntry, freshSha);
    return;
  }

  if (!res.ok) throw new Error(`GitHub PUT vcs.json failed: ${res.status}`);
}

// ── CORS ──────────────────────────────────────────────────────────────────────

function getAllowedOrigin(req) {
  const origin = req.headers.origin || '';
  if (origin === 'https://ckannam.github.io') return origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

// ── Handler ───────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  const allowedOrigin = getAllowedOrigin(req);
  if (allowedOrigin) res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { vcName } = req.body || {};
  if (!vcName?.trim()) return res.status(400).json({ error: 'vcName is required' });

  try {
    // Run research, tech fetch, and vcs.json fetch in parallel
    const [vcProfile, techs, { sha, vcs }] = await Promise.all([
      researchVC(vcName.trim()),
      fetch(TECHS_URL).then(r => r.json()),
      getCurrentVcs(),
    ]);

    const scored = techs
      .map(t => ({ tech: t, score: scoreTech(t, vcProfile) }))
      .sort((a, b) => b.score - a.score);

    const slug = vcProfile.fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const newEntry = {
      id:           slug,
      name:         vcProfile.fullName,
      aliases:      vcProfile.aliases || [],
      focus:        vcProfile.thesis  || '',
      sectors:      vcProfile.investmentFocus,
      stage:        vcProfile.stages,
      checkSize:    { min: vcProfile.checkSizeMin, max: vcProfile.checkSizeMax },
      matchedTechs: scored.slice(0, 4).map(({ tech }) => tech.id),
      vcOnePager:   null,
      provisional:  true,
    };

    await commitUpdatedVcs(vcs, newEntry, sha);

    return res.status(200).json({ success: true, entry: newEntry });
  } catch (err) {
    console.error('research-vc error:', err);
    return res.status(500).json({ error: err.message || 'Research failed' });
  }
};
