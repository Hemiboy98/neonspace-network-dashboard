# NeonSpace Network Dashboard

A self-hosted network observatory. LAN discovery runs locally on the Docker host; GitHub events and weather are optional internet-connected data sources. The Blink preview cannot access your LAN: actual scanning happens only in the Docker deployment on your network host.

## Run

```sh
# Set secure secrets in an untracked .env file before enabling controls
printf 'DASHBOARD_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env
docker compose up -d
```

Open `http://<host-ip>:8086`. Compose uses host networking and exposes the web service on port 8086. Deployment has not been validated in this environment.

## Runtime

The dependency-free Node ESM monitor uses native Node networking and the Docker Unix socket. It scans 192.168.4.1–254 every 10 seconds, excluding known inventory IPs from discovery while probing every inventory IP separately on the same cadence. The Tailscale address is checked independently. ICMP uses the system `ping`; ARP and local OUI data enrich responding hosts. Ping latency precision is whatever the local ping utility reports. Probes, DNS, ports, Docker, SMART, and local APIs may be unavailable depending on host permissions and installed/attached hardware.

| Variable | Default | Purpose |
|---|---|---|
| `SCAN_INTERVAL_MS` / `DISCOVERY_INTERVAL_MS` | 10000 | Inventory and discovery cadence (ms) |
| `PORT_INTERVAL_MS` | 10000 | Service checks/matrix cadence |
| `PVE_HOST` | `192.168.4.200` | Proxmox API host |
| `PVE_API_TOKEN` | empty | Proxmox token string `user@realm!tokenid=secret` |
| `PLEX_TOKEN` | empty | Plex API credential |
| `DASHBOARD_TOKEN` | empty | Required Bearer token for Docker control APIs |
| `WOL_MAC` | empty | Default Wake-on-LAN target |
| `WEATHER_LAT`, `WEATHER_LON` | unset | Both required to enable Open-Meteo |
| `GITHUB_REPO` | `Hemiboy98/neonspace-network-dashboard` | Optional public repository event polling |
| `SSL_TARGETS`, `DNS_TARGETS` | built-in local/domain targets | Certificate and resolver checks |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker API socket path |

For production, set `DASHBOARD_TOKEN` to a long random secret and send it as `Authorization: Bearer <token>` for Docker mutation requests. Without it, control endpoints return an explicit unavailable response. Mutation APIs require same-origin requests and enforce body-size limits. Keep this dashboard on a trusted network; possession of the Docker socket is effectively host-level authority. The compose socket mount is read-only as a filesystem mount, but **this does not make Docker API operations read-only**: clients can still issue API actions through the socket. Do not expose the dashboard publicly. Do not place any API token in frontend/browser configuration.

Plex artwork URLs are served through the local `/api/plex/artwork` proxy so the Plex token stays server-side. Proxmox's self-signed TLS allowance is scoped to the configured local PVE host; external requests retain normal TLS validation. SMART data is best-effort and depends on host device access/tool capabilities. Weather remains absent unless both coordinates are explicitly configured.

## Files

- `public/standalone.html`: self-contained browser UI.
- `public/device-names.json`: canonical inventory labels, shipped to nginx and loaded by the monitor.
- `server/monitor.mjs`: ESM monitor, WebSocket stream, and local HTTP API.
- `docker/nginx.conf`: static hosting and reverse proxy.
- `scripts/build-static.mjs`: static asset build.
