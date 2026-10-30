resource "aws_s3_bucket" "raw_results" {
  bucket        = var.bucket_name
  force_destroy = true
}

resource "aws_sqs_queue" "scrape_tasks" {
  name                       = var.queue_name
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = 180
}
