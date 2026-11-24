# How Jerb Matcher works

Jerb Matcher has two halves that never talk to each other directly. They share one Google Sheet.

| Half | Where it runs | Job |
|---|---|---|
| **Scraper** (`scraper/`) | Your Mac, on a schedule | Finds internship postings and adds them as rows to the job sheet |
| **Matcher** (`src/`, Apps Script) | Google's servers, hourly | Sends each new row plus your resume to an LLM and writes a verdict to **Matches** |

Because the sheet sits in the middle, either half can fail or be switched off without breaking the other.
Jobs you capture by hand with the browser extension go into the same sheet and are treated the same way.

```
                          ┌──────────────────── Google Sheet ─────────────────────┐
 Browser extension ─────▶ │  Job sheet tab   (one row per job)                    │
   (manual capture)       │                                                       │
                          │  Companies tab   (careers pages you want checked)     │
 Scraper on your Mac ───▶ │  Scrape log tab  (one row per source per run)         │
   08:00 12:00 …          │                                                       │
                          │  Matches tab     (verdict per job)  ◀── Matcher       │
                          │  _Resume (hidden)                         (hourly)     │
                          └───────────────────────────────────────────────────────┘
```

---

## 1. The scraper

### When it runs

Only when you run it: `cd scraper && npm run scrape`, or `npm run scrape:dry` to see what it would add without
writing anything.

A schedule is optional. `npm run schedule:install` registers a macOS launchd job
(`~/Library/LaunchAgents/com.jerbmatcher.scraper.plist`) that runs at 08:00, 12:00, 16:00 and 20:00.
If the Mac is asleep at one of those times, it runs once on wake. Output goes to `scraper/logs/scrape.log`.
`npm run schedule:remove` turns it off again.

### What one run does

```
 1. Load settings        config.json (searches, filters)  +  .env (sheet ID, keys)
 2. Read the sheet       every URL and job ID already in the job sheet  →  "known" list
                         every enabled row in the Companies tab         →  extra sources
 3. For each source:
      a. search          ask the site for a list of postings (title, company, link, date)
      b. skip known      drop anything already in the sheet, or already seen this run
      c. filter #1       title must look like an internship; posting must be ≤ 30 days old
      d. fetch detail    download the full job description (one request per job)
      e. filter #2       must have a real description; must match the company's location rule
      f. append          add the surviving jobs to the bottom of the job sheet
 4. Log                  write one row per source to the Scrape log tab, print a summary table
```

The cheap filter (c) runs **before** fetching details (d), so jobs that are obviously wrong never cost a request.
A run stops adding jobs once it reaches `maxNewJobsPerRun` (80). This caps how much the matcher has to analyze.

### The sources

| Source | Where its jobs come from | Set up in |
|---|---|---|
| **JobStreet MY** | The JSON search API and GraphQL "job details" query that JobStreet's own website calls. The job pages themselves block scripts, so they're never loaded. | `config.json` → `jobstreet.searches` |
| **LinkedIn** | LinkedIn's public, logged-out job search endpoints. No account, no cookies. Limited to the Internship experience level (`f_E=1`). | `config.json` → `linkedin.searches` |
| **Company careers pages** | One source per row in the **Companies** tab. See below. | Companies tab in the sheet |

#### How a careers page is read

The scraper looks at the **Careers URL** and picks the first approach that works:

1. **A known job board in the URL.** Greenhouse, Lever, Ashby, SmartRecruiters and Workday all have public JSON feeds,
   which are fast and reliable. For Workday, the **Title keywords** are used as the search text and **Location contains**
   uses Workday's own location filter. Fill both in for big companies.
2. **A known job board embedded in the page.** Many company sites are just a wrapper around one of the boards above.
   The scraper finds the embedded board link and uses its feed.
3. **Anything else.** The page's links are sent to your LLM (`LLM_API_KEY` in `.env`), which picks the ones that are
   individual job postings. Each posting page is then read, using the structured "JobPosting" data many sites include
   for Google, or the page text otherwise.

