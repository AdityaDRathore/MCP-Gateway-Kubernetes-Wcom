# Urumi Dashboard — Team MCP Gateway Web UI

A responsive Single-Page Application (SPA) providing visual administration, team member management, API key self-service, and audit log inspection for the Urumi Model Context Protocol (MCP) Gateway.

Built for **Urumi AI Phase 5 (Team Platform & Dashboard)**.

---

## 1. Technical Stack & Architecture

- **Framework**: React 19 (`react@^19.0.0`, `react-dom@^19.0.0`)
- **Build Tool**: Vite 6 (`vite@^6.1.0`) with `@vitejs/plugin-react`
- **Language**: TypeScript (`typescript@^5.7.3`, strict mode)
- **Styling**: Modern Vanilla CSS Design System with curated dark theme tokens (`apps/dashboard/src/index.css`), CSS variables, glassmorphic cards, and zero Tailwind/framework runtime bloat.
- **Packaging & Delivery**: Multi-stage Docker build (`apps/gateway/Dockerfile`) compiles the Vite bundle into `/app/dist-dashboard` and serves it statically from the Gateway process on **Port 3001**.

---

## 2. Directory Structure

```
apps/dashboard/
├── dist/                     # Compiled production bundle (gitignored)
├── index.html                # SPA HTML entrypoint with viewport & meta tags
├── package.json              # Workspace configuration and build scripts
├── tsconfig.json             # TypeScript compiler settings for React JSX/DOM
├── vite.config.ts            # Vite bundler configuration (base: '/', outDir: 'dist')
└── src/
    ├── main.tsx              # DOM mounting and root provider initialization
    ├── App.tsx               # Main application controller & authentication routing
    ├── index.css             # Unified modern CSS design system & typography
    ├── context/
    │   └── AuthContext.tsx   # Session state, login/logout, CSRF token & user profile
    └── components/
        ├── DashboardLayout.tsx # Navigation bar, active session banner, and tab switcher
        ├── OverviewTab.tsx   # System health, gateway stats, quick links & DoD status
        ├── UpstreamsTab.tsx  # Dynamic upstream server list, health status & tool inspector
        ├── MembersTab.tsx    # Team member roster, single-use invitations & deactivation
        ├── KeysTab.tsx       # Member/Admin API key self-service, creation & instant revoke
        ├── AuditTab.tsx      # Paginated audit trail viewer with live query filtering
        └── LoginView.tsx     # Username/password login and invitation token redemption
```

---

## 3. Communication & Security Architecture

The dashboard interacts exclusively with the Gateway's Browser API on **Port 3001** under `/api/v1/browser/*`.

1. **Session-Cookie Authentication**:
   - The browser presents an `HttpOnly`, `SameSite=Lax` session cookie (`urumi_session`).
   - Plaintext credentials and session tokens are never stored in `localStorage` or `sessionStorage`.
2. **Dual-Layer CSRF Defense**:
   - Every state-mutating request (`POST`, `PATCH`, `DELETE`) automatically includes the `X-Urumi-CSRF` header containing the cryptographically random token received upon session initialization.
   - The Gateway validates both the CSRF token and the HTTP `Origin` header against allowed ingress hostnames (`http://dashboard.127.0.0.1.nip.io:8080`).
3. **Strict Perimeter Separation**:
   - The dashboard SPA has zero direct network access to upstream MCP servers (`woocommerce-mcp`, `mcp-crm`, `mcp-tasks`), WordPress, or MariaDB.
   - Downstream MCP clients (such as MCP Inspector or Cursor) connect via Bearer API keys on **Port 3000** (`/mcp`), completely isolated from the browser session plane.

---

## 4. Local Development & Build Commands

All commands should be executed from the monorepo root or inside `apps/dashboard`:

```bash
# Ensure Node 24 LTS
export PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH"

# 1. Install workspace dependencies
npm install

# 2. Start local Vite development server (port 5173 by default)
npm run --workspace=apps/dashboard dev

# 3. Compile TypeScript and build production bundle (output to apps/dashboard/dist/)
npm run --workspace=apps/dashboard build

# 4. Preview compiled bundle locally
npm run --workspace=apps/dashboard preview
```

---

## 5. In-Cluster Production Deployment

In Kubernetes (`k3d-urumi`), the compiled dashboard bundle is served directly by the gateway pod (`urumi-gateway`) on port 3001.

- **Dashboard Ingress Host**: `http://dashboard.127.0.0.1.nip.io:8080/`
- **Ingress Controller**: Traefik path-based routing directs `/` to `urumi-gateway:3001` and `/mcp` to `urumi-gateway:3000`.
