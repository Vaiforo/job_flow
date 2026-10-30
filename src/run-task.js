import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { connect, resultKey } from './aws.js';
import { verifyCloud } from './verify-cloud.js';

// One submission attempt avoids duplicating a task after an ambiguous network response.
const clients = connect({ maxAttempts: 1 });
try {
  const task = { taskId: randomUUID(), source: 'quotes' };
  const { MessageId } = await clients.sqs.send(new SendMessageCommand({
    QueueUrl: clients.queueUrl,
    MessageBody: JSON.stringify(task),
  }));
  await writeFile('out/last-task.json', `${JSON.stringify({ ...task, messageId: MessageId }, null, 2)}\n`);
  console.log(`Enqueued task ${task.taskId} (${MessageId})`);
  console.log(`Waiting for s3://${clients.bucket}/${resultKey(task)}`);
  await verifyCloud(task, clients);
} catch (error) {
  console.error('Task submission or verification failed:', error);
  process.exitCode = 1;
} finally {
  clients.s3.destroy();
  clients.sqs.destroy();
}