Pages that build their job list with JavaScript can't be read yet. The Scrape log says so when that happens.

### Filters (`config.json` → `filters`)

| Setting | Current value | Effect |
|---|---|---|
| `includeTitle` | intern / internship / industrial training / latihan industri / practical trainee | Title must match one of these, or the job is skipped |
| `excludeTitle` | none | Title must match none of these |
| `maxAgeDays` | 30 | Older postings are skipped (when the site gives a date) |
| Company **Title keywords** | per row | Title must contain one of them |
| Company **Location contains** | per row | Location must contain this text |

### Duplicates

Every job is identified by several keys: its job ID, its link without the query string, and the JobStreet or LinkedIn
number found inside the link. If any key is already in the sheet, the job is skipped. This works for rows
your extension captured too, even when their links look slightly different
(e.g. `…/job/95307438?ref=search` and `…/job/95307438` count as the same job).

What it **can't** catch:
- the same internship posted on JobStreet, LinkedIn **and** the company site (three different postings)
- a company deleting and reposting a job (new ID)
- a row you deleted from the sheet: the scraper only knows what's in the sheet now, so it may add the job again.
  To hide a job, move its row to another tab instead of deleting it.

### Staying polite (avoiding IP blocks)

- **Gaps between requests** to the same site, randomised between 0.7× and 1.6× of the base gap:
  LinkedIn ~3 s, JobStreet ~0.7 s, everything else ~0.8 s.
- **Back off when told to.** If a site answers `429`, `403` or `999`, the scraper stops contacting that site for the rest
  of the run and moves on to the other sources. The Scrape log shows "rate-limited or blocked". If the site sends a short
  `Retry-After` (≤ 60 s), the scraper waits once and tries again first.
- **Retries** on network errors and `5xx` server errors (2 retries, with a growing wait).
- **Never logged in.** A block only affects your IP's logged-out access for a while, never an account.

### What it writes

The scraper only **appends** to the end of the job sheet. It never edits, clears or deletes existing rows.

| Col | Field | Example |
|---|---|---|
| A | Captured at | `2026-10-21 08:00` |
| B | URL | `https://my.jobstreet.com/job/95307438` |
| C | Job ID | `95307438`, `gh:airbnb:7789554`, `wd:intel:JR0270001` |
| D | Work mode | `Remote`, `Hybrid` (blank if unknown) |
| E | Company | `Finexus Sdn Bhd` |
| F | Location | `Kuala Lumpur` |
| G | Description | full job description as plain text |
| H | Title | `Intern, Software Engineer` |
| I | Source | `JobStreet`, `LinkedIn`, `Careers (Workday)` |

Columns A–G match what the browser extension writes. H and I are extra; rows from the extension leave them blank.

---

## 2. The matcher (Apps Script)

### When it runs

- **Automatically:** after **Job Matcher → Turn on hourly auto-analyze**, a Google time trigger runs every hour.
  It runs as you, so it uses your saved API key. Turn it off with **Turn off auto-analyze**.
- **By hand:** **Analyze new jobs**, **Analyze selected rows**, or **Re-analyze all jobs** from the menu.

### What one run does

```
 1. Read the resume        from the hidden _Resume tab (saved via Settings)
 2. Find new jobs          rows in the job sheet with a URL and a description of 50+ characters
                           that don't yet have a non-error result in Matches
 3. Analyze in batches     5 jobs at a time, sent in parallel to the provider/model chosen in Settings
                           (DeepSeek, OpenAI, OpenRouter or Anthropic)
 4. Save                   one row per job in Matches; a re-analysis replaces that job's row
 5. Stop at 5 minutes      Apps Script allows 6; anything left over is picked up by the next run
```

The scheduled run takes a lock first, so two runs never overlap.

### What the LLM is asked

