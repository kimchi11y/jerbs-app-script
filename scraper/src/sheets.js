/**
 * sheets.js — minimal Google Sheets v4 client authenticated as a service account.
 * The spreadsheet must be shared (Editor) with the service account's email.
 */

import { GoogleAuth } from 'google-auth-library';

/** A1 sheet reference with quotes, e.g. 'My Jobs' */
export const sheetRef = name => "'" + String(name).replace(/'/g, "''") + "'";

export class SheetsClient {
  constructor(spreadsheetId, keyFile) {
    if (!spreadsheetId) throw new Error('SHEET_ID is not set in scraper/.env');
    this.id_ = spreadsheetId;
    this.auth_ = new GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  }

  async sheetTitles() {
    const d = await this.call_('GET', '', undefined, { fields: 'sheets.properties.title' });
    return (d.sheets || []).map(s => s.properties.title);
  }

  async addSheet(title, headers) {
    await this.call_('POST', ':batchUpdate', { requests: [{ addSheet: { properties: { title } } }] });
    if (headers) await this.update(sheetRef(title) + '!A1', [headers]);
  }

  /** @return {string[][]} */
  async get(range) {
    const d = await this.call_('GET', '/values/' + encodeURIComponent(range));
    return d.values || [];
  }

  async update(range, rows) {
    await this.call_('PUT', '/values/' + encodeURIComponent(range), { values: rows }, { valueInputOption: 'RAW' });
  }

  async append(range, rows) {
    if (!rows.length) return;
    await this.call_('POST', '/values/' + encodeURIComponent(range) + ':append', { values: rows },
      { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' });
  }

  // ---- private

  async call_(method, path, data, params) {
    const client = await this.auth_.getClient();
    const res = await client.request({
      url: 'https://sheets.googleapis.com/v4/spreadsheets/' + this.id_ + path,
      method, data, params,
    });
    return res.data;
  }
}
