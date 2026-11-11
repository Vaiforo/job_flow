variable "region" {
  description = "AWS region shared by Floci and the scraper worker."
  type        = string
  default     = "us-east-1"
}

variable "endpoint_url" {
  description = "Floci endpoint reachable from the Terraform container."
  type        = string
  default     = "http://floci:4566"
}

variable "bucket_name" {
  description = "Bucket containing raw scraper results."
  type        = string
  default     = "job-flow-raw-results"
}

variable "queue_name" {
  description = "Queue containing scraper tasks."
  type        = string
  default     = "job-flow-scrape-tasks"
}
