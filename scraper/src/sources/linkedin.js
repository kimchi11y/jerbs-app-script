/**
 * linkedin.js — LinkedIn's public, logged-out job endpoints (the ones its
 * public job search pages load). Never uses a LinkedIn login. LinkedIn
 * rate-limits these and its terms disallow scraping, so keep searches few and
 * the request gap long (see index.js).
 */

import * as cheerio from 'cheerio';
import { htmlToText, clean } from '../text.js';

const BASE = 'https://www.linkedin.com/jobs-guest/jobs/api';
const PAGE_SIZE = 10;

export class LinkedInSearch {
  /**
   * @param {import('../http.js').HttpClient} http
   * @param {{keywords:string, location?:string, maxPages?:number, maxAgeDays?:number, params?:Object<string,string>}} search
   *   params are passed through, e.g. {"f_WT": "2"} for remote only
   */
  constructor(http, search) {
    this.http_ = http;
    this.search_ = search;
    this.rules = {};
  }

  get label() { return 'LinkedIn: ' + this.search_.keywords + (this.search_.location ? ' @ ' + this.search_.location : ''); }

  async search() {
    const out = [];
    for (let page = 0; page < (this.search_.maxPages || 1); page++) {
      const q = new URLSearchParams({
        keywords: this.search_.keywords,
        location: this.search_.location || '',
        start: String(page * PAGE_SIZE),
        ...(this.search_.maxAgeDays ? { f_TPR: 'r' + this.search_.maxAgeDays * 86400 } : {}),
        ...this.search_.params,
      });
      const res = await this.http_.request(BASE + '/seeMoreJobPostings/search?' + q);
      if (res.status === 400 || res.status === 404) break; // past the last page
      if (!res.ok) throw new Error('LinkedIn search returned HTTP ' + res.status);
      const $ = cheerio.load(await res.text());
      const cards = $('[data-entity-urn^="urn:li:jobPosting:"]');
      cards.each((_, el) => {
        const card = $(el);
        const id = card.attr('data-entity-urn').split(':').pop();
        out.push({
          source: 'LinkedIn',
          jobId: id,
          url: 'https://www.linkedin.com/jobs/view/' + id,
          title: clean(card.find('.base-search-card__title').text()),
          company: clean(card.find('.base-search-card__subtitle').text()),
          location: clean(card.find('.job-search-card__location').text()),
          workMode: '',
          postedAt: card.find('time').attr('datetime') || '',
        });
      });
      if (cards.length < PAGE_SIZE) break;
    }
    return out;
  }

  async detail(job) {
    const $ = cheerio.load(await this.http_.text(BASE + '/jobPosting/' + job.jobId));
    const criteria = $('.description__job-criteria-item').map((_, el) =>
      clean($(el).find('.description__job-criteria-subheader').text()) + ': ' +
      clean($(el).find('.description__job-criteria-text').text())).get();
    const body = htmlToText($('.show-more-less-html__markup').first().html());
    return {
      ...job,
      description: (criteria.length ? criteria.join('\n') + '\n\n' : '') + body,
    };
  }
}