The LLM plays a Malaysian technical recruiter. It gets the job (title, company, location, description,
trimmed to 12,000 characters) and your resume, and must answer with:

| Field | Meaning |
|---|---|
| **Verdict** | **Should apply** (meets most must-haves), **Stretch** (misses one or two), **Cannot apply** (fails a hard requirement) |
| **Match score** | 0–100 |
| **Summary** | 2–3 sentences explaining the verdict |
| **Matched requirements / Gaps / Dealbreakers** | bullet lists |
| **Resume tips** | up to 3 honest changes to make for this job |

If the reply can't be read, or the API call fails, the row's verdict is **Error** with the reason in Summary.
Errored jobs count as "new" again, so the next run retries them.

> The prompt still judges like a full-time hire (e.g. years of experience). For internships it may be stricter than
> it should be.

---

## 3. Where things live

| What | Where | In git? |
|---|---|---|
| Searches, filters, run cap | `scraper/config.json` | yes |
| Sheet ID, job tab name, LLM key for careers pages | `scraper/.env` | **no** |
| Google service account key | `scraper/service-account.json` | **no** |
| Scraper run output | `scraper/logs/scrape.log` | **no** |
| Companies to check | **Companies** tab in the sheet | — |
| LLM provider, model, API key for matching | **Job Matcher → Settings** (key stored privately in your Google account) | — |
| Resume | **Job Matcher → Settings** (hidden `_Resume` tab) | — |

### Code map

```
scraper/src/
  index.js            entry point: reads config + .env, builds the sources, runs everything
  scrape-service.js   the per-source loop: search → skip known → filter → detail → filter → append
  sources/
    jobstreet.js      JobStreet search API + GraphQL details
    linkedin.js       LinkedIn guest endpoints
    careers.js        Greenhouse, Lever, Ashby, SmartRecruiters, Workday, generic page + LLM
  identity.js         the keys used to spot duplicates
  filters.js          title / age / location / description rules
  repositories.js     the job sheet, Companies tab and Scrape log tab
  sheets.js           Google Sheets API client (service account)
  http.js             polite HTTP: gaps, retries, back-off on blocks
  llm.js              OpenAI-compatible client for reading careers pages
  text.js             HTML → text, "Posted 3 days ago" → date

src/  (Apps Script)
  Code.gs             menu, hourly trigger, sidebar functions
  Matching.gs         prompt, reply parser, batch runner
  Llm.gs              the four LLM providers
  Repositories.gs     settings, resume, job sheet, Matches
  Config.gs           column layout, limits, verdict names
```

---

## 4. Everyday commands

```bash
cd scraper
npm run scrape:dry                  # preview, writes nothing
npm run scrape                      # run now
npm run scrape -- --only=careers    # one source type: jobstreet, linkedin, careers
tail -50 logs/scrape.log            # what the scheduled runs did
SCRAPE_HOURS="9 18" npm run schedule:install   # change the schedule
npm run schedule:remove             # stop the schedule

cd ..
clasp push                          # upload Apps Script changes (src/) to the sheet
```

## 5. When something looks wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Scrape log: `0 results` for several runs | The site changed its API, or your search is too narrow | Try the search on the website. If it finds jobs there, the scraper needs fixing |
| Scrape log: `rate-limited or blocked` | Too many requests to that site | Do nothing; it usually clears within hours. Run less often or use fewer LinkedIn searches |
| Scrape log: `needs a browser` | That careers page builds its list with JavaScript | Look for the company on a job board (e.g. a Workday or Greenhouse link) and use that URL |
| `Tab "…" not found` | `JOB_SHEET_NAME` in `.env` doesn't match the tab name | Copy the exact tab name |
| `The caller does not have permission` | The sheet isn't shared with the service account | Share it with the `client_email` from `service-account.json` as Editor |
| New rows never get a verdict | Auto-analyze is off, or there's no resume or key | Turn on auto-analyze; check Settings. Errors appear under Extensions → Apps Script → Executions |
