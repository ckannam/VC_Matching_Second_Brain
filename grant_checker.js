'use strict';
/* Grant Checker — questionnaire field schema + pure input helpers.
 * The eligibility LOGIC lives in Grant Finder's shared grant_engine.js;
 * this module only describes the form and builds the engine input `d`.
 * Field ids MUST match grant_engine.js collectData() keys. */

const GRANT_FIELDS = [
  { id:'ventureStage', label:'Venture stage', type:'select', options:[
    {value:'ideation',label:'Idea / pre-incorporation'},
    {value:'forming',label:'Actively incorporating'},
    {value:'pre_seed',label:'Pre-seed'},
    {value:'seed',label:'Seed'},
    {value:'growth',label:'Growth'} ]},
  { id:'entityType', label:'Entity type', type:'select', options:[
    {value:'llc_corp',label:'LLC / Corp'},
    {value:'partnership',label:'Partnership'},
    {value:'sole_prop',label:'Sole proprietor'},
    {value:'none',label:'Not yet incorporated'} ]},
  { id:'technologyType', label:'Technology type', type:'select', options:[
    {value:'therapeutic',label:'Therapeutic'},
    {value:'device',label:'Device'},
    {value:'digital_health',label:'Digital health'},
    {value:'life_tools',label:'Life sciences tools'},
    {value:'synbio',label:'Synthetic biology'},
    {value:'non_medical',label:'Non-medical'} ]},
  { id:'jhuSchool', label:'JHU school', type:'select', options:[
    {value:'wse',label:'Whiting (WSE)'},{value:'som',label:'Medicine (SOM)'},
    {value:'bsph',label:'Public Health (BSPH)'},{value:'krieger',label:'Krieger'},
    {value:'nursing',label:'Nursing'},{value:'other_jhu',label:'Other JHU'},
    {value:'none',label:'No JHU affiliation'} ]},
  { id:'leadRole', label:'Lead inventor role', type:'select', options:[
    {value:'faculty',label:'Faculty'},{value:'postdoc',label:'Postdoc'},
    {value:'student',label:'Student'},{value:'external',label:'External'} ]},
  { id:'jhtv', label:'JHTV invention disclosure filed?', type:'select', options:[
    {value:'yes',label:'Yes — formally disclosed'},{value:'no',label:'No'} ]},
  { id:'licensing', label:'Licensing status', type:'select', options:[
    {value:'unlicensed',label:'Unlicensed'},{value:'lt12',label:'Licensed <12 months'},
    {value:'gt12',label:'Licensed >12 months'},{value:'noip',label:'No IP'} ]},
  { id:'siteMiner', label:'TEDCO Site Miner engagement', type:'radio', hint:'(required for MII)', options:[
    {value:'yes',label:'Yes — engaged a Site Miner'},{value:'no',label:'No — not yet'} ]},
  { id:'siteMinerDays', label:'Days since Site Miner engagement', type:'number',
    dependsOn:{field:'siteMiner', value:'yes'} },
  { id:'marylandBased', label:'Maryland-based?', type:'select', options:[
    {value:'yes',label:'Yes — MD principal office'},{value:'planning',label:'Planning MD presence'},
    {value:'no',label:'No'} ]},
  { id:'baltimoreArea', label:'Baltimore City / County?', type:'radio', hint:'(for BII)',
    dependsOn:{field:'marylandBased', value:'yes'}, options:[
    {value:'yes',label:'Yes — Baltimore City or County'},{value:'no',label:'No — elsewhere in MD'} ]},
  { id:'teamSize', label:'Team size', type:'select', options:[
    {value:'founders_only',label:'Founders only'},{value:'1_5',label:'1–5 FTE'},
    {value:'6_15',label:'6–15'},{value:'16_50',label:'16–50'},{value:'over_50',label:'50+'} ]},
  { id:'dilutive', label:'Dilutive funding raised', type:'select', options:[
    {value:'0',label:'$0'},{value:'lt500k',label:'<$500K'},{value:'lt2m',label:'$500K–$2M'},
    {value:'lt5m',label:'$2M–$5M'},{value:'gt5m',label:'>$5M'} ]},
  { id:'sedi', label:'Founder SEDI / rural status', type:'select', options:[
    {value:'sedi',label:'SEDI'},{value:'rural',label:'Rural'},
    {value:'both',label:'Both'},{value:'none',label:'Neither'} ]},
  { id:'stemCells', label:'Involves stem cells?', type:'radio', options:[
    {value:'yes',label:'Yes'},{value:'no',label:'No'} ]},
  { id:'diseaseArea', label:'Disease area', type:'select', options:[
    {value:'cardio',label:'Cardiovascular'},{value:'neuro',label:'Neuro'},
    {value:'cancer',label:'Cancer'},{value:'cf',label:'Cystic fibrosis'},
    {value:'amr',label:'AMR'},{value:'womens',label:"Women's health"},
    {value:'peds',label:'Pediatrics'},{value:'veterans',label:'Veterans'},
    {value:'global',label:'Global health'},{value:'other',label:'Other'} ]},
  { id:'hasSbirPhaseI', label:'Active SBIR/STTR Phase I?', type:'radio', options:[
    {value:'yes',label:'Yes — active Phase I'},{value:'no',label:'No'} ]},
];

function emptyGrantData() {
  const d = {};
  for (const f of GRANT_FIELDS) d[f.id] = '';
  return d;
}

const SECTOR_TO_TYPE = {
  'Therapeutics':'therapeutic','Medical Devices':'device','Diagnostics':'device',
  'Digital Health':'digital_health','Research Technologies':'life_tools',
  'Agricultural Tech':'synbio','Clean Tech':'non_medical','Cybersecurity':'non_medical',
};

