ARG BOLT_IMAGE_STAGE=demo
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
ARG VITE_GOOGLE_MAPS_ADDRESS_MAP_ID
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
# The full pre-migration restore runs on a temporary Unix socket, without provisioning a database service.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg postgresql-common \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSLo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && gpg --show-keys --with-colons /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc | grep -q 'fpr:::::::::B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8:' \
    && echo 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' > /etc/apt/sources.list.d/pgdg.list \
    && echo 'create_main_cluster = false' >> /etc/postgresql-common/createcluster.conf \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-18 postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/*
ENV BOLT_DEMO_VOLUME=/data
CMD ["node", "deployment/start-demo.mjs"]

# Render passes BOLT_IMAGE_STAGE=production as a build argument.
FROM ${BOLT_IMAGE_STAGE} AS release
