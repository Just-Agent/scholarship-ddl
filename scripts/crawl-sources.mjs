import fs from 'node:fs';

async function cscAdapter() {
  return {
    source: "国家留学基金委",
    url: "https://www.csc.edu.cn",
    items: [],
    note: 'TODO: implement parser for 国家留学基金委; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function daadAdapter() {
  return {
    source: "DAAD",
    url: "https://www.daad.de",
    items: [],
    note: 'TODO: implement parser for DAAD; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function fulbrightAdapter() {
  return {
    source: "Fulbright",
    url: "https://foreign.fulbrightonline.org",
    items: [],
    note: 'TODO: implement parser for Fulbright; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function mscaAdapter() {
  return {
    source: "Marie Sklodowska-Curie Actions",
    url: "https://marie-sklodowska-curie-actions.ec.europa.eu",
    items: [],
    note: 'TODO: implement parser for Marie Sklodowska-Curie Actions; keep data/items.json as curated fallback until parser is verified.'
  };
}

const adapters = [cscAdapter, daadAdapter, fulbrightAdapter, mscaAdapter];
const existingItemsUrl = new URL('../data/items.json', import.meta.url);
const existingItems = JSON.parse(fs.readFileSync(existingItemsUrl, 'utf8'));
const reports = [];

for (const adapter of adapters) {
  reports.push(await adapter());
}

const harvestedItems = reports.flatMap(report => report.items);
if (harvestedItems.length > 0) {
  fs.writeFileSync(existingItemsUrl, JSON.stringify(harvestedItems, null, 2) + '\n', 'utf8');
  console.log(`crawler wrote ${harvestedItems.length} fetched items`);
} else {
  console.log(`crawler adapters ran; no verified fetched items yet, preserving ${existingItems.length} curated items`);
}

fs.writeFileSync(new URL('../data/crawl-report.json', import.meta.url), JSON.stringify({
  generatedAt: new Date().toISOString(),
  topicId: "scholarship-ddl",
  adapters: reports
}, null, 2) + '\n', 'utf8');
