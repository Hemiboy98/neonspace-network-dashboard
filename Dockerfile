# Build the single-file site from its source using only Node's built-in modules.
FROM node:22-alpine AS static-build
WORKDIR /site
COPY public/standalone.html public/standalone.html
COPY public/device-names.json public/device-names.json
COPY scripts/build-static.mjs scripts/build-static.mjs
COPY scripts/compile-device-matrix.mjs scripts/compile-device-matrix.mjs
COPY server/device-names.mjs server/device-names.mjs
RUN node scripts/build-static.mjs

# Runtime dependencies are system tools only: Node monitor, Nginx, ping, SMART tooling.
FROM node:22-slim AS runtime
RUN apt-get update && apt-get install -y nginx iputils-ping smartmontools \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /run/nginx /app/neonspace-network-dashboard
WORKDIR /app

COPY --from=static-build /site/dist/ /usr/share/nginx/html/
COPY public/device-names.json /app/neonspace-network-dashboard/device-names.json
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY server/monitor.mjs server/entrypoint.mjs server/integration-config.mjs server/device-names.mjs ./

EXPOSE 8086

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8086/healthz || exit 1

ENTRYPOINT ["node", "/app/entrypoint.mjs"]
