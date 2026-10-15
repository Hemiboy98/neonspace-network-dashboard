# Build the single-file site from its source using only Node's built-in modules.
FROM node:22-alpine AS static-build
WORKDIR /site
COPY public/standalone.html public/standalone.html
COPY scripts/build-static.mjs scripts/build-static.mjs
RUN node scripts/build-static.mjs

# The runtime includes the Node monitor, Nginx, ICMP tools, curl (Docker socket +
# SSL checks), and smartmontools (drive health).
FROM node:22-alpine AS runtime
RUN apk add --no-cache nginx iputils curl smartmontools && mkdir -p /run/nginx
WORKDIR /app

COPY --from=static-build /site/dist/ /usr/share/nginx/html/
COPY docker/nginx.conf /etc/nginx/http.d/default.conf
COPY server/monitor.mjs server/entrypoint.mjs ./

EXPOSE 8086

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8086/healthz || exit 1

ENTRYPOINT ["node", "/app/entrypoint.mjs"]
