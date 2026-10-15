# Build the single-file site from its source using only Node's built-in modules.
# No npm install, Vite, React, or local development server is needed.
FROM node:22-alpine AS static-build
WORKDIR /site
COPY public/standalone.html public/standalone.html
COPY scripts/build-static.mjs scripts/build-static.mjs
RUN node scripts/build-static.mjs

# The runtime contains only Nginx and the generated static site.
FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=static-build /site/dist/ /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