function techToGrantPrefill(tech) {
  const s = (tech.stage || '').toLowerCase();
  let ventureStage = 'forming';
  if (s.includes('pre-seed') || s.includes('pre-clinical')) ventureStage = 'pre_seed';
  else if (s.includes('seed')) ventureStage = 'seed';
  else if (s.includes('series') || s.includes('growth') || s.includes('commercial')) ventureStage = 'growth';
  return {
    ventureStage,
    technologyType: SECTOR_TO_TYPE[(tech.sectors || [])[0]] || 'non_medical',
    jhtv: 'yes',
    jhuSchool: 'other_jhu',
  };
}

// Local live-data overlay. The DEPLOYED grant_engine.js exports only getGrants
// (its applyLiveData lives in Grant Finder's uncommitted tree, not on the live
// site), so we overlay the deadline label ourselves. Used as the fallback
// whenever the loaded engine does not provide applyLiveData.
function overlayLive(grant, liveMap) {
  const live = liveMap && liveMap[grant.id];
  return live && live.deadlineLabel ? { ...grant, deadline: live.deadlineLabel } : grant;
}

if (typeof module !== 'undefined' && module.exports)
  module.exports = { GRANT_FIELDS, emptyGrantData, techToGrantPrefill, SECTOR_TO_TYPE, overlayLive };

// ── Browser-only rendering (ignored by Node) ─────────────────────────
function grantFieldHTML(f) {
  const hint = f.hint ? ` <span class="gf-hint">${f.hint}</span>` : '';
  const wrapAttrs = f.dependsOn ? ` data-depends="${f.dependsOn.field}" data-depends-val="${f.dependsOn.value}" style="display:none"` : '';
  let control;
  if (f.type === 'select') {
    control = `<select id="${f.id}" onchange="runGrantCheck()">
      <option value="">—</option>
      ${f.options.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
    </select>`;
  } else if (f.type === 'number') {
    control = `<input type="number" id="${f.id}" min="0" placeholder="e.g. 30" oninput="runGrantCheck()">`;
  } else { // radio
    control = `<div class="gf-radios">${f.options.map(o =>
      `<label class="gf-radio"><input type="radio" name="${f.id}" value="${o.value}" onchange="runGrantCheck()"> ${o.label}</label>`
    ).join('')}</div>`;
  }
  return `<div class="gf-field"${wrapAttrs}><label>${f.label}${hint}</label>${control}</div>`;
}

function collectGrantData() {
  const d = emptyGrantData();
  for (const f of GRANT_FIELDS) {
    if (f.type === 'radio') {
      const el = document.querySelector(`input[name="${f.id}"]:checked`);
      d[f.id] = el ? el.value : '';
    } else {
      const el = document.getElementById(f.id);
      d[f.id] = el ? el.value : '';
    }
  }
  return d;
}

function updateGrantDependents() {
  document.querySelectorAll('.gf-field[data-depends]').forEach(w => {
    const dep = w.getAttribute('data-depends');
    const want = w.getAttribute('data-depends-val');
    const cur = (document.querySelector(`input[name="${dep}"]:checked`) || document.getElementById(dep) || {}).value;
    w.style.display = cur === want ? '' : 'none';
  });
}

function renderGrantCheckerForm(container, prefill) {
  container.innerHTML = `<div class="grant-form">${GRANT_FIELDS.map(grantFieldHTML).join('')}</div>
    <div id="grantCheckResults" class="grant-rows"></div>`;
  if (prefill) {
    for (const [k, v] of Object.entries(prefill)) {
      const sel = document.getElementById(k);
      if (sel && sel.tagName === 'SELECT') { sel.value = v; continue; }
      const radio = document.querySelector(`input[name="${k}"][value="${v}"]`);
      if (radio) radio.checked = true;
    }
  }
  updateGrantDependents();
  runGrantCheck();
}

async function runGrantCheck() {
  updateGrantDependents();
  const box = document.getElementById('grantCheckResults');
  if (!box) return;
  const d = collectGrantData();
  const answered = Object.values(d).some(v => v && v !== '');
  if (!answered) { box.innerHTML = `<p class="gf-empty">Answer the questions above to screen all 28 programs.</p>`; return; }
  try {
    const { getGrants, applyLiveData } = await loadGrantEngine();
    const apply = applyLiveData || overlayLive;
    const results = getGrants(d).map(g => apply(g, _grantsLive));
    const order = { eligible:0, conditional:1, ineligible:2 };
    const shown = results.filter(g => g.s !== 'ineligible').sort((a,b)=>order[a.s]-order[b.s]);
    const ineligible = results.length - shown.length;
    box.innerHTML = shown.map(g => `
      <div class="grant-row">
        <span class="grant-status ${g.s}"></span>
        <div class="grant-row-main">
          <a class="grant-row-title" href="${g.applyUrl}" target="_blank" rel="noopener">${g.title}</a>
          <div class="grant-row-meta">${g.org} · ${g.amount}${g.deadline ? ` · ${g.deadline}` : ''}</div>
        </div>
        <span class="pill grant-pill-${g.s}">${g.s === 'eligible' ? 'Eligible' : 'Conditional'}</span>
      </div>`).join('') + `<p class="gf-empty">${ineligible} programs screened out.</p>`;
  } catch (err) {
    box.innerHTML = `<p class="gf-empty">Couldn't reach the grant engine (${err.message}). <a href="${typeof GRANT_FINDER_URL!=='undefined'?GRANT_FINDER_URL:'#'}" target="_blank" rel="noopener">Open Grant Finder directly</a>.</p>`;
  }
}
