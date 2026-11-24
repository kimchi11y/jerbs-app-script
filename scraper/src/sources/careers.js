/**
 * careers.js — company careers pages. Most companies host jobs on a job board
 * (ATS) with a public JSON feed; detectBoard() recognises the board from the
 * careers URL. Anything else falls back to GenericCareersPage, which reads the
 * page's links with the LLM.
 *
 * Every board implements: kind, list(rules) → jobs, detail(job) → job.
 */

import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { htmlToText, encodedHtmlToText, relativeDateToIso, clean } from '../text.js';
import { canonicalUrl } from '../identity.js';

const regionName = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = code => { try { return code ? regionName.of(String(code).toUpperCase()) : ''; } catch (e) { return code; } };

class GreenhouseBoard {
  constructor(http, token) { this.http_ = http; this.token_ = token; }
  get kind() { return 'Greenhouse'; }

  async list() {
    const d = await this.http_.json('https://boards-api.greenhouse.io/v1/boards/' + this.token_ + '/jobs?content=true');
    return (d.jobs || []).map(j => ({
      jobId: 'gh:' + this.token_ + ':' + j.id,
      url: j.absolute_url,
      title: clean(j.title),
      company: j.company_name || '',
      location: (j.location && j.location.name) || '',
      postedAt: j.first_published || j.updated_at || '',
      description: encodedHtmlToText(j.content),
    }));
  }

  async detail(job) { return job; }
}

class LeverBoard {
  constructor(http, site, apiHost) { this.http_ = http; this.site_ = site; this.apiHost_ = apiHost; }
  get kind() { return 'Lever'; }

  async list() {
    const posts = await this.http_.json('https://' + this.apiHost_ + '/v0/postings/' + this.site_ + '?mode=json');
    return posts.map(p => ({
      jobId: 'lever:' + this.site_ + ':' + p.id,
      url: p.hostedUrl,
      title: clean(p.text),
      location: [].concat(p.categories && (p.categories.allLocations || p.categories.location) || []).join(' / '),
      workMode: p.workplaceType && p.workplaceType !== 'unspecified' ? p.workplaceType : '',
      postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : '',
      description: [p.descriptionPlain]
        .concat((p.lists || []).map(l => l.text + '\n' + htmlToText(l.content)))
        .concat([p.additionalPlain]).filter(Boolean).join('\n\n'),
    }));
  }

  async detail(job) { return job; }
}

class AshbyBoard {
  constructor(http, name) { this.http_ = http; this.name_ = name; }
  get kind() { return 'Ashby'; }

  async list() {
    const d = await this.http_.json('https://api.ashbyhq.com/posting-api/job-board/' + this.name_);
    return (d.jobs || []).filter(j => j.isListed !== false).map(j => ({
      jobId: 'ashby:' + this.name_ + ':' + j.id,
      url: j.jobUrl,
      title: clean(j.title),
      location: [j.location].concat((j.secondaryLocations || []).map(l => l.location)).filter(Boolean).join(' / '),
      workMode: j.workplaceType || (j.isRemote ? 'Remote' : ''),
      postedAt: j.publishedAt || '',
      description: j.descriptionPlain || htmlToText(j.descriptionHtml),
    }));
  }

  async detail(job) { return job; }
}

class SmartRecruitersBoard {
  constructor(http, company, maxItems = 500) { this.http_ = http; this.company_ = company; this.maxItems_ = maxItems; }
  get kind() { return 'SmartRecruiters'; }

  async list() {
    const out = [];
    for (let offset = 0; offset < this.maxItems_; offset += 100) {
      const d = await this.http_.json('https://api.smartrecruiters.com/v1/companies/' + this.company_ +
        '/postings?limit=100&offset=' + offset);
      (d.content || []).forEach(p => {
        const loc = p.location || {};
        out.push({
          jobId: 'sr:' + this.company_ + ':' + p.id,
          url: 'https://jobs.smartrecruiters.com/' + this.company_ + '/' + p.id,
          title: clean(p.name),
          location: loc.fullLocation || [loc.city, loc.region, countryName(loc.country)].filter(Boolean).join(', '),
          workMode: loc.remote ? 'Remote' : loc.hybrid ? 'Hybrid' : '',
          postedAt: p.releasedDate || '',
          ref: p.ref,
        });
      });
      if (offset + 100 >= (d.totalFound || 0)) break;
    }
    return out;
  }

  async detail(job) {
    const d = await this.http_.json(job.ref);
    const sections = (d.jobAd && d.jobAd.sections) || {};
    const description = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
      .map(k => sections[k]).filter(s => s && s.text)
      .map(s => (s.title ? s.title + '\n' : '') + htmlToText(s.text)).join('\n\n');
    return { ...job, description };
  }
}

