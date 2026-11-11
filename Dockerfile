FROM oven/bun:1.4.4 AS installer
WORKDIR /opt/bolt
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM node:22.22.0-bookworm-slim AS build
WORKDIR /opt/bolt
COPY --from=installer /opt/bolt/node_modules ./node_modules
COPY . .
RUN npm run lint && npm run build

FROM node:22.22.0-bookworm-slim AS demo
WORKDIR /opt/bolt
COPY --from=build /opt/bolt /opt/bolt
ENV NODE_ENV=production PORT=8080 BOLT_DEMO_VOLUME=/data
EXPOSE 8080
CMD ["node", "deployment/start-demo.mjs"]
