variable "aws_region" {
  description = "AWS region for Lightsail. Sydney is ap-southeast-2."
  type        = string
  default     = "ap-southeast-2"
}

variable "availability_zone" {
  description = "Lightsail availability zone, e.g. ap-southeast-2a. Confirm with `aws lightsail get-regions --include-availability-zones`."
  type        = string
}

variable "instance_name" {
  description = "Lightsail instance name."
  type        = string
  default     = "aeolus-public-demo"
}

variable "blueprint_id" {
  description = "Active Ubuntu Lightsail blueprint ID. Resolve with `aws lightsail get-blueprints --region ap-southeast-2`."
  type        = string
}

variable "bundle_id" {
  description = "Lightsail plan/bundle ID for the 4 GB instance. Resolve with `aws lightsail get-bundles --region ap-southeast-2`."
  type        = string
}

variable "key_pair_name" {
  description = "Optional existing Lightsail key pair name. Empty uses the regional default key pair."
  type        = string
  default     = ""
}

variable "admin_cidrs" {
  description = "IPv4 CIDRs allowed to SSH directly, normally your current public IP as /32."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for cidr in var.admin_cidrs : cidr != "0.0.0.0/0"])
    error_message = "Do not expose SSH to 0.0.0.0/0. Use your current public IP as /32 or Lightsail browser SSH."
  }
}

variable "enable_lightsail_browser_ssh" {
  description = "Allow the AWS Lightsail browser SSH client in addition to admin_cidrs."
  type        = bool
  default     = true
}

variable "demo_user" {
  description = "OS user that will own /opt/aeolus-demo and run deployments. Ubuntu blueprints use ubuntu."
  type        = string
  default     = "ubuntu"
}

variable "demo_root" {
  description = "Root directory for app source, active data and immutable golden snapshot."
  type        = string
  default     = "/opt/aeolus-demo"
}

variable "manage_cloudflare" {
  description = "Create the Cloudflare Tunnel, ingress config and demo DNS record."
  type        = bool
  default     = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID. Required when manage_cloudflare=true."
  type        = string
  default     = ""
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for aeolus.com.au. Required when manage_cloudflare=true."
  type        = string
  default     = ""
}

variable "demo_hostname" {
  description = "Public hostname for the demo."
  type        = string
  default     = "demo.aeolus.com.au"
}

variable "tunnel_name" {
  description = "Cloudflare Tunnel name."
  type        = string
  default     = "aeolus-public-demo"
}
