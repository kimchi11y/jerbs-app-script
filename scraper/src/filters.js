/**
 * filters.js — cheap rules applied before the LLM ever sees a job.
 * beforeDetail() runs on search results (title, date); afterDetail() runs once
 * the full posting is fetched (location, description).
 */

const MIN_DESCRIPTION_CHARS = 50; // same threshold the matcher uses to skip blank rows

export class JobFilter {
  /** @param {{maxAgeDays?:number, includeTitle?:string[], excludeTitle?:string[]}} opts regex sources */
  constructor(opts = {}) {
    this.maxAgeDays_ = opts.maxAgeDays || 0;
    this.include_ = (opts.includeTitle || []).map(s => new RegExp(s, 'i'));
    this.exclude_ = (opts.excludeTitle || []).map(s => new RegExp(s, 'i'));
  }

  /**
   * @param {{title:string, postedAt?:string}} job
   * @param {{keywords?:string[]}} rules per-source extras (e.g. a company's title keywords)
   * @return {string} why the job is rejected, or '' to keep it
   */
  beforeDetail(job, rules = {}) {
    const title = String(job.title || '');
    const hit = this.exclude_.find(r => r.test(title));
    if (hit) return 'title matches ' + hit.source;
    if (this.include_.length && !this.include_.some(r => r.test(title))) return 'title not in includeTitle';
    const kw = rules.keywords || [];
    if (kw.length && !kw.some(k => title.toLowerCase().includes(k.toLowerCase()))) return 'title lacks company keywords';
    if (this.maxAgeDays_ && job.postedAt) {
      const ageDays = (Date.now() - new Date(job.postedAt).getTime()) / 86400000;
      if (ageDays > this.maxAgeDays_) return 'older than ' + this.maxAgeDays_ + ' days';
    }
    return '';
  }

  /** @param {{location?:string, description?:string}} job @param {{location?:string}} rules */
  afterDetail(job, rules = {}) {
    if (String(job.description || '').trim().length < MIN_DESCRIPTION_CHARS) return 'no description';
    if (rules.location && !String(job.location || '').toLowerCase().includes(rules.location.toLowerCase())) {
      return 'location is not ' + rules.location;
    }
    return '';
  }
}
