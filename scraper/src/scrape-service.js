/**
 * scrape-service.js — runs every source: search → skip known jobs → filter →
 * fetch the full posting → filter again → append to the job sheet.
 * Depends only on abstractions; index.js wires in the real pieces.
 *
 * A source is: { label, rules, search() → Job[], detail(Job) → Job }
 */

import { identitiesOf } from './identity.js';

export class ScrapeService {
  /**
   * @param {{jobSheet:{append:function(object[]):Promise}|null, known:Set<string>, filter:import('./filters.js').JobFilter,
   *          maxNewJobs:number, dryRun:boolean, logger?:Console}} deps
   */
  constructor(deps) {
    this.d_ = deps;
    this.log_ = deps.logger || console;
  }

  /** @return {Promise<{source:string, found:number, fresh:number, filtered:number, added:number, problem:string}[]>} */
  async run(sources) {
    const { jobSheet, known, filter, dryRun } = this.d_;
    let budget = this.d_.maxNewJobs;
    const summary = [];

    for (const source of sources) {
      const entry = { source: source.label, found: 0, fresh: 0, filtered: 0, added: 0, problem: '' };
      summary.push(entry);
      if (budget <= 0) { entry.problem = 'skipped: maxNewJobsPerRun reached'; continue; }
      this.log_.log('\n▶ ' + source.label);

      let candidates;
      try {
        candidates = await source.search();
      } catch (e) {
        entry.problem = e.message;
        this.log_.warn('  ✗ search failed: ' + e.message);
        continue;
      }
      entry.found = candidates.length;
      if (!candidates.length) entry.problem = '0 results (if this keeps happening the source may have changed)';

      const jobs = [];
      let detailErrors = 0;
      let blocked = '';
      for (const c of candidates) {
        if (budget <= 0) break;
        const ids = identitiesOf(c);
        if (ids.some(id => known.has(id))) continue;
        ids.forEach(id => known.add(id));
        entry.fresh++;

        let why = filter.beforeDetail(c, source.rules);
        if (why) { entry.filtered++; this.log_.log('  – ' + c.title + ' (' + why + ')'); continue; }

        let job;
        try {
          job = await source.detail(c);
        } catch (e) {
          if (e.name === 'BlockedError') { blocked = e.message; break; }
          detailErrors++;
          this.log_.warn('  ✗ ' + c.title + ': ' + e.message);
          continue;
        }
        identitiesOf(job).forEach(id => known.add(id));
        why = filter.afterDetail(job, source.rules);
        if (why) { entry.filtered++; this.log_.log('  – ' + job.title + ' (' + why + ')'); continue; }

        this.log_.log('  + ' + job.title + ' · ' + job.company + ' · ' + job.location);
        jobs.push(job);
        budget--;
      }
      if (detailErrors) entry.problem = detailErrors + ' posting(s) could not be fetched';
      if (blocked) {
        entry.problem = blocked;
        this.log_.warn('  ✗ ' + blocked);
      }

      if (jobs.length && !dryRun) {
        try {
          await jobSheet.append(jobs);
        } catch (e) {
          entry.problem = 'could not write to sheet: ' + e.message;
          this.log_.warn('  ✗ ' + entry.problem);
          continue;
        }
      }
      entry.added = jobs.length;
    }
    return summary;
  }
}
