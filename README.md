# NeonSpace Network Dashboard

A premium, self-contained, cyberpunk network observatory that runs **100% locally** inside a Docker container on your network host. No cloud dependencies, no external APIs (except optional GitHub events, Docker Hub, and keyless weather).

## Architecture

```
public/standalone.html  ← self-contained UI (WebGL topology + 6-ship fleet + all panels)
server/monitor.mjs      ← Node.js background scanner (WebSocket + HTTP API, no npm deps)
server/entrypoint.mjs   ← Docker entrypoint (launches monitor + nginx)
docker/nginx.conf       ← serves static HTML + proxies /ws and /api/* to monitor
scripts/build-static.mjs ← copies standalone.html → dist/index.html
```

## Background Scanning Engine

The monitor server runs **15 independent modules** on their own timers:

| Module | Interval | What it does |
|--------|----------|--------------|
| Anchor ICMP heartbeat | 10s | Pings 5 infrastructure anchors (192.168.4.1/33/48/49/200) |
| Subnet ARP/ICMP sweep | 30s | Probes 192.168.4.2–254 for discovered terminals |
| TCP port health checks | 10s | Probes 8006 (Proxmox), 7575 (Homarr), 32400 (Plex) |
| Port scanner matrix | 10s | Full 6-port × 4-target open-port matrix |
| WAN diagnostics | 10s | 5-packet burst to 8.8.8.8, packet-loss % |
| SSL certificate check | 5min | Sweeps HTTPS endpoints for expiry (<30 days = warning) |
| DNS resolution benchmark | 30s | Times DNS lookups for 4 reference domains |
| Docker container monitor | 10s | Lists containers + CPU/RAM stats via socket |
| GitHub event polling | 60s | Fetches push/commit events from the repo |
| SMART drive health | 2min | smartctl drive temps, bad sectors, spin retries |
| Plex API sessions | 15s | Active streams + poster artwork (needs PLEX_TOKEN) |
| Proxmox VE API | 15s | Node/VM CPU/RAM workloads (needs PVE_API_TOKEN) |
| Network throughput | 5s | /proc/net/dev bandwidth per interface |
| MAC vendor resolver | on scan | OUI prefix → manufacturer (Apple, Intel, Sony, etc.) |
| Atmospheric weather | 10min | Open-Meteo keyless API (temp, pressure, wind, storms) |

## 6-Ship Fleet Tactical Panels

| Ship | Panel |
|------|-------|
| **Dreadnought · 01** | Port Scanner Matrix — live open-port grid |
| **Recon · 02** | IPAM Subnet Grid — 192.168.4.0/24 allocation map |
| **Interceptor · 03** | Wake-on-LAN — broadcast magic packet to gaming PC |
| **Leviathan · 04** | MAC Vendor Resolver — hardware manufacturer lookup |
| **Vanguard · 05** | Network Performance — latency, throughput, ISP stability dial |
| **Sentinel · 06** | Proxmox & Plex Telemetry — cluster + streaming sessions |

## Additional Panels

- **Live Docker Controller** — container cards with Start/Stop/Restart buttons
- **GitHub Event Telemetry** — scrolling commit/event matrix log
- **Enterprise Diagnostics** — SSL expiry warnings, SMART health, weather
- **Plex 3D Hologram** — floating rotating poster when streams are active

## Docker Deployment

```bash
docker compose up -d
```

Access at `http://<host-ip>:8086`.

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SCAN_INTERVAL_MS` | 10000 | Anchor ping interval |
| `DISCOVERY_INTERVAL_MS` | 30000 | Subnet sweep interval |
| `PVE_API_TOKEN` | (empty) | Proxmox API token — skip if unset |
| `PLEX_TOKEN` | (empty) | Plex authentication token — skip if unset |
| `WOL_MAC` | (empty) | Wake-on-LAN target MAC address |
| `WEATHER_LAT` / `WEATHER_LON` | 40.71 / -74.01 | Weather location |
| `GITHUB_REPO` | Hemiboy98/neonspace-network-dashboard | Repo for event telemetry |
| `SSL_TARGETS` | 192.168.4.200:8006,... | HTTPS endpoints to monitor |

### Volumes

- `/var/run/docker.sock` (read-only) — container monitoring + control
- `/dev` (read-only) — SMART drive health via smartctl

### Network

Uses `host` networking so the monitor can reach the local 192.168.4.0/24 subnet directly.
