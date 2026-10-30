import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { connect, resultKey } from './aws.js';
import { validateQuotes } from './quotes.js';

export async function verifyCloud(task, { s3, sqs, bucket, queueUrl }) {
  const key = resultKey(task);
  const deadline = Date.now() + 240_000;
  let quotes;
  while (Date.now() < deadline) {
    if (!quotes) {
      try {
        const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        quotes = JSON.parse(await object.Body.transformToString());
        validateQuotes(quotes);
        await writeFile('out/result.json', `${JSON.stringify(quotes, null, 2)}\n`);
      } catch (error) {
        if (error.name !== 'NoSuchKey' && error.$metadata?.httpStatusCode !== 404) throw error;
      }
    }
    if (quotes) {
      const { Attributes } = await sqs.send(new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: [
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
          'ApproximateNumberOfMessagesDelayed',
        ],
      }));
      if (Attributes && [
        'ApproximateNumberOfMessages',
        'ApproximateNumberOfMessagesNotVisible',
        'ApproximateNumberOfMessagesDelayed',
      ].every((name) => Attributes[name] === '0')) {
        console.log(`Verified ${quotes.length} quotes at s3://${bucket}/${key}`);
        console.log('SQS queue drained: 0 available, 0 in flight, 0 delayed messages');
        console.log('Downloaded result to out/result.json');
        return;
      }
    }
    await delay(2_000);
  }
  throw new Error(`Timed out waiting for s3://${bucket}/${key} and an empty queue; inspect make logs`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const clients = connect();
  try {
    const task = JSON.parse(await readFile('out/last-task.json', 'utf8'));
    await verifyCloud(task, clients);
  } catch (error) {
    console.error('Cloud verification failed:', error);
    process.exitCode = 1;
  } finally {
    clients.s3.destroy();
    clients.sqs.destroy();
  }
}
