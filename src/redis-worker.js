import { hostname } from 'node:os';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { scrapeQuotes } from './scraper.js';
import { connectRedis, ensureGroup, stream, group } from './redis-jobs.js';
import { resultPaths, existingResult, saveResult } from './results.js';

const readyFile = '/tmp/redis-worker-ready';
const control = process.env.CONTROL_DIR || '/control';
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

async function pauseBeforeAck(jobId) {
  let pausedJob;
  try {
    pausedJob = (await readFile(join(control, 'pause'), 'utf8')).trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (pausedJob !== jobId) return;
  await writeFile(join(control, 'reached'), jobId);
  // Used by fault-test to stop the process at a known point before acknowledgment.
  while ((await readFile(join(control, 'pause'), 'utf8').catch(() => '')).trim() === jobId) {
    await delay(200);
  }
}

async function processJob(client, entry) {
  const { job_id: jobId, url } = entry.message;
  const paths = resultPaths(jobId);
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Expected HTTP URL');
  await rm(paths.temporary, { force: true });
  let browser;
  let timeout;
  try {
    if (!(await existingResult(paths.final))) {
      browser = await chromium.launch({ headless: true });
      timeout = setTimeout(() => { browser.close().catch(() => {}); }, 120_000);
      const page = await browser.newPage();
      const quotes = await scrapeQuotes(page, target.href);
      await saveResult(paths, quotes);
    }
    await pauseBeforeAck(jobId);
    await client.xAck(stream, group, entry.id);
    console.log(`Completed ${jobId}: result saved, message acknowledged`);
  } finally {
    clearTimeout(timeout);
    await browser?.close();
  }
}

async function main() {
  await rm(readyFile, { force: true });
  const client = await connectRedis();
  try {
    await ensureGroup(client);
    await writeFile(readyFile, 'ready');
    let claimCursor = '0-0';
    while (!stopping) {
      try {
        const claimed = await client.xAutoClaim(stream, group, hostname(), 150_000, claimCursor, { COUNT: 1 });
        claimCursor = claimed.nextId;
        let messages = claimed.messages;
        if (messages.length === 0) {
          const batches = await client.xReadGroup(group, hostname(), [{ key: stream, id: '>' }], { COUNT: 1, BLOCK: 2000 });
          messages = batches?.[0]?.messages || [];
        }
        for (const entry of messages) await processJob(client, entry);
      } catch (error) {
        console.error('Job remains pending:', error.message);
        await delay(2000);
      }
    }
  } finally {
    await rm(readyFile, { force: true });
    await client.quit();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
