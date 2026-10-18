# ==============================================================================
# Stage 1: Build & TypeScript Compilation
# ==============================================================================
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS builder

WORKDIR /build

# Copy monorepo workspace manifests for lockfile verification
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/mcp-crm/package.json ./apps/mcp-crm/

# Install full dependencies for building
RUN npm ci

# Copy TypeScript configuration and source files
COPY apps/mcp-crm/tsconfig.json ./apps/mcp-crm/
COPY apps/mcp-crm/src ./apps/mcp-crm/src

# Compile TypeScript
RUN npm run build --workspace=apps/mcp-crm

# ==============================================================================
# Stage 2: Production Dependencies (Excluding devDependencies)
# ==============================================================================
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS prod-deps

WORKDIR /build

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/mcp-crm/package.json ./apps/mcp-crm/

# Install only production dependencies
RUN npm ci --omit=dev

# ==============================================================================
# Stage 3: Minimal Unprivileged Runtime
# ==============================================================================
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runner

LABEL org.opencontainers.image.title="mcp-crm" \
      org.opencontainers.image.description="Deterministic CRM Mock MCP Service for Urumi Platform" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.vendor="Urumi AI Platform"

# Create non-root user and group (UID/GID 10001)
RUN addgroup -g 10001 -S mcpuser && \
    adduser -u 10001 -S mcpuser -G mcpuser

WORKDIR /app

# Copy production node_modules and compiled output with correct ownership
COPY --from=prod-deps --chown=mcpuser:mcpuser /build/node_modules ./node_modules
COPY --from=builder --chown=mcpuser:mcpuser /build/apps/mcp-crm/dist ./dist
COPY --from=builder --chown=mcpuser:mcpuser /build/apps/mcp-crm/package.json ./package.json

# Run as non-root user
USER 10001:10001

# Production environment defaults
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

EXPOSE 3000

# Start server directly (no shell intermediary to ensure clean signal propagation)
CMD ["node", "dist/index.js"]
