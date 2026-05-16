import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const CRAWL_TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS) || 20000;
const REACHABILITY_TIMEOUT_MS = Number(process.env.REACHABILITY_TIMEOUT_MS) || Math.min(7000, CRAWL_TIMEOUT_MS);
const USER_AGENT = 'Just-DDL-Crawler/1.0 (+https://just-agent.github.io/just-ddl/)';

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim().slice(0, 200) : null;
}

function fetchViaPowerShell(url) {
  if (process.platform !== 'win32') return null;
  const timeoutSec = Math.max(15, Math.ceil(CRAWL_TIMEOUT_MS / 1000) + 5);
  const escapedUrl = url.replace(/'/g, "''");
  const script = "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); (Invoke-WebRequest -Uri '" + escapedUrl + "' -UseBasicParsing -TimeoutSec " + timeoutSec + " -Headers @{ 'User-Agent'='Mozilla/5.0'; 'Accept-Language'='en-US,en;q=0.9' }).Content";
  for (const command of ['pwsh', 'powershell']) {
    const result = spawnSync(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: (timeoutSec + 5) * 1000
    });
    if (result.status === 0 && result.stdout && result.stdout.trim().length > 1000) {
      return result.stdout;
    }
  }
  return null;
}

async function fetchSourcePage(source) {
  const report = {
    sourceId: source.id,
    source: source.name,
    url: source.url,
    items: [],
    reachable: false,
    httpStatus: null,
    finalUrl: null,
    title: null,
    contentLength: null,
    fetchedAt: new Date().toISOString(),
    note: 'Source reachability check only; curated data/items.json preserved until item parser is implemented.',
    error: null
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);
    const res = await fetch(source.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT }
    });
    clearTimeout(timer);
    report.httpStatus = res.status;
    report.finalUrl = res.url;
    const text = await res.text();
    report.contentLength = text.length;
    report.title = extractTitle(text);
    report.reachable = res.status >= 200 && res.status < 400;
    report.note = report.reachable
      ? 'Source reachable. Curated data/items.json preserved until item parser is implemented.'
      : `Source returned HTTP ${res.status}. Curated data/items.json preserved.`;
  } catch (err) {
    report.error = err.name === 'AbortError' ? `Timeout after ${REACHABILITY_TIMEOUT_MS}ms` : err.message;
    report.note = `Source fetch failed: ${report.error}. Curated data/items.json preserved.`;
  }
  return report;
}

const CHEVENING_URL = 'https://www.chevening.org/scholarships/application-timeline/';
const CHEVENING_MIN_ITEMS = 1;
const CHEVENING_MAX_FUTURE_DAYS = Number(process.env.CHEVENING_MAX_FUTURE_DAYS) || 400;

