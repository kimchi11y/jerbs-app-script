/**
 * llm.js — OpenAI-compatible chat client (OpenRouter, DeepSeek, OpenAI…),
 * used only to read job links off careers pages that have no job-board API.
 */

export class LlmClient {
  /** @param {{baseUrl:string, apiKey:string, model:string}} opts @param {import('./http.js').HttpClient} http */
  constructor(opts, http) {
    this.opts_ = opts;
    this.http_ = http;
  }

  get available() { return !!this.opts_.apiKey; }

  /** @return {Promise<any>} the first JSON value in the model's reply */
  async json(system, user) {
    if (!this.available) throw new Error('LLM_API_KEY is not set in scraper/.env');
    const d = await this.http_.postJson(this.opts_.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      model: this.opts_.model,
      temperature: 0,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }, { Authorization: 'Bearer ' + this.opts_.apiKey, 'X-Title': 'Jerb Matcher scraper' });
    const text = String(d.choices?.[0]?.message?.content || '');
    const start = text.search(/[[{]/);
    const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'));
    if (start < 0 || end <= start) throw new Error('LLM reply had no JSON');
    return JSON.parse(text.slice(start, end + 1));
  }
}
