# NeonSpace Network Dashboard

A self-hosted network observatory. LAN discovery runs locally on the Docker host; GitHub events and weather are optional internet-connected data sources. The Blink preview cannot access your LAN: actual scanning happens only in the Docker deployment on your network host.

## Run

```sh
# Create a private .env file before enabling Docker controls or integrations
umask 077
printf 'DASHBOARD_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env
# Add optional PVE_API_TOKEN, PLEX_TOKEN, WOL_MAC, WEATHER_LAT and WEATHER_LON here.
docker compose up -d
```

Open `http://<host-ip>:8086`. Compose uses host networking and exposes the web service on port 8086. Values in `.env` are explicitly mapped into the container by Compose. Deployment has not been validated in this environment.

## Runtime

The dependency-free Node ESM monitor uses native Node networking and the Docker Unix socket. It scans 192.168.4.1–254 every 10 seconds, excluding known inventory IPs from discovery while probing every inventory IP separately on the same cadence. The Tailscale address is checked independently. ICMP uses the system `ping`; ARP and local OUI data enrich responding hosts. Ping latency precision is whatever the local ping utility reports. Probes, DNS, ports, Docker, SMART, and local APIs may be unavailable depending on host permissions and installed/attached hardware.

| Variable | Default | Purpose |
|---|---|---|
| `SCAN_INTERVAL_MS` / `DISCOVERY_INTERVAL_MS` | 10000 | Inventory and discovery cadence (ms) |
| `PORT_INTERVAL_MS` | 10000 | Service checks/matrix cadence |
| `PVE_HOST` | `192.168.4.200` | Proxmox API host (HTTPS on port 8006 by default) |
| `PVE_API_TOKEN` | empty | Proxmox token string `user@realm!tokenid=secret` |
| `PLEX_HOST` | `192.168.4.49:32400` | Plex host and port |
| `PLEX_TOKEN` | empty | Plex API credential; artwork is proxied locally |
| `DASHBOARD_TOKEN` | empty | Required Bearer token for Docker and Wake-on-LAN controls |
| `WOL_MAC` | empty | Default Wake-on-LAN target MAC |
| `WOL_BROADCAST` | `192.168.4.255` | Wake-on-LAN broadcast address |
| `WEATHER_LAT`, `WEATHER_LON` | unset | Both required to enable Open-Meteo |
| `GITHUB_REPO` | `Hemiboy98/neonspace-network-dashboard` | Public repository event polling |
| `SSL_TARGETS` | `192.168.4.47:8006,192.168.4.200:8006` | Comma-separated HTTPS certificate targets (`host:port`) |
| `DNS_TARGETS` | `google.com,cloudflare.com,github.com,plex.tv` | Comma-separated DNS benchmark targets |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker API socket path |

For production, set `DASHBOARD_TOKEN` to a long random secret and send it as `Authorization: Bearer <token>` for Docker mutation requests. Without it, control endpoints return an explicit unavailable response. Mutation APIs require same-origin requests and enforce body-size limits. Keep this dashboard on a trusted network; possession of the Docker socket is effectively host-level authority. The compose socket mount is read-only as a filesystem mount, but **this does not make Docker API operations read-only**: clients can still issue API actions through the socket. Do not expose the dashboard publicly. Do not place any API token in frontend/browser configuration.

Plex artwork URLs are served through the local `/api/plex/artwork` proxy so the Plex token stays server-side. The default certificate sweep checks the Proxmox HTTPS ports only; add real HTTPS services to `SSL_TARGETS` rather than plaintext HTTP ports. Proxmox's self-signed TLS allowance is scoped to the configured PVE host. SMART data is best-effort and depends on host device access/tool capabilities. Weather remains absent unless both coordinates are explicitly configured.

## Files

- `public/standalone.html`: self-contained browser UI.
- `public/device-names.json`: canonical inventory labels, shipped to nginx and loaded by the monitor.
- `server/monitor.mjs`: ESM monitor, WebSocket stream, and local HTTP API.
- `docker/nginx.conf`: static hosting and reverse proxy.
- `scripts/build-static.mjs`: static asset build.
