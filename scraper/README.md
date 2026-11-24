# Jerb scraper

Finds new jobs and adds them as rows to the Jerb Matcher job sheet, in the same
layout the capture extension uses. The Apps Script matcher then analyzes them
(turn on **Job Matcher → Turn on hourly auto-analyze** in the sheet).

```
search → skip jobs already in the sheet → title/date filters → fetch full posting
       → location filter → append row
```

## Sources

| Source | How | Configure in |
|---|---|---|
| JobStreet MY | The JSON search and GraphQL APIs the site itself uses | `config.json` → `jobstreet.searches` |
| LinkedIn | Public logged-out job endpoints, 3 s between requests | `config.json` → `linkedin.searches` |
| Company careers pages | Greenhouse, Lever, Ashby, SmartRecruiters and Workday feeds; any other page is read by the LLM | **Companies** tab in the sheet |

LinkedIn's terms disallow scraping. Keep its searches few, and the scraper never uses your login.

## Setup (once)

1. **Install:** `cd scraper && npm install` (Node 22.9 or newer).
2. **Google service account** (lets the scraper write to the sheet):
   1. Go to https://console.cloud.google.com, create a project (any name), and enable the **Google Sheets API**.
   2. Go to **IAM & Admin → Service Accounts → Create service account**. Any name, no roles needed.
   3. Open it, then **Keys → Add key → JSON**. Save the file as `scraper/service-account.json`.
   4. In the Sheet, click **Share** and add the service account's email (`…@….iam.gserviceaccount.com`) as **Editor**.
3. **`.env`:** run `cp .env.example .env`, then fill in:
   - `SHEET_ID`: the part of the sheet URL between `/d/` and `/edit`
   - `JOB_SHEET_NAME`: the tab your extension writes to
   - `LLM_API_KEY`: your OpenRouter key. Only needed for careers pages that aren't on a known job board.
4. **Searches:** edit `config.json` (see below).
5. **Test:** run `npm run scrape:dry` (prints what it would add; writes nothing), then `npm run scrape`.
6. **Schedule:** `npm run schedule:install` runs it at 08:00, 12:00, 16:00 and 20:00.
   Use `SCRAPE_HOURS="9 18" npm run schedule:install` for other hours, and `npm run schedule:remove` to stop.
   The log is in `scraper/logs/scrape.log`.

## config.json

```jsonc
{
  "maxNewJobsPerRun": 80,                 // caps LLM spend per run
  "filters": {
    "maxAgeDays": 14,                     // skip older postings
    "includeTitle": [],                   // regexes; if set, title must match one
    "excludeTitle": ["\\bintern\\b"]      // regexes; title must match none
  },
  "jobstreet": { "enabled": true, "maxPages": 2,
                 "searches": [{ "keywords": "software engineer", "where": "Kuala Lumpur" }] },
  "linkedin":  { "enabled": true, "maxPages": 2,
                 "searches": [{ "keywords": "software engineer", "location": "Malaysia",
                                "params": { "f_WT": "2" } }] },   // optional: f_WT 1 on-site, 2 remote, 3 hybrid
  "companies": { "enabled": true, "sheetTab": "Companies", "extra": [] }
}
```

## Companies tab

The first run creates it. Add one row per company:

| Company | Careers URL | Title keywords | Location contains | Enabled |
|---|---|---|---|---|
| Intel | https://intel.wd1.myworkdayjobs.com/External | software, firmware | Malaysia | |
| Acme | https://careers.acme.com/jobs | engineer | Kuala Lumpur | |

- **Careers URL**: the job list page. Job-board URLs work best (`boards.greenhouse.io/x`,
  `jobs.lever.co/x`, `jobs.ashbyhq.com/x`, `jobs.smartrecruiters.com/x`, `x.wd3.myworkdayjobs.com/Site`).
  For a company's own site, the scraper looks for an embedded job board first, then asks the LLM which links are jobs.
- **Title keywords**: comma-separated. Leave blank to take every title (global filters still apply).
- **Location contains**: e.g. `Malaysia` or `Kuala Lumpur`.
- **Enabled**: `FALSE` to pause a row.

Some careers sites build their job list with JavaScript. The scraper can't read those yet, and says so in the log.

## Other commands

```bash
npm run scrape -- --only=careers            # one source type: jobstreet, linkedin, careers
npm run scrape:dry -- --only=jobstreet
```

Every run adds one row per source to the **Scrape log** tab. A source that keeps showing
`0 results` has probably changed its site.
