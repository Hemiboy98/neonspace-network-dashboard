# NeonSpace Network Observatory

NeonSpace is a standalone network-topology dashboard with draggable devices, animated WebGL data links, sample telemetry, and an interactive device inspector. Health states and telemetry are demonstration data; the page does not probe real devices.

## Build a standalone distribution

The production source is `public/standalone.html`, with CSS and JavaScript embedded in the HTML and no external runtime assets. Create `dist/index.html` directly with Node.js—no package installation, Vite server, or framework build is required:

```bash
node scripts/build-static.mjs
```

This produces a portable single-file bundle that can be copied to any static web server and served from a private LAN IP or subpath.

## Run on Proxmox with Docker Compose

Docker builds the single-file page, then runs a native Node.js LAN monitor beside Nginx. The monitor pings the five hardcoded backbone hosts every 5 seconds, sweeps the remaining `192.168.4.2–254` addresses every 60 seconds, and streams probe results to the dashboard over a same-origin WebSocket. Nginx serves the page and proxies `/ws` to the local monitor. Run this on the Linux Proxmox/Docker host:

```bash
docker compose up -d --build
```

The Compose service uses host networking so ICMP and the ARP neighbor table see the host's LAN. It serves on `http://<proxmox-lan-ip>:8086` (for example, `http://192.168.4.48:8086`); port `8086` must be available on the host. The five monitored anchors are `192.168.4.1`, `.200`, `.33`, `.48`, and `.49`. A failed ICMP probe is shown as degraded when a current ARP neighbor is present, otherwise offline. Discovered nodes are grouped under the gateway in the visualization; the scanner does not infer physical routes or measure throughput.

After editing `public/standalone.html`, rebuild with `docker compose up -d --build`. You can also run the Node command above to refresh the local `dist/` bundle. The React source remains available to the Blink editor preview, while Docker ships the framework-independent standalone page.
