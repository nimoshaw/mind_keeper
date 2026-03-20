# ═══════ Mind Keeper — Docker Image ═══════
# 支持两种模式:
#   客户端模式: docker run mind-keeper (stdio MCP)
#   服务器模式: docker run -p 6700:6700 mind-keeper server

FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
LABEL org.opencontainers.image.title="Mind Keeper"
LABEL org.opencontainers.image.description="Project-scoped memory MCP server with Dashboard"

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled output + dashboard
COPY --from=builder /app/dist/ dist/

# Data volume for persistent storage
VOLUME /data

ENV MIND_KEEPER_PROJECT_ROOT=/data
ENV MIND_KEEPER_HTTP_HOST=0.0.0.0
ENV MIND_KEEPER_HTTP_PORT=6700

EXPOSE 6700

# Default: server mode. Override CMD for client (stdio) mode.
CMD ["node", "dist/http.js", "--host", "0.0.0.0", "--project-root", "/data"]
