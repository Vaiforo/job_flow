import { validateQuotes } from './quotes.js';

export async function scrapeQuotes(page, url = 'https://quotes.toscrape.com/scroll') {
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(60_000);

  const isQuotesResponse = (response) =>
    new URL(response.url()).pathname === '/api/quotes' &&
    response.request().method() === 'GET';

  let [response] = await Promise.all([
    page.waitForResponse(isQuotesResponse),
    page.goto(url, { waitUntil: 'domcontentloaded' }),
  ]);
  let expectedCount = 0;

  for (let pageNumber = 1; ; pageNumber += 1) {
    if (!response.ok()) {
      throw new Error(`Quotes request failed: HTTP ${response.status()}`);
    }
    const data = await response.json();
    if (!Array.isArray(data.quotes) || typeof data.has_next !== 'boolean') {
      throw new Error('Unexpected quotes pagination response');
    }
    expectedCount += data.quotes.length;
    await page.waitForFunction(
      (count) => document.querySelectorAll('.quote').length === count,
      expectedCount,
    );
    await page.locator('#loading').waitFor({ state: 'hidden' });

    if (!data.has_next) break;
    if (data.quotes.length === 0 || pageNumber >= 100) {
      throw new Error('Pagination made no progress or exceeded 100 pages');
    }

    [response] = await Promise.all([
      page.waitForResponse(isQuotesResponse),
      page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)),
    ]);
  }

  const quotes = await page.locator('.quote').evaluateAll((elements) =>
    elements.map((element) => ({
      text: element.querySelector('.text')?.textContent?.trim() ?? '',
      author: element.querySelector('.author')?.textContent?.trim() ?? '',
      tags: Array.from(element.querySelectorAll('.tag'), (tag) => tag.textContent.trim()),
    })),
  );
  validateQuotes(quotes);
  return quotes;
}
