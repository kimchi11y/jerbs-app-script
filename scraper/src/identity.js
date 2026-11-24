/**
 * identity.js — the strings that identify a job, so a posting already in the
 * sheet (captured by the extension or scraped earlier) is never added twice.
 */

/** URL without query, hash or trailing slash, lower-cased host. */
export function canonicalUrl(url) {
  try {
    const u = new URL(String(url).trim());
    return (u.host.toLowerCase().replace(/^www\./, '') + u.pathname.replace(/\/+$/, '')).toLowerCase();
  } catch (e) {
    return '';
  }
}

/** Site-specific ids found in a URL, so differently-shaped links to one job still match. */
function idsFromUrl(url) {
  const ids = [];
  const s = String(url || '');
  let m = s.match(/jobstreet\.com\/(?:[a-z-]+\/)?job\/(\d+)/i);
  if (m) ids.push('jobstreet:' + m[1]);
  m = s.match(/linkedin\.com\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/i) || s.match(/[?&]currentJobId=(\d{6,})/i);
  if (m) ids.push('linkedin:' + m[1]);
  return ids;
}

/** @param {{jobId?:string, url?:string}} job @return {string[]} */
export function identitiesOf(job) {
  const out = [];
  if (job.jobId) out.push('id:' + String(job.jobId).trim().toLowerCase());
  const canon = canonicalUrl(job.url);
  if (canon) out.push('url:' + canon);
  return out.concat(idsFromUrl(job.url));
}
