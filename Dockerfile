# syntax=docker/dockerfile:1

# ---- deps: install dependencies + compile the native SQLite addon ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Toolchain required to build better-sqlite3's native binding.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: produce the standalone Next.js server ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner: minimal production image ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DB_PATH=/data/workouts.db

# Standalone server bundle + static assets + public files.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# schema.sql is read at runtime via process.cwd(); guarantee it's present.
COPY --from=builder /app/src/lib/db/schema.sql ./src/lib/db/schema.sql

# Drop any DB the build baked in (initDb runs at import time). Real data lives
# only in the mounted /data volume. Create it and hand everything to `node`.
RUN rm -rf ./data \
  && mkdir -p /data \
  && chown -R node:node /app /data

USER node
EXPOSE 3000

# Liveness probe hits the in-app /api/health endpoint (Node 22 has global fetch).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
