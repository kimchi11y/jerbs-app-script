/**
 * repositories.js — the sheet tabs the scraper reads and writes.
 * The job sheet layout must match JOB_COLUMNS in src/Config.gs.
 */

import { sheetRef } from './sheets.js';
import { identitiesOf } from './identity.js';

/** Same order as src/Config.gs JOB_COLUMNS (columns 1–7 are what the capture extension writes). */
const JOB_ROW = ['capturedAt', 'url', 'jobId', 'workMode', 'company', 'location', 'description', 'title', 'source'];

const MAX_DESCRIPTION_CHARS = 20000; // the matcher trims to 12k; keep a little extra in the sheet

const timestamp = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
};

/** The job sheet: reads what's already there, appends new jobs. */
export class JobSheet {
  constructor(sheets, name) {
    this.sheets_ = sheets;
    this.name_ = name;
  }

  /** @return {Promise<Set<string>>} identities of every job already in the sheet */
  async existingIdentities() {
    const titles = await this.sheets_.sheetTitles();
    if (!titles.includes(this.name_)) {
      throw new Error('Tab "' + this.name_ + '" not found. Set JOB_SHEET_NAME in scraper/.env to one of: ' + titles.join(', '));
    }
    const rows = await this.sheets_.get(sheetRef(this.name_) + '!B:C');
    const set = new Set();
    rows.forEach(([url, jobId]) => identitiesOf({ url, jobId }).forEach(id => set.add(id)));
    return set;
  }

  async append(jobs) {
    const now = timestamp();
    const rows = jobs.map(j => JOB_ROW.map(k => {
      if (k === 'capturedAt') return now;
      if (k === 'description') return String(j.description || '').slice(0, MAX_DESCRIPTION_CHARS);
      return String(j[k] ?? '');
    }));
    await this.sheets_.append(sheetRef(this.name_) + '!A1', rows);
  }
}

const COMPANY_HEADERS = ['Company', 'Careers URL', 'Title keywords (comma-separated, blank = any)',
  'Location contains (blank = any)', 'Enabled'];

/** The Companies tab: one careers page per row, editable from the sheet. */
export class CompaniesSheet {
  constructor(sheets, name) {
    this.sheets_ = sheets;
    this.name_ = name;
  }

  /** @return {Promise<{company:string, url:string, keywords:string[], location:string}[]>} */
  async list() {
    const titles = await this.sheets_.sheetTitles();
    if (!titles.includes(this.name_)) {
      await this.sheets_.addSheet(this.name_, COMPANY_HEADERS);
      return [];
    }
    return (await this.sheets_.get(sheetRef(this.name_) + '!A2:E'))
      .map(([company, url, keywords, location, enabled]) => ({
        company: String(company || '').trim(),
        url: String(url || '').trim(),
        keywords: String(keywords || '').split(',').map(s => s.trim()).filter(Boolean),
        location: String(location || '').trim(),
        enabled: !/^(false|no|off|0)$/i.test(String(enabled || '').trim()),
      }))
      .filter(c => c.enabled && /^https?:\/\//i.test(c.url));
  }
}

const LOG_HEADERS = ['Run at', 'Source', 'Found', 'New', 'Filtered out', 'Added', 'Problem'];

/** The Scrape log tab: one row per source per run, so a silently broken source shows up. */
export class ScrapeLog {
  constructor(sheets, name) {
    this.sheets_ = sheets;
    this.name_ = name;
  }

  async write(entries) {
    const titles = await this.sheets_.sheetTitles();
    if (!titles.includes(this.name_)) await this.sheets_.addSheet(this.name_, LOG_HEADERS);
    const now = timestamp();
    await this.sheets_.append(sheetRef(this.name_) + '!A1',
      entries.map(e => [now, e.source, e.found, e.fresh, e.filtered, e.added, e.problem]));
  }
}
