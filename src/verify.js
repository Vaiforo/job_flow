import { readFile } from 'node:fs/promises';
import { validateQuotes } from './quotes.js';

try {
  const quotes = JSON.parse(await readFile('out/result.json', 'utf8'));
  validateQuotes(quotes);
  console.log(`Verified ${quotes.length} quotes in out/result.json`);
} catch (error) {
  console.error('Result validation failed:', error.message);
  process.exitCode = 1;
}
