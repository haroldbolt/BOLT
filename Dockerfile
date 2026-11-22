FROM oven/bun:1.4.4 AS installer
WORKDIR /opt/bolt
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM node:22.22.0-bookworm-slim AS build
WORKDIR /opt/bolt
COPY --from=installer /opt/bolt/node_modules ./node_modules
COPY . .
# Opciones públicas de compilación para Google Maps. La clave del servidor se configura en runtime.
ARG VITE_GOOGLE_MAPS_API_KEY
ARG VITE_GOOGLE_MAPS_TRACKING_MAP_ID
RUN npm run lint && npm run build

FROM node:22.22.0-bookworm-slim AS runtime
WORKDIR /opt/bolt
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-spa \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /opt/bolt /opt/bolt
ENV NODE_ENV=production PORT=8080
EXPOSE 8080

FROM runtime AS production
RUN install -d -m 0700 -o node -g node /data
USER node
ENV BOLT_PILOT_VOLUME=/data BOLT_REQUIRE_VOLUME_MOUNT=1
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/v1/health', {signal:AbortSignal.timeout(3500)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "deployment/start-pilot.ts"]

# Keep the meeting demo as the default target for the existing Railway service.
FROM runtime AS demo
ENV BOLT_DEMO_VOLUME=/data
CMD ["node", "deployment/start-demo.mjs"]
