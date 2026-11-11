import { createClient } from 'redis';

export const stream = 'jobs';
export const group = 'scrapers';

export async function connectRedis() {
  const client = createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' });
  client.on('error', (error) => console.error('Redis:', error.message));
  await client.connect();
  return client;
}

export async function ensureGroup(client) {
  try {
    await client.xGroupCreate(stream, group, '0', { MKSTREAM: true });
  } catch (error) {
    if (!error.message.includes('BUSYGROUP')) throw error;
  }
}
