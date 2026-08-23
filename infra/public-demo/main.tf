locals {
  common_tags = {
    Project     = "Aeolus"
    Environment = "public-demo"
    ManagedBy   = "Terraform"
  }

  bootstrap_script = templatefile("${path.module}/cloud-init.sh.tftpl", {
    demo_user = var.demo_user
    demo_root = var.demo_root
  })
}

resource "aws_lightsail_instance" "demo" {
  name              = var.instance_name
  availability_zone = var.availability_zone
  blueprint_id      = var.blueprint_id
  bundle_id         = var.bundle_id
  key_pair_name     = var.key_pair_name != "" ? var.key_pair_name : null
  ip_address_type   = "ipv4"

  # User data only bootstraps the replaceable host. App releases are deployed
  # separately with Docker Compose; Terraform never SSHes into the instance.
  # Lightsail launch scripts must be a single-line string. Encode the
  # maintainable multiline bootstrap template and reconstruct it on the host.
  user_data = "printf '%s' '${base64encode(local.bootstrap_script)}' | base64 -d > /tmp/aeolus-bootstrap.sh && chmod 700 /tmp/aeolus-bootstrap.sh && /tmp/aeolus-bootstrap.sh"

  # Launch scripts only run at instance creation. Ignore drift here so fixing or
  # evolving bootstrap logic never replaces an already-running demo VM; future
  # creates still use the configured one-line launch script above.
  lifecycle {
    ignore_changes = [user_data]
  }

  tags = local.common_tags
}

resource "aws_lightsail_static_ip" "demo" {
  name = "${var.instance_name}-ip"
}

resource "aws_lightsail_static_ip_attachment" "demo" {
  static_ip_name = aws_lightsail_static_ip.demo.name
  instance_name  = aws_lightsail_instance.demo.name
}

# Cloudflare Tunnel is outbound-only, so no HTTP/HTTPS/MQTT/application ports
# are opened. SSH is restricted to operator IPs and optionally AWS's browser SSH
# range. This resource replaces the blueprint's default 22/80 rules.
resource "aws_lightsail_instance_public_ports" "demo" {
  instance_name = aws_lightsail_instance.demo.name

  lifecycle {
    precondition {
      condition     = length(var.admin_cidrs) > 0 || var.enable_lightsail_browser_ssh
      error_message = "At least one SSH source must be configured: admin_cidrs or Lightsail browser SSH."
    }
  }

  port_info {
    protocol          = "tcp"
    from_port         = 22
    to_port           = 22
    cidrs             = var.admin_cidrs
    cidr_list_aliases = var.enable_lightsail_browser_ssh ? ["lightsail-connect"] : []
  }
}

resource "random_bytes" "tunnel_secret" {
  count  = var.manage_cloudflare ? 1 : 0
  length = 32
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "demo" {
  count         = var.manage_cloudflare ? 1 : 0
  account_id    = var.cloudflare_account_id
  name          = var.tunnel_name
  config_src    = "cloudflare"
  tunnel_secret = random_bytes.tunnel_secret[0].base64

  lifecycle {
    precondition {
      condition     = var.cloudflare_account_id != ""
      error_message = "cloudflare_account_id is required when manage_cloudflare=true."
    }
  }
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "demo" {
  count      = var.manage_cloudflare ? 1 : 0
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.demo[0].id
  source     = "cloudflare"

  # cloudflared evaluates top-to-bottom. Paths are Go regular expressions, not
  # shell globs, hence ^/api(/.*)?$ and ^/ws$.
  config = {
    ingress = [
      {
        hostname = var.demo_hostname
        path     = "^/api(/.*)?$"
        service  = "http://backend:3001"
      },
      {
        hostname = var.demo_hostname
        path     = "^/ws$"
        service  = "http://backend:3001"
      },
      {
        hostname = var.demo_hostname
        service  = "http://frontend:80"
      },
      {
        service = "http_status:404"
      }
    ]
  }
}

resource "cloudflare_dns_record" "demo" {
  count   = var.manage_cloudflare ? 1 : 0
  zone_id = var.cloudflare_zone_id
  name    = var.demo_hostname
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.demo[0].id}.cfargotunnel.com"
  ttl     = 1
  proxied = true

  lifecycle {
    precondition {
      condition     = var.cloudflare_zone_id != ""
      error_message = "cloudflare_zone_id is required when manage_cloudflare=true."
    }
  }
}

data "cloudflare_zero_trust_tunnel_cloudflared_token" "demo" {
  count      = var.manage_cloudflare ? 1 : 0
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.demo[0].id
}
