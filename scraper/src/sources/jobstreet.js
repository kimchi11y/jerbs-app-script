/**
 * jobstreet.js — JobStreet Malaysia through the JSON APIs its own website uses:
 * the v5 search API for listings, the GraphQL jobDetails query for descriptions.
 * (The job pages themselves sit behind a Cloudflare challenge.)
 */

import { htmlToText, clean } from '../text.js';

const BASE = 'https://my.jobstreet.com';
const PAGE_SIZE = 30;

const DETAILS_QUERY = `query jobDetails($jobId: ID!) {
  jobDetails(id: $jobId) {
    job {
      id title content(platform: WEB)
      advertiser { name(locale: "en-MY") }
      location { label(locale: "en-MY", type: LONG) }
      workTypes { label(locale: "en-MY") }
      listedAt { dateTimeUtc }
    }
  }
}`;

export class JobStreetSearch {
  /** @param {import('../http.js').HttpClient} http @param {{keywords:string, where?:string, maxPages?:number}} search */
  constructor(http, search) {
    this.http_ = http;
    this.search_ = search;
    this.rules = {};
  }

  get label() { return 'JobStreet: ' + this.search_.keywords + (this.search_.where ? ' @ ' + this.search_.where : ''); }

  async search() {
    const out = [];
    for (let page = 1; page <= (this.search_.maxPages || 1); page++) {
      const q = new URLSearchParams({
        siteKey: 'MY-Main', locale: 'en-MY', keywords: this.search_.keywords,
        where: this.search_.where || '', page: String(page), pageSize: String(PAGE_SIZE),
      });
      const d = await this.http_.json(BASE + '/api/jobsearch/v5/search?' + q);
      const items = d.data || [];
      items.forEach(j => out.push({
        source: 'JobStreet',
        jobId: String(j.id),
        url: BASE + '/job/' + j.id,
        title: clean(j.title),
        company: clean(j.companyName || (j.advertiser && j.advertiser.description)),
        location: (j.locations || []).map(l => l.label).join(', '),
        workMode: (j.workArrangements && j.workArrangements.displayText) || '',
        postedAt: j.listingDate || '',
      }));
      if (items.length < PAGE_SIZE) break;
    }
    return out;
  }

  async detail(job) {
    const d = await this.http_.postJson(BASE + '/graphql', {
      operationName: 'jobDetails', variables: { jobId: job.jobId }, query: DETAILS_QUERY,
    }, { 'seek-request-brand': 'jobstreet', 'seek-request-country': 'MY' });
    const j = d.data && d.data.jobDetails && d.data.jobDetails.job;
    if (!j) throw new Error('JobStreet returned no details for job ' + job.jobId);
    const workTypes = (j.workTypes ? [].concat(j.workTypes) : []).map(w => w.label).filter(Boolean);
    return {
      ...job,
      location: (j.location && j.location.label) || job.location,
      description: (workTypes.length ? 'Work type: ' + workTypes.join(', ') + '\n\n' : '') + htmlToText(j.content),
    };
  }
}
