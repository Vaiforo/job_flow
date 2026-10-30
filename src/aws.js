import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}; run make provision and make deploy first`);
  return value;
}

export function connect({ maxAttempts = 3 } = {}) {
  const options = {
    endpoint: required('AWS_ENDPOINT_URL'),
    region: required('AWS_REGION'),
    credentials: {
      accessKeyId: required('AWS_ACCESS_KEY_ID'),
      secretAccessKey: required('AWS_SECRET_ACCESS_KEY'),
    },
    maxAttempts,
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
  };
  return {
    s3: new S3Client({ ...options, forcePathStyle: true }),
    sqs: new SQSClient(options),
    bucket: required('S3_BUCKET'),
    queueUrl: required('SQS_QUEUE_URL'),
  };
}

export function resultKey(task) {
  if (task?.source !== 'quotes' || typeof task?.taskId !== 'string' ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(task.taskId)) {
    throw new Error('Expected a quotes task with an alphanumeric taskId (hyphens allowed)');
  }
  return `raw/quotes/${task.taskId}.json`;
}
