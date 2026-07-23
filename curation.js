'use strict';
/* Pure helpers for the tech curation feature (pause/resume matching, cohort grouping).
 * Dual classic-script + module.exports, same pattern as scoring.js — the browser loads
 * it via <script defer>, Node requires it in tests. */

// Techs whose id is NOT in the paused set. `paused` may be a Set or an array of ids.
function activeTechs(techs, paused) {
  const set = paused instanceof Set ? paused : new Set(paused || []);
  return (techs || []).filter(t => !set.has(t.id));
}

// Group techs → [{ cohort, buckets: [{ bucket, techs }] }]. Cohorts sorted (Cohort 1
// first), buckets alphabetical, techs by name. A tech with multiple sectors appears
// under each; a tech with no sectors goes under "(unassigned)".
function groupByCohortBucket(techs) {
  const cohorts = new Map(); // cohort → Map(bucket → techs[])
  for (const t of techs || []) {
    const cohort = t.cohort || 'Cohort 1';
    if (!cohorts.has(cohort)) cohorts.set(cohort, new Map());
    const buckets = cohorts.get(cohort);
    const secs = (t.sectors && t.sectors.length) ? t.sectors : ['(unassigned)'];
    for (const b of secs) {
      if (!buckets.has(b)) buckets.set(b, []);
      buckets.get(b).push(t);
    }
  }
  return [...cohorts.keys()].sort().map(cohort => ({
    cohort,
    buckets: [...cohorts.get(cohort).keys()].sort().map(bucket => ({
      bucket,
      techs: cohorts.get(cohort).get(bucket).slice().sort((a, b) => a.name.localeCompare(b.name)),
    })),
  }));
}

if (typeof module !== 'undefined' && module.exports)
  module.exports = { activeTechs, groupByCohortBucket };
