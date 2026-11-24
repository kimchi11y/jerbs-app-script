/**
 * http.js — polite HTTP: a browser-like User-Agent, a randomised gap between
 * requests to the same site, and retries on network errors and 5xx.
 *
 * When a site signals "slow down" (429, 403, LinkedIn's 999) the client stops
 * calling that site for the rest of the run instead of retrying, so a short
 * rate limit never escalates into a longer block.
 */

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const BLOCK_STATUSES = new Set([403, 429, 999]);
const MAX_RETRY_AFTER_MS = 60000; // honour a site's Retry-After once, if it's this short

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class HttpError extends Error {
  constructor(url, status, body) {
    super('HTTP ' + status + ' from ' + new URL(url).host + ': ' + String(body || '').slice(0, 200));
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Thrown for every request to a site that has already told us to back off this run. */
export class BlockedError extends Error {
  constructor(site, status) {
    super(site + ' answered HTTP ' + status + ' (rate-limited or blocked); stopped calling it for this run');
    this.name = 'BlockedError';
  }
}

/** "my.linkedin.com" → "linkedin.com", "careers.acme.com.my" → "acme.com.my" */
export function siteOf(host) {
  const parts = host.toLowerCase().split('.');
  const n = parts.length >= 3 && parts[parts.length - 1].length === 2 &&
    /^(com|co|net|org|gov|edu)$/.test(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-n).join('.');
}

export class HttpClient {
  /**
   * @param {{defaultGapMs?:number, gaps?:Object<string,number>, retries?:number, timeoutMs?:number}} opts
   *   gaps maps a site (e.g. "linkedin.com") to the typical ms between its requests
   */
  constructor(opts = {}) {
    this.defaultGapMs_ = opts.defaultGapMs ?? 800;
    this.gaps_ = opts.gaps || {};
    this.retries_ = opts.retries ?? 2;
    this.timeoutMs_ = opts.timeoutMs ?? 30000;
    this.lastHit_ = new Map();
    this.blocked_ = new Map(); // site → status that blocked it
  }

  /** @return {{site:string, status:number}[]} sites that told us to back off this run */
  blockedSites() {
    return [...this.blocked_].map(([site, status]) => ({ site, status }));
  }

  async request(url, init = {}) {
    const site = siteOf(new URL(url).host);
    for (let attempt = 0; ; attempt++) {
      if (this.blocked_.has(site)) throw new BlockedError(site, this.blocked_.get(site));
      await this.waitTurn_(site);
      let res;
      try {
        res = await fetch(url, {
          redirect: 'follow',
          ...init,
          headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-MY,en;q=0.9', ...init.headers },
          signal: AbortSignal.timeout(this.timeoutMs_),
        });
      } catch (e) {
        if (attempt < this.retries_) { await sleep(2000 * (attempt + 1)); continue; }
        throw new Error(url + ': ' + e.message);
      }

      if (BLOCK_STATUSES.has(res.status)) {
        const retryAfterMs = Number(res.headers.get('retry-after')) * 1000;
        if (res.status === 429 && attempt === 0 && retryAfterMs > 0 && retryAfterMs <= MAX_RETRY_AFTER_MS) {
          await sleep(retryAfterMs);
          continue;
        }
        this.blocked_.set(site, res.status);
        throw new BlockedError(site, res.status);
      }
      if (res.status >= 500 && attempt < this.retries_) {
        await sleep(5000 * (attempt + 1));
        continue;
      }
      return res;
    }
  }

  async text(url, init) {
    const res = await this.request(url, init);
    const body = await res.text();
    if (!res.ok) throw new HttpError(url, res.status, body);
    return body;
  }

  async json(url, init) {
    return JSON.parse(await this.text(url, { ...init, headers: { Accept: 'application/json', ...(init && init.headers) } }));
  }

  postJson(url, body, headers = {}) {
    return this.json(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  // ---- private

  /** Waits between 0.7× and 1.6× the site's gap, so requests don't arrive on a fixed beat. */
  async waitTurn_(site) {
    const gap = (this.gaps_[site] ?? this.defaultGapMs_) * (0.7 + Math.random() * 0.9);
    const wait = (this.lastHit_.get(site) || 0) + gap - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastHit_.set(site, Date.now());
  }
}