class WorkdayBoard {
  constructor(http, host, tenant, site, maxItemsPerSearch = 100) {
    this.http_ = http; this.host_ = host; this.tenant_ = tenant; this.site_ = site;
    this.maxItems_ = maxItemsPerSearch;
    this.api_ = 'https://' + host + '/wday/cxs/' + tenant + '/' + site;
  }
  get kind() { return 'Workday'; }

  /**
   * Workday has thousands of jobs at big companies, so search by keyword and
   * narrow by the board's own location filter instead of listing everything.
   */
  async list(rules) {
    const appliedFacets = rules.location ? await this.locationFacets_(rules.location) : {};
    if (!appliedFacets) return []; // the board has location filters, and none match: no jobs there
    const searches = rules.keywords && rules.keywords.length ? rules.keywords : [''];
    const out = [];
    for (const searchText of searches) {
      let total = 0;
      for (let offset = 0; offset < this.maxItems_; offset += 20) {
        const d = await this.http_.postJson(this.api_ + '/jobs', { appliedFacets, limit: 20, offset, searchText });
        if (offset === 0) total = d.total || 0; // Workday only sends the total on the first page
        const posts = d.jobPostings || [];
        posts.forEach(p => out.push({
          jobId: 'wd:' + this.tenant_ + ':' + ((p.bulletFields && p.bulletFields[0]) || p.externalPath),
          url: 'https://' + this.host_ + '/' + this.site_ + p.externalPath,
          title: clean(p.title),
          location: p.locationsText || '',
          postedAt: relativeDateToIso(p.postedOn),
          path: p.externalPath,
        }));
        if (posts.length < 20 || offset + 20 >= total) break;
      }
    }
    return out;
  }

  /** @return {Promise<object|null>} {} if the board has no location filter, null if none matches */
  async locationFacets_(location) {
    const d = await this.http_.postJson(this.api_ + '/jobs', { appliedFacets: {}, limit: 1, offset: 0, searchText: '' });
    const want = location.toLowerCase();
    const byParam = {};
    const walk = facets => (facets || []).forEach(f => {
      const values = f.values || [];
      if (values.length && values[0].facetParameter) return walk(values);
      if (!/location|country|region|site/i.test(f.facetParameter + ' ' + (f.descriptor || ''))) return;
      values.filter(v => String(v.descriptor || '').toLowerCase().includes(want)).forEach(v => {
        const p = byParam[f.facetParameter] = byParam[f.facetParameter] || { ids: [], count: 0 };
        p.ids.push(v.id);
        p.count += v.count || 0;
      });
    });
    walk(d.facets);
    const hasLocationFacets = JSON.stringify(d.facets || []).match(/"facetParameter":"[^"]*(location|country|region|site)/i);
    const best = Object.entries(byParam).sort((a, b) => b[1].count - a[1].count)[0];
    if (best) return { [best[0]]: best[1].ids };
    return hasLocationFacets ? null : {};
  }

  async detail(job) {
    const d = await this.http_.json(this.api_ + job.path);
    const j = d.jobPostingInfo || {};
    return {
      ...job,
      url: j.externalUrl || job.url,
      location: [j.location].concat(j.additionalLocations || []).filter(Boolean).join(' / ') || job.location,
      description: (j.timeType ? 'Work type: ' + j.timeType + '\n\n' : '') + htmlToText(j.jobDescription),
    };
  }
}

/** @return {object|null} a board adapter for a known ATS URL */
export function detectBoard(http, url) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  const host = u.host.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);

  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const token = u.searchParams.get('for') ||
      (host.startsWith('boards-api.') ? parts[2] : parts.find(p => p !== 'embed' && p !== 'job_board'));
    if (token) return new GreenhouseBoard(http, token);
  }
  if (/^jobs\.(eu\.)?lever\.co$/.test(host) && parts[0]) {
    return new LeverBoard(http, parts[0], host.replace(/^jobs\./, 'api.'));
  }
  if (host === 'jobs.ashbyhq.com' && parts[0]) return new AshbyBoard(http, parts[0]);
  if (/^(jobs|careers)\.smartrecruiters\.com$/.test(host) && parts[0]) return new SmartRecruitersBoard(http, parts[0]);

  const wd = host.match(/^([^.]+)\.wd\d+\.myworkdayjobs\.com$/);
  if (wd) {
    const site = parts.find(p => !/^[a-z]{2}-[A-Z]{2}$/.test(p) && p !== 'wday' && p !== 'cxs' && p !== wd[1]);
    if (site) return new WorkdayBoard(http, host, wd[1], site);
  }
  return null;
}

/** Job-board links that careers pages often embed or link to. */
const EMBEDDED_BOARD_PATTERNS = [
  /https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?[\w-]+/i,
  /https?:\/\/jobs\.(?:eu\.)?lever\.co\/[\w-]+/i,
  /https?:\/\/jobs\.ashbyhq\.com\/[\w.-]+/i,
  /https?:\/\/(?:jobs|careers)\.smartrecruiters\.com\/[\w-]+/i,
  /https?:\/\/[\w-]+\.wd\d+\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?[\w-]+/,
];

