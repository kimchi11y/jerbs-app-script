/**
 * index.js — composition root. Reads config.json and .env, builds the sources
 * and runs the scrape.
 *
 *   npm run scrape                 add new jobs to the sheet
 *   npm run scrape:dry             print what would be added; writes nothing
 *   npm run scrape -- --only=jobstreet,careers
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpClient } from './http.js';
import { SheetsClient } from './sheets.js';
import { JobSheet, CompaniesSheet, ScrapeLog } from './repositories.js';
import { JobFilter } from './filters.js';
import { LlmClient } from './llm.js';
import { ScrapeService } from './scrape-service.js';
import { JobStreetSearch } from './sources/jobstreet.js';
import { LinkedInSearch } from './sources/linkedin.js';
import { CompanySource } from './sources/careers.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRAPE_LOG_TAB = 'Scrape log';

function parseArgs(argv) {
  const only = (argv.find(a => a.startsWith('--only=')) || '').slice(7);
  return { dryRun: argv.includes('--dry-run'), only: only ? only.split(',').map(s => s.trim().toLowerCase()) : null };
}

function createSheets(env) {
  const keyFile = resolve(ROOT, env.GOOGLE_SERVICE_ACCOUNT_FILE || './service-account.json');
  if (!env.SHEET_ID || !existsSync(keyFile)) return null;
  return new SheetsClient(env.SHEET_ID, keyFile);
}

async function createSources(config, http, llm, sheets, wanted) {
  const want = name => !wanted || wanted.includes(name);
  const sources = [];
  const maxAgeDays = config.filters && config.filters.maxAgeDays;

  if (config.jobstreet && config.jobstreet.enabled && want('jobstreet')) {
    config.jobstreet.searches.forEach(s =>
      sources.push(new JobStreetSearch(http, { maxPages: config.jobstreet.maxPages, ...s })));
  }
  if (config.linkedin && config.linkedin.enabled && want('linkedin')) {
    config.linkedin.searches.forEach(s =>
      sources.push(new LinkedInSearch(http, { maxPages: config.linkedin.maxPages, maxAgeDays, ...s })));
  }
  if (config.companies && config.companies.enabled && want('careers')) {
    const rows = (config.companies.extra || []).map(c => ({ keywords: [], location: '', ...c }));
    if (sheets) rows.push(...await new CompaniesSheet(sheets, config.companies.sheetTab || 'Companies').list());
    rows.forEach(row => sources.push(new CompanySource(http, llm, row)));
  }
  return sources;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = process.env;
  const config = JSON.parse(readFileSync(resolve(ROOT, 'config.json'), 'utf8'));

  const http = new HttpClient({
    defaultGapMs: 800,
    gaps: { 'linkedin.com': 3000, 'jobstreet.com': 700 },
  });
  const llm = new LlmClient({
    baseUrl: env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKey: env.LLM_API_KEY || '',
    model: env.LLM_MODEL || 'deepseek/deepseek-chat',
  }, http);

  const sheets = createSheets(env);
  if (!sheets && !args.dryRun) {
    throw new Error('Sheet access is not set up: set SHEET_ID and GOOGLE_SERVICE_ACCOUNT_FILE in scraper/.env (see scraper/README.md), ' +
      'or run "npm run scrape:dry" to test without the sheet.');
  }
  if (!sheets) console.log('Dry run without sheet access: every job counts as new, and the Companies tab is not read.');

  const jobSheet = sheets ? new JobSheet(sheets, env.JOB_SHEET_NAME || 'Sheet1') : null;
  const known = jobSheet ? await jobSheet.existingIdentities() : new Set();
  const sources = await createSources(config, http, llm, sheets, args.only);
  if (!sources.length) {
    console.log('Nothing to scrape: enable a source in config.json or add rows to the Companies tab.');
    return;
  }

  const service = new ScrapeService({
    jobSheet, known, filter: new JobFilter(config.filters),
    maxNewJobs: config.maxNewJobsPerRun || 80, dryRun: args.dryRun,
  });
  const summary = await service.run(sources);

  console.log('\n' + (args.dryRun ? 'DRY RUN — nothing written.\n' : ''));
  console.table(summary.map(s => ({ Source: s.source, Found: s.found, New: s.fresh, 'Filtered out': s.filtered, Added: s.added, Problem: s.problem })));
  if (sheets && !args.dryRun) await new ScrapeLog(sheets, SCRAPE_LOG_TAB).write(summary);
}

main().catch(e => {
  console.error('Scrape failed: ' + (e.stack || e.message));
  process.exitCode = 1;
});
