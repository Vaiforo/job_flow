import { writeFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { HeadBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DeleteMessageCommand, GetQueueAttributesCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { chromium } from 'playwright';
import { connect, resultKey } from './aws.js';
import { scrapeQuotes } from './scraper.js';

const readyFile = '/tmp/job-flow-worker-ready';
const jobTimeoutMs = 120_000; // Less than the queue's 180-second visibility timeout.
let stopping = false;
let receiveController;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    stopping = true;
    receiveController?.abort();
  });
}

async function processMessage(message, { s3, sqs, bucket, queueUrl }) {
  const task = JSON.parse(message.Body);
  const key = resultKey(task);
  let browser;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
    browser?.close().catch(() => {});
  }, jobTimeoutMs);

  try {
    console.log(`Processing task ${task.taskId}`);
    browser = await chromium.launch({ headless: true });
    if (controller.signal.aborted) throw new Error('Task timed out');
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const quotes = await scrapeQuotes(page);
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: `${JSON.stringify(quotes, null, 2)}\n`,
      ContentType: 'application/json',
    }), { abortSignal: controller.signal });
    console.log(`Stored ${quotes.length} quotes at s3://${bucket}/${key}`);

    // A received message is only acknowledged after S3 confirms the write.
    await sqs.send(new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: message.ReceiptHandle,
    }), { abortSignal: controller.signal });
    console.log(`Completed task ${task.taskId}: S3 write confirmed, SQS message deleted`);
  } finally {
    clearTimeout(timeout);
    await browser?.close();
  }
}

async function main() {
  await rm(readyFile, { force: true });
  const clients = connect();
  try {
    await clients.s3.send(new HeadBucketCommand({ Bucket: clients.bucket }));
    await clients.sqs.send(new GetQueueAttributesCommand({ QueueUrl: clients.queueUrl }));
    await writeFile(readyFile, 'ready\n');
    console.log(`Worker ready: ${clients.queueUrl} -> s3://${clients.bucket}`);

    while (!stopping) {
      receiveController = new AbortController();
      try {
        const { Messages = [] } = await clients.sqs.send(new ReceiveMessageCommand({
          QueueUrl: clients.queueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 20,
        }), { abortSignal: receiveController.signal });
        receiveController = undefined;
        for (const message of Messages) {
          try {
            await processMessage(message, clients);
          } catch (error) {
            console.error(`Task failed; message retained (${message.MessageId}):`, error);
          }
        }
      } catch (error) {
        if (stopping) break;
        console.error('Queue receive failed:', error);
        await delay(2_000);
      }
    }
  } finally {
    await rm(readyFile, { force: true });
    clients.s3.destroy();
    clients.sqs.destroy();
  }
}

main().catch((error) => {
  console.error('Worker failed:', error);
  process.exitCode = 1;
});
