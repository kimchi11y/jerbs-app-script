/**
 * text.js — small helpers for turning job-board HTML and dates into plain values.
 */

import { decodeHTML } from 'entities';

/** Job description HTML → readable plain text with bullets and paragraphs kept. */
export function htmlToText(html) {
  return decodeHTML(String(html || '')
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, '')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n•(?=\n|$)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Some boards (Greenhouse) send entity-encoded HTML; decode it before converting. */
export const encodedHtmlToText = html => htmlToText(decodeHTML(String(html || '')));

/** "Posted Today" / "Posted 3 Days Ago" / "Posted 30+ Days Ago" → ISO date, or '' */
export function relativeDateToIso(text, now = new Date()) {
  const s = String(text || '').toLowerCase();
  let days = null;
  if (s.includes('today') || s.includes('just')) days = 0;
  else if (s.includes('yesterday')) days = 1;
  else {
    const m = s.match(/(\d+)\+?\s*day/);
    if (m) days = Number(m[1]);
  }
  if (days == null) return '';
  return new Date(now.getTime() - days * 86400000).toISOString();
}

export const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
