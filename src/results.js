import { readFile, writeFile, rename, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { validateQuotes } from './quotes.js';

export function resultPaths(jobId) {
  if (typeof jobId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(jobId)) {
    throw new Error('job_id must contain 1-80 letters, digits or hyphens');
  }
  const directory = process.env.RESULTS_DIR || '/results';
  return { final: join(directory, `${jobId}.json`), temporary: join(directory, `.${jobId}.tmp`) };
}

export async function readResult(path) {
  const quotes = JSON.parse(await readFile(path, 'utf8'));
  validateQuotes(quotes);
  return quotes;
}

export async function existingResult(path) {
  try {
    return await readResult(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

export async function saveResult(paths, quotes) {
  validateQuotes(quotes);
  try {
    await writeFile(paths.temporary, `${JSON.stringify(quotes, null, 2)}\n`, { mode: 0o644 });
    await chmod(paths.temporary, 0o644);
    await rename(paths.temporary, paths.final);
  } finally {
    await rm(paths.temporary, { force: true });
  }
}
