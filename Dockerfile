# ═══════ Mind Keeper — Docker Image ═══════
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# Runtime: Keep it simple
FROM node:22-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y \
    python3 \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy everything from builder to ensure no missing files
COPY --from=builder /app /app

VOLUME /data
ENV MIND_KEEPER_PROJECT_ROOT=/data
ENV MIND_KEEPER_HTTP_HOST=0.0.0.0
ENV MIND_KEEPER_HTTP_PORT=6700

EXPOSE 6700
CMD ["node", "dist/http.js"]