const LINK_PROMPT = [
  'You read a company careers page. From the numbered links, pick only links that open ONE specific job posting',
  '(not job categories, search pages, departments, login, blog, or general career info).',
  'Reply with ONLY a JSON array, no markdown: [{"n": <link number>, "title": "job title", "location": "location or empty"}].',
  'Reply [] if there are none.',
].join('\n');

const MAX_LINKS = 300;

/** Any other careers page: find job links with the LLM, then read each posting's page. */
class GenericCareersPage {
  constructor(http, llm, url) { this.http_ = http; this.llm_ = llm; this.url_ = url; this.board_ = null; }
  get kind() { return this.board_ ? this.board_.kind + ' (found on page)' : 'Web page'; }

  async list(rules) {
    const html = await this.http_.text(this.url_);
    for (const re of EMBEDDED_BOARD_PATTERNS) {
      const m = html.match(re);
      const board = m && detectBoard(this.http_, m[0].replace(/&amp;/g, '&'));
      if (board) {
        this.board_ = board;
        return board.list(rules);
      }
    }

    const $ = cheerio.load(html);
    const seen = new Set();
    const links = [];
    $('a[href]').each((_, el) => {
      let href;
      try { href = new URL($(el).attr('href'), this.url_).href; } catch (e) { return; }
      const text = clean($(el).text() || $(el).attr('title') || $(el).attr('aria-label'));
      if (!/^https?:/.test(href) || !text || seen.has(href)) return;
      seen.add(href);
      links.push({ href, text: text.slice(0, 150) });
    });
    if (links.length < 3) {
      throw new Error('page has almost no links; it probably builds its job list with JavaScript, which needs a browser (not supported yet)');
    }
    if (!this.llm_.available) throw new Error('not a known job board, and LLM_API_KEY is not set to read the page');

    const shown = links.slice(0, MAX_LINKS);
    const picks = await this.llm_.json(LINK_PROMPT,
      'Careers page: ' + this.url_ + '\n\nLinks:\n' + shown.map((l, i) => i + '. ' + l.text + ' -> ' + l.href).join('\n'));
    return [].concat(picks || []).filter(p => shown[p.n]).map(p => ({
      jobId: 'web:' + createHash('sha1').update(canonicalUrl(shown[p.n].href)).digest('hex').slice(0, 12),
      url: shown[p.n].href,
      title: clean(p.title || shown[p.n].text),
      location: clean(p.location),
      postedAt: '',
    }));
  }

  async detail(job) {
    if (this.board_) return this.board_.detail(job);
    const $ = cheerio.load(await this.http_.text(job.url));
    const posting = findJobPostingLd($);
    if (posting) {
      const addr = [].concat(posting.jobLocation || []).map(l => l && l.address).filter(Boolean)
        .map(a => [a.addressLocality, a.addressRegion, countryName(a.addressCountry && (a.addressCountry.name || a.addressCountry))]
          .filter(Boolean).join(', '));
      return {
        ...job,
        title: clean(posting.title) || job.title,
        location: addr.join(' / ') || job.location,
        workMode: posting.jobLocationType === 'TELECOMMUTE' ? 'Remote' : '',
        postedAt: posting.datePosted || '',
        description: htmlToText(posting.description),
      };
    }
    $('nav, header, footer, script, style, noscript, form').remove();
    return { ...job, description: htmlToText($('main').html() || $('article').html() || $('body').html()) };
  }
}

/** schema.org JobPosting embedded in the page, which many careers sites include for Google Jobs. */
function findJobPostingLd($) {
  let found = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (found) return;
    try {
      const data = JSON.parse($(el).contents().text());
      const items = [].concat(data['@graph'] || data);
      found = items.find(x => x && [].concat(x['@type']).includes('JobPosting')) || null;
    } catch (e) { /* ignore malformed blocks */ }
  });
  return found;
}

/** One row of the Companies tab as a scrape source. */
export class CompanySource {
  /** @param {{company:string, url:string, keywords:string[], location:string}} row */
  constructor(http, llm, row) {
    this.row_ = row;
    this.board_ = detectBoard(http, row.url) || new GenericCareersPage(http, llm, row.url);
    this.rules = { keywords: row.keywords, location: row.location };
  }

  get label() { return 'Careers: ' + (this.row_.company || this.row_.url) + ' [' + this.board_.kind + ']'; }

  async search() {
    return (await this.board_.list(this.rules)).map(j => this.stamp_(j));
  }

  async detail(job) {
    return this.stamp_(await this.board_.detail(job));
  }

  stamp_(job) {
    return { ...job, source: 'Careers (' + this.board_.kind + ')', company: this.row_.company || job.company || '' };
  }
}
