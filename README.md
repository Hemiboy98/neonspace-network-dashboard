# NeonSpace Network Observatory

NeonSpace is a standalone network-topology dashboard with draggable devices, animated WebGL data links, sample telemetry, and an interactive device inspector. Health states and telemetry are demonstration data; the page does not probe real devices.

## Build a standalone distribution

The production source is `public/standalone.html`, with CSS and JavaScript embedded in the HTML and no external runtime assets. Create `dist/index.html` directly with Node.js—no package installation, Vite server, or framework build is required:

```bash
node scripts/build-static.mjs
```

This produces a portable single-file bundle that can be copied to any static web server and served from a private LAN IP or subpath.

## Run on Proxmox with Docker Compose

Docker builds the standalone bundle in a temporary Node builder stage, then copies only the generated HTML into the Nginx runtime image. Run:

```bash
docker compose up -d --build
```

Open `http://<proxmox-lan-ip>:8086` (for example, `http://192.168.4.48:8086`). The running container contains Nginx and the static site only—no Node runtime, React, Vite, peer dependency resolution, or development server. Change the host-side port in `docker-compose.yml` if `8086` is already in use.

After editing `public/standalone.html`, rebuild with `docker compose up -d --build`. You can also run the Node command above to refresh the local `dist/` bundle. The React source remains available to the Blink editor preview, while Docker ships the framework-independent standalone page.
