// Shared deal_type/industry → stage/domain mapping. Dual: require()d by scripts. Stage rules: Early→A, Later→B, Angel/Accelerator→Seed, explicit series wins, C+/PIPE/Buyout/IPO→Growth.

// PitchBook industry label → JHTV display domains (label-based, reproducible — not
// second-guessed from company descriptions). Only JHTV-relevant labels are listed;
// every other label is out-of-scope ([]) and, thanks to the saturating portfolio
// count, has no effect (so a firm's many software/fintech/aerospace deals are ignored).
const PB_INDUSTRY_TO_DOMAIN = {
  // Therapeutics
  'Biotechnology':                           ['Therapeutics'],
  'Pharmaceuticals':                         ['Therapeutics'],
  'Other Pharmaceuticals and Biotechnology': ['Therapeutics'],
  'Drug Delivery':                           ['Medical Devices', 'Therapeutics'],
  'Drug Discovery':                          ['Therapeutics', 'Research Technologies'],
  // Diagnostics
  'Diagnostic Equipment':                    ['Diagnostics', 'Medical Devices'],
  'Laboratory Services (Healthcare)':        ['Research Technologies', 'Diagnostics'],
  // Medical Devices
  'Therapeutic Devices':                     ['Medical Devices'],
  'Surgical Devices':                        ['Medical Devices'],
  'Other Devices and Supplies':              ['Medical Devices'],
  'Monitoring Equipment':                    ['Medical Devices', 'Digital Health'],
  // Research Technologies
  'Discovery Tools (Healthcare)':            ['Research Technologies'],
  // Digital Health
  'Clinics/Outpatient Services':             ['Digital Health'],
  'Enterprise Systems (Healthcare)':         ['Digital Health'],
  'Other Healthcare Technology Systems':     ['Digital Health'],
  'Other Healthcare Services':               ['Digital Health'],
  'Medical Records Systems':                 ['Digital Health'],
  'Elder and Disabled Care':                 ['Digital Health'],
  // Clean Tech
  'Alternative Energy Equipment':            ['Clean Tech'],
};

// PitchBook deal_type → round-ladder stage string for a PORTFOLIO company
// (companyStageToRung reads the token). The Series letter is the true round, whether
// PitchBook tagged it "Early Stage" or "Later Stage"; C+ collapses to the top rung.
function dealTypeToStage(dt) {
  const s = (dt || '').toLowerCase();
  const m = s.match(/series ([a-h])/);
  if (m) return 'Series ' + m[1].toUpperCase();
  if (s.includes('seed')) return 'Seed';
  if (s.includes('pe growth') || s.includes('buyout') || s.includes('lbo') || s.includes('pipe')) return 'Growth';
  if (s.includes('early stage')) return 'Series A';
  if (s.includes('later stage')) return 'Series C';
  return undefined; // secondary / joint venture / unknown → domain-only credit
}

// deal_type → a VC stage LABEL for techStageScore's vc.stage[] (keys: seed, series a,
// series b, growth, late stage). Series C+ and buyout/PIPE collapse to Growth.
function dealTypeToVcStage(dt) {
  const s = (dt || '').toLowerCase();
  if (s.includes('seed')) return 'Seed';
  if (s.includes('angel') || s.includes('accelerator')) return 'Seed';
  const m = s.match(/series ([a-h])/);
  if (m) return m[1] === 'a' ? 'Series A' : m[1] === 'b' ? 'Series B' : 'Growth';
  if (s.includes('early stage')) return 'Series A';
  return 'Growth'; // later stage / pe / buyout / pipe
}

// A firm's stage FOCUS from its deals: VC stages that are ≥10% of its rounds (always at
// least the modal stage), in ladder order. Reflects where the firm actually writes checks.
function deriveStageFocus(rows) {
  const counts = {};
  for (const r of rows) { const st = dealTypeToVcStage(r.deal_type); if (st) counts[st] = (counts[st] || 0) + 1; }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  let focus = Object.keys(counts).filter(k => counts[k] / total >= 0.10);
  if (!focus.length) { const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]; if (top) focus = [top[0]]; }
  return ['Seed', 'Series A', 'Series B', 'Growth', 'Late Stage'].filter(s => focus.includes(s));
}

module.exports = { PB_INDUSTRY_TO_DOMAIN, dealTypeToStage, dealTypeToVcStage, deriveStageFocus };
