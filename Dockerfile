# ═══════ Mind Keeper — Docker Image ═══════
FROM node:22-slim AS builder

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app

# Native dependencies need these at runtime sometimes, 
# although better-sqlite3 usually bundles them or builds statically.
RUN apt-get update && apt-get install -y \
    python3 \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist/ dist/

VOLUME /data
ENV MIND_KEEPER_PROJECT_ROOT=/data
ENV MIND_KEEPER_HTTP_HOST=0.0.0.0
ENV MIND_KEEPER_HTTP_PORT=6700

EXPOSE 6700
CMD ["node", "dist/http.js"]

