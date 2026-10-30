output "bucket_name" {
  description = "Bucket passed to the worker as S3_BUCKET."
  value       = aws_s3_bucket.raw_results.id
}

output "queue_url" {
  description = "Queue URL passed to the worker as SQS_QUEUE_URL."
  value       = aws_sqs_queue.scrape_tasks.url
}
