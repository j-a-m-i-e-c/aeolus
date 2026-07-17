# Security

Aeolus has two separate security domains:

1. human access to the dashboard, REST API and WebSocket;
2. device access to the MQTT broker.

## Human access

- [Authentication](authentication.md)
- [Permissions](permissions.md)
- [Tokens and API access](tokens-and-api.md)
- [Troubleshooting](troubleshooting.md)

## MQTT access

- [MQTT security](mqtt.md)
- [Add an MQTT device](../how-to/add-mqtt-device.md)

## Important boundary

Dashboard authentication and MQTT credentials are independent. A human access token cannot connect to Mosquitto, and an MQTT device credential cannot call the HTTP API.

Aeolus supports local operation, but local network placement is not itself an authentication mechanism. Production deployments should also use HTTPS, host firewalling, protected backups and carefully scoped remote access. See [Production deployment](../production-deployment.md).