function cheveningDecode(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function cheveningStripHtml(value) {
  return cheveningDecode(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cheveningSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseCheveningDate(dateStr) {
  // Match exact dates like "9 July 2026", "1 November 2025"
  // Reject fuzzy dates like "Mid-June 2026", "September/October 2026"
  const text = String(dateStr || '').trim();
  if (/mid|early|late|\//i.test(text)) return null;
  const months = { january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11 };
  const match = text.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
  if (!match) return null;
  const day = Number(match[1]);
  const month = months[match[2].toLowerCase()];
  const year = Number(match[3]);
  if (month === undefined || !day || !year) return null;
  return new Date(Date.UTC(year, month, day, 23, 59, 59));
}

async function parseCheveningItems() {
  const report = {
    sourceId: 'chevening',
    source: 'Chevening Scholarships',
    url: CHEVENING_URL,
    items: [],
    reachable: false,
    httpStatus: null,
    finalUrl: null,
    title: null,
    contentLength: null,
    fetchedAt: new Date().toISOString(),
    note: 'Chevening application timeline parser.',
    error: null,
    parsedItemCount: 0,
    invalidItemCount: 0,
    parserHealthy: false
  };
  try {
    let text;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CRAWL_TIMEOUT_MS);
      const res = await fetch(CHEVENING_URL, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }
      });
      clearTimeout(timer);
      report.httpStatus = res.status;
      report.finalUrl = res.url;
      text = await res.text();
      report.reachable = res.status >= 200 && res.status < 400;
    } catch (fetchErr) {
      const fallbackText = fetchViaPowerShell(CHEVENING_URL);
      if (!fallbackText) throw fetchErr;
      text = fallbackText;
      report.httpStatus = 200;
      report.finalUrl = CHEVENING_URL;
      report.reachable = true;
      report.note = 'Fetched Chevening with Windows PowerShell fallback after Node fetch failed.';
    }
    report.contentLength = text.length;
    report.title = (text.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || null;

    if (!report.reachable) {
      report.note = 'Chevening returned HTTP ' + report.httpStatus + '. No items parsed.';
      return report;
    }

    // The official Chevening timeline renders one .event per milestone:
    // event-year-title carries the date and event-content-title carries the stage.
    const eventRe = /<div\s+class="event"[^>]*>([\s\S]*?)(?=<div\s+class="event"[^>]*>|$)/gi;
    const seen = new Set();
    let m;
    while ((m = eventRe.exec(text)) !== null) {
      const block = m[1];
      const dateText = cheveningStripHtml((block.match(/<h2\s+class="event-year-title"[^>]*>([\s\S]*?)<\/h2>/i) || [])[1]);
      const stage = cheveningStripHtml((block.match(/<h3\s+class="event-content-title"[^>]*>([\s\S]*?)<\/h3>/i) || [])[1]);
      if (!dateText || !stage) {
        report.invalidItemCount += 1;
        continue;
      }

      const dateMatch = dateText.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
      if (!dateMatch) {
        report.invalidItemCount += 1;
        continue;
      }

      const dateStr = dateMatch[0];
      const deadlineDate = parseCheveningDate(dateStr);
      if (!deadlineDate || isNaN(deadlineDate.getTime())) {
        report.invalidItemCount += 1;
        continue;
      }

      const daysFromNow = (deadlineDate.getTime() - Date.now()) / 86400000;
      if (daysFromNow < -7 || daysFromNow > CHEVENING_MAX_FUTURE_DAYS) {
        report.invalidItemCount += 1;
        continue;
      }

      const id = 'chevening-' + cheveningSlug(stage + '-' + dateStr);
      if (seen.has(id)) continue;
      seen.add(id);

      report.items.push({
        id,
        title: 'Chevening - ' + stage,
        deadline: deadlineDate.toISOString().replace('.000Z', 'Z'),
        dateRange: dateStr,
        location: 'Online',
        isOnline: true,
        tags: ['scholarship', 'Chevening', 'UK'],
        url: CHEVENING_URL,
        status: 'upcoming',
        description: 'Parsed from the official Chevening application timeline.',
        stage: stage,
        source: 'Chevening Scholarships',
        type: 'program'
      });
    }

    report.items.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    report.parsedItemCount = report.items.length;
    report.parserHealthy = report.parsedItemCount >= CHEVENING_MIN_ITEMS;
    report.note = 'Parsed ' + report.parsedItemCount + ' items from Chevening timeline; rejected ' + report.invalidItemCount + ' entries.';
  } catch (err) {
    report.error = err.name === 'AbortError' ? 'Timeout after ' + CRAWL_TIMEOUT_MS + 'ms' : err.message;
    report.note = 'Chevening fetch failed: ' + report.error;
  }
  return report;
}

async function cheveningAdapter() {
  return parseCheveningItems();
}
async function cscAdapter() {
  return fetchSourcePage({ id: "csc", name: "国家留学基金委", url: "https://www.csc.edu.cn" });
}

async function daadAdapter() {
  return fetchSourcePage({ id: "daad", name: "DAAD", url: "https://www.daad.de" });
}

async function fulbrightAdapter() {
  return fetchSourcePage({ id: "fulbright", name: "Fulbright", url: "https://foreign.fulbrightonline.org" });
}

async function mscaAdapter() {
  return fetchSourcePage({ id: "marie-curie", name: "Marie Sklodowska-Curie Actions", url: "https://marie-sklodowska-curie-actions.ec.europa.eu" });
}

const adapters = [cscAdapter, daadAdapter, fulbrightAdapter, mscaAdapter, cheveningAdapter];
const existingItemsUrl = new URL('../data/items.json', import.meta.url);
const existingItems = JSON.parse(fs.readFileSync(existingItemsUrl, 'utf8'));
let previousParsedItemCount = null;
try {
  const previousReport = JSON.parse(fs.readFileSync(new URL('../data/crawl-report.json', import.meta.url), 'utf8'));
  previousParsedItemCount = previousReport.parsedItemCount ?? null;
} catch {}
const reports = await Promise.all(adapters.map(adapter => adapter()));

const harvestedItems = reports.flatMap(report => report.items);
const parsedItemCount = reports.reduce((s, r) => s + (r.parsedItemCount || 0), 0);
const parserHealthy = reports.every(r => r.parserHealthy !== false);
const parserDropOk = previousParsedItemCount === null || parsedItemCount >= Math.floor(previousParsedItemCount * 0.5);
if (harvestedItems.length >= CHEVENING_MIN_ITEMS && parserHealthy && parserDropOk) {
  fs.writeFileSync(existingItemsUrl, JSON.stringify(harvestedItems, null, 2) + '\n', 'utf8');
  console.log('crawler wrote ' + harvestedItems.length + ' fetched items');
} else {
  console.log('parser emitted ' + harvestedItems.length + ' items (health gate failed or threshold not met); preserving ' + existingItems.length + ' curated items in data/items.json');
}

const reachableCount = reports.filter(r => r.reachable).length;
console.log('reachability: ' + reachableCount + '/' + reports.length + ' sources reachable');
if (parsedItemCount > 0) console.log('parsedItemCount: ' + parsedItemCount);

fs.writeFileSync(new URL('../data/crawl-report.json', import.meta.url), JSON.stringify({
  topicId: "scholarship-ddl",
  generatedAt: new Date().toISOString(),
  adapterCount: reports.length,
  reachableCount,
  parsedItemCount,
  previousParsedItemCount,
  parserHealthy,
  parserDropOk,
  adapters: reports
}, null, 2) + '\n', 'utf8');
