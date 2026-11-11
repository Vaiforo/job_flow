import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { connectRedis, stream, group, ensureGroup } from './redis-jobs.js';
import { resultPaths, readResult } from './results.js';

const deadline = setTimeout(() => {
  console.error('Redis command timed out');
  process.exit(1);
}, 10_000);
const client = await connectRedis();
try {
  await ensureGroup(client);
  const command = process.argv[2];
  if (command === 'enqueue') {
    const jobId = process.argv[4] || randomUUID();
    resultPaths(jobId);
    const url = new URL(process.argv[3]);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Expected an HTTP URL');
    const messageId = await client.xAdd(stream, '*', { job_id: jobId, url: url.href });
    console.log(JSON.stringify({ job_id: jobId, url: url.href, message_id: messageId }));
  } else if (command === 'pending') {
    const pending = await client.xPending(stream, group);
    console.log(JSON.stringify(pending));
    if (pending.pending !== 1) throw new Error('Expected one pending message');
  } else if (command === 'verify') {
    const paths = resultPaths(process.argv[3]);
    const quotes = await readResult(paths.final);
    try {
      await access(paths.temporary);
      throw new Error('Temporary result still exists');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const messageId = process.argv[4];
    if (messageId) {
      const groups = await client.xInfoGroups(stream);
      const current = groups.find((item) => item.name === group);
      const [seenTime, seenSequence] = current.lastDeliveredId.split('-').map(BigInt);
      const [sentTime, sentSequence] = messageId.split('-').map(BigInt);
      if (seenTime < sentTime || (seenTime === sentTime && seenSequence < sentSequence)) {
        throw new Error('Message has not been delivered yet');
      }
    }
    const pending = await client.xPending(stream, group);
    if (pending.pending !== 0) throw new Error('Queue still has pending messages');
    console.log(JSON.stringify({ quotes: quotes.length, pending: 0 }));
  } else {
    throw new Error('Expected enqueue, pending or verify');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.quit();
  clearTimeout(deadline);
}
