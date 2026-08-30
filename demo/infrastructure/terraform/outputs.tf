output "static_ipv4" {
  description = "Static public IPv4 used for operator SSH only. Aeolus traffic uses Cloudflare Tunnel."
  value       = aws_lightsail_static_ip.demo.ip_address
}

output "ssh_user" {
  description = "Lightsail OS username."
  value       = aws_lightsail_instance.demo.username
}

output "ssh_command" {
  description = "Convenience SSH command. Add -i <key> when not using an agent/default key."
  value       = "ssh ${aws_lightsail_instance.demo.username}@${aws_lightsail_static_ip.demo.ip_address}"
}

output "demo_url" {
  value = "https://${var.demo_hostname}"
}

output "cloudflare_tunnel_id" {
  value = var.manage_cloudflare ? cloudflare_zero_trust_tunnel_cloudflared.demo[0].id : null
}

output "cloudflare_tunnel_token" {
  description = "Sensitive token consumed by the cloudflared container. The local deploy script can read this output automatically."
  value       = var.manage_cloudflare ? data.cloudflare_zero_trust_tunnel_cloudflared_token.demo[0].token : null
  sensitive   = true
}
