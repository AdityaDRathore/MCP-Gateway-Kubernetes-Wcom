# ==============================================================================
# Stage 1: Build & TypeScript Compilation
# ==============================================================================
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS builder

WORKDIR /build

# Copy monorepo workspace manifests for lockfile verification
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/gateway/package.json ./apps/gateway/
COPY apps/dashboard/package.json ./apps/dashboard/

# Install full dependencies for building
RUN npm ci

# Copy TypeScript configuration and source files for gateway
COPY apps/gateway/tsconfig.json ./apps/gateway/
COPY apps/gateway/src ./apps/gateway/src

# Compile Gateway TypeScript
RUN npm run build --workspace=apps/gateway

# Copy dashboard configuration and source files
COPY apps/dashboard/tsconfig.json apps/dashboard/vite.config.ts apps/dashboard/index.html ./apps/dashboard/
COPY apps/dashboard/src ./apps/dashboard/src

# Compile Dashboard Vite SPA
RUN npm run build --workspace=apps/dashboard

# ==============================================================================
# Stage 2: Production Dependencies (Excluding devDependencies)
# ==============================================================================
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS prod-deps

WORKDIR /build

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/gateway/package.json ./apps/gateway/
COPY apps/dashboard/package.json ./apps/dashboard/

# Install only production dependencies
RUN npm ci --omit=dev

# ==============================================================================
# Stage 3: Minimal Unprivileged Runtime
# ==============================================================================
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runner

LABEL org.opencontainers.image.title="urumi-gateway" \
      org.opencontainers.image.description="Central Team MCP Gateway for Urumi Platform" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.vendor="Urumi AI Platform"

# Create non-root user and group (UID/GID 10001) and pre-create /data storage mount
RUN addgroup -g 10001 -S mcpuser && \
    adduser -u 10001 -S mcpuser -G mcpuser && \
    mkdir -p /data && \
    chown -R 10001:10001 /data && \
    chmod 0700 /data

WORKDIR /app

# Copy production node_modules and compiled output with correct ownership
COPY --from=prod-deps --chown=mcpuser:mcpuser /build/node_modules ./node_modules
COPY --from=builder --chown=mcpuser:mcpuser /build/apps/gateway/dist ./dist
COPY --from=builder --chown=mcpuser:mcpuser /build/apps/gateway/package.json ./package.json
COPY --from=builder --chown=mcpuser:mcpuser /build/apps/dashboard/dist ./dist-dashboard

# Run as non-root user
USER 10001:10001

# Production environment defaults
ENV NODE_ENV=production \
    PORT=3000 \
    BROWSER_PORT=3001 \
    HOST=0.0.0.0 \
    DB_PATH=/data/gateway.db \
    DASHBOARD_STATIC_PATH=/app/dist-dashboard

EXPOSE 3000 3001

VOLUME ["/data"]

# Start server directly (no shell intermediary to ensure clean signal propagation)
CMD ["node", "dist/index.js"]
