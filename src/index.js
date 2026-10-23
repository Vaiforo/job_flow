import { mkdir, rm, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { scrapeQuotes } from './scraper.js';

let browser;
try {
  await mkdir('out', { recursive: true });
  await rm('out/result.json', { force: true });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const quotes = await scrapeQuotes(page);
  await writeFile('out/result.json', `${JSON.stringify(quotes, null, 2)}\n`, 'utf8');
  console.log(`Saved ${quotes.length} quotes to out/result.json`);
} catch (error) {
  console.error('Scraping failed:', error);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
