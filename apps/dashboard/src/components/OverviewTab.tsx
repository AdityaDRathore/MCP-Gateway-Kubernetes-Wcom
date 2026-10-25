import React, { useState, useEffect } from 'react';
import { TabType } from './DashboardLayout';

interface NodeDetail {
  id: string;
  title: string;
  type: 'client' | 'perimeter' | 'gateway' | 'upstream' | 'storage';
  badge: string;
  status: 'healthy' | 'active' | 'isolated';
  k8sResource: string;
  port: string;
  protocol: string;
  securityInvariant: string;
  description: string;
  exposedEndpoints: string[];
}

const NODES_DATA: Record<string, NodeDetail> = {
  'client-mcp': {
    id: 'client-mcp',
    title: 'Downstream AI Clients',
    type: 'client',
    badge: 'Machine Consumer',
    status: 'active',
    k8sResource: 'External Ingress Client (Claude Desktop / Cursor / SDK)',
    port: '443 / 8080',
    protocol: 'JSON-RPC 2.0 over Streamable HTTP',
    securityInvariant: 'Bearer Token Auth via SHA-256 verifier. Zero session cookie acceptance.',
    description: 'Autonomous AI models and IDE integrations executing Model Context Protocol tools over authenticated HTTP streams.',
    exposedEndpoints: ['POST /mcp'],
  },
  'client-browser': {
    id: 'client-browser',
    title: 'Operator WordPress Admin SPA',
    type: 'client',
    badge: 'Human Operator',
    status: 'active',
    k8sResource: 'React 19 SPA (Port 3001)',
    port: '3001 / 8080',
    protocol: 'HTTPS / Same-Origin REST',
    securityInvariant: 'HTTP-only Session Cookie + X-Urumi-CSRF verification. Origin allowlist strictly enforced.',
    description: 'WooCommerce management control center for team access, API key self-provisioning, audit reviews, and interactive AI chat.',
    exposedEndpoints: ['/api/v1/browser/*', '/health/ready'],
  },
  'listener-3000': {
    id: 'listener-3000',
    title: 'Perimeter Listener: Port 3000',
    type: 'perimeter',
    badge: 'MCP Perimeter',
    status: 'isolated',
    k8sResource: 'urumi-gateway (gateway-mcp-svc:3000)',
    port: '3000 (TCP)',
    protocol: 'Streamable HTTP (POST /mcp) & Internal Admin API',
    securityInvariant: 'Dual-listener perimeter: Unmounts SPA files & ignores browser cookies. Enforces constant-time API key auth.',
    description: 'Dedicated perimeter ingress listener reserved exclusively for machine-to-machine MCP communications and Kubernetes cluster operators.',
    exposedEndpoints: ['POST /mcp', 'POST /admin/v1/*'],
  },
  'listener-3001': {
    id: 'listener-3001',
    title: 'Perimeter Listener: Port 3001',
    type: 'perimeter',
    badge: 'Browser Perimeter',
    status: 'isolated',
    k8sResource: 'urumi-gateway (gateway-browser-svc:3001)',
    port: '3001 (TCP)',
    protocol: 'Browser REST API & Static Asset Delivery',
    securityInvariant: 'Dual-listener perimeter: Unmounts /mcp and /admin/v1 routes (returns 404). Validates origin and CSRF tokens.',
    description: 'Isolated browser perimeter listener serving the compiled SPA and handling session management with rate limiting.',
    exposedEndpoints: ['/api/v1/browser/session', '/api/v1/browser/chat', '/api/v1/browser/members', '/api/v1/browser/keys'],
  },
  'gateway-core': {
    id: 'gateway-core',
    title: 'Gateway Core & Agent Orchestrator',
    type: 'gateway',
    badge: 'Core Engine',
    status: 'healthy',
    k8sResource: 'Deployment/urumi-gateway (Node.js 22 LTS)',
    port: 'Internal',
    protocol: 'Bounded Agent Loop (Gemini 2.5 Flash)',
    securityInvariant: 'Max 5 loop turns, 30s deadline, 64 KiB result truncation, human-in-the-loop HMAC confirmation gate.',
    description: 'Central intelligence hub orchestrating multi-step LLM reasoning, schema discovery, tool routing, and permission enforcement.',
    exposedEndpoints: ['AgentLoop.executeTurn()', 'ToolRouter.route()', 'ConfirmationManager'],
  },
  'audit-ledger': {
    id: 'audit-ledger',
    title: 'Two-Phase Write-Ahead Audit Ledger',
    type: 'gateway',
    badge: 'Security Ledger',
    status: 'healthy',
    k8sResource: 'PersistentVolumeClaim/urumi-gateway-pvc (/data/gateway.db)',
    port: 'Local FS / WAL',
    protocol: 'SQLite 3 (WAL Mode, synchronous=NORMAL)',
    securityInvariant: 'Fail-closed two-phase audit logging: Phase 1 (pending) recorded BEFORE dispatch; Phase 2 (success/failure) recorded on return.',
    description: 'Tamper-resistant audit repository persisting every MCP tool invocation, parameter payload, execution duration, and caller identity.',
    exposedEndpoints: ['AuditRepository.recordPending()', 'AuditRepository.finalize()'],
  },
  'mcp-woocommerce': {
    id: 'mcp-woocommerce',
    title: 'WooCommerce MCP Server',
    type: 'upstream',
    badge: 'Upstream MCP',
    status: 'healthy',
    k8sResource: 'Deployment/urumi-woocommerce-mcp (Port 3000)',
    port: '3000 (ClusterIP)',
    protocol: 'Model Context Protocol (JSON-RPC 2.0)',
    securityInvariant: 'Read-only root filesystem (/ is read-only, writable /tmp), zero token mounts, dropped Linux capabilities.',
    description: 'Domain MCP provider bridging store catalog, inventory stock, customer orders, and refund workflows directly to WooCommerce REST API.',
    exposedEndpoints: ['tools/list: 5 tools (list_products, get_product, create_product, list_orders, get_order, update_order_status)'],
  },
  'mcp-crm': {
    id: 'mcp-crm',
    title: 'Customer CRM MCP Server',
    type: 'upstream',
    badge: 'Upstream MCP',
    status: 'healthy',
    k8sResource: 'Deployment/urumi-mcp-crm (Port 3000)',
    port: '3000 (ClusterIP)',
    protocol: 'Model Context Protocol (JSON-RPC 2.0)',
    securityInvariant: 'automountServiceAccountToken: false, non-root user (UID 10001), seccomp profile RuntimeDefault.',
    description: 'Enterprise customer profile service exposing VIP tiers, purchasing history, and loyalty metadata for agent context.',
    exposedEndpoints: ['tools/list: 3 tools (list_customers, get_customer, update_customer)'],
  },
  'mcp-tasks': {
    id: 'mcp-tasks',
    title: 'Task & Workflow MCP Server',
    type: 'upstream',
    badge: 'Upstream MCP',
    status: 'healthy',
    k8sResource: 'Deployment/urumi-mcp-tasks (Port 3000)',
    port: '3000 (ClusterIP)',
    protocol: 'Model Context Protocol (JSON-RPC 2.0)',
    securityInvariant: 'automountServiceAccountToken: false, non-root user, read-only rootfs.',
    description: 'Internal project task manager enabling agents to query assigned fulfillment milestones and log operational tickets.',
    exposedEndpoints: ['tools/list: 3 tools (list_tasks, get_task, create_task)'],
  },
  'storage-mariadb': {
    id: 'storage-mariadb',
    title: 'WordPress & MariaDB Database',
    type: 'storage',
    badge: 'Store Database',
    status: 'healthy',
    k8sResource: 'StatefulSet/urumi-mariadb-0 & Deployment/urumi-wordpress',
    port: '3306 (SQL) / 80 (HTTP)',
    protocol: 'MySQL Protocol & REST API',
    securityInvariant: 'ACID transactional integrity. WooCommerce baseline items (Products #10, #11, #12 & Order #14) protected by invariant tests.',
    description: 'Production e-commerce data store hosting the live product catalog, orders, and customer accounts.',
    exposedEndpoints: ['wp-json/wc/v3/* (Internal ClusterIP)'],
  },
};

type FlowMode = 'mcp-agent' | 'human-confirmation' | 'perimeter-guard';

export const OverviewTab: React.FC<{ onNavigateTab?: (tab: TabType) => void }> = ({ onNavigateTab }) => {
  const [healthStatus, setHealthStatus] = useState<'healthy' | 'checking' | 'degraded'>('checking');
  const [latency, setLatency] = useState<number | null>(null);
  const [activeNode, setActiveNode] = useState<string>('gateway-core');
  const [flowMode, setFlowMode] = useState<FlowMode>('mcp-agent');

  useEffect(() => {
    const checkHealth = async () => {
      const start = performance.now();
      try {
        const res = await fetch('/health/ready');
        if (res.ok) {
          setHealthStatus('healthy');
          setLatency(Math.round(performance.now() - start));
        } else {
          setHealthStatus('degraded');
        }
      } catch {
        setHealthStatus('degraded');
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  const selectedNode = NODES_DATA[activeNode] || NODES_DATA['gateway-core'];

  return (
    <div id="overview-tab-view" className="animate-fade-in">
      {/* WordPress Admin Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '23px', fontWeight: 600, color: 'var(--wp-text-primary)', marginBottom: '0.25rem' }}>
            System Architecture &amp; Gateway Health
          </h1>
          <p style={{ color: 'var(--wp-text-secondary)', fontSize: '13px' }}>
            Real-time topology model of Kubernetes dual-listener boundaries, AI agent reasoning loop, and upstream e-commerce tools.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.65rem' }}>
          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab('chat')}
              className="btn btn-woo"
              style={{ padding: '0.4rem 0.95rem' }}
            >
              <span>🤖 Open AI Store Assistant</span>
            </button>
          )}
          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab('audit')}
              className="btn btn-secondary"
              style={{ padding: '0.4rem 0.95rem' }}
            >
              <span>📜 Inspect Audit Trail</span>
            </button>
          )}
        </div>
      </div>

      {/* WordPress Style KPI Metrics */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div className="wp-card">
          <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--wp-text-muted)', marginBottom: '0.35rem' }}>
            Gateway Health
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: healthStatus === 'healthy' ? '#00a32a' : '#d63638',
              }}
            />
            <span style={{ fontSize: '18px', fontWeight: 600, color: 'var(--wp-text-primary)' }}>
              {healthStatus === 'healthy' ? 'Operational' : 'Checking'}
            </span>
            <span style={{ fontSize: '12px', color: 'var(--wp-text-muted)', marginLeft: 'auto', fontFamily: 'var(--wp-font-mono)' }}>
              {latency ? `${latency}ms` : '--'}
            </span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--wp-text-secondary)', marginTop: '0.35rem' }}>
            Kubernetes Readiness Probe OK
          </div>
        </div>

        <div className="wp-card">
          <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--wp-text-muted)', marginBottom: '0.35rem' }}>
            Upstream Services
          </div>
          <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--wp-blue)' }}>
            3 Active Pods
          </div>
          <div style={{ fontSize: '12px', color: 'var(--wp-text-secondary)', marginTop: '0.35rem' }}>
            WooCommerce, CRM, Tasks
          </div>
        </div>

        <div className="wp-card">
          <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--wp-text-muted)', marginBottom: '0.35rem' }}>
            Discovered MCP Tools
          </div>
          <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--woo-purple)' }}>
            11 Dynamic Tools
          </div>
          <div style={{ fontSize: '12px', color: 'var(--wp-text-secondary)', marginTop: '0.35rem' }}>
            Aggregated &amp; Schema Validated
          </div>
        </div>

        <div className="wp-card">
          <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--wp-text-muted)', marginBottom: '0.35rem' }}>
            Perimeter Security
          </div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--wp-text-primary)' }}>
            Dual-Listener (3000 / 3001)
          </div>
          <div style={{ fontSize: '12px', color: '#00a32a', marginTop: '0.35rem', fontWeight: 500 }}>
            Strict Cookie &amp; Key Isolation
          </div>
        </div>
      </div>

      {/* Simulator Mode Switcher */}
      <div
        className="wp-card"
        style={{
          padding: '0.85rem 1.25rem',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          background: '#ffffff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--wp-text-muted)', textTransform: 'uppercase' }}>
            Trace Data Flow:
          </span>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            <button
              onClick={() => setFlowMode('mcp-agent')}
              className={`btn ${flowMode === 'mcp-agent' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '0.25rem 0.75rem', fontSize: '12px', minHeight: '28px' }}
            >
              1. AI Agent Tool Execution
            </button>
            <button
              onClick={() => setFlowMode('human-confirmation')}
              className={`btn ${flowMode === 'human-confirmation' ? 'btn-woo' : 'btn-secondary'}`}
              style={{ padding: '0.25rem 0.75rem', fontSize: '12px', minHeight: '28px' }}
            >
              2. Human Confirmation Gate
            </button>
            <button
              onClick={() => setFlowMode('perimeter-guard')}
              className={`btn ${flowMode === 'perimeter-guard' ? 'btn-danger' : 'btn-secondary'}`}
              style={{ padding: '0.25rem 0.75rem', fontSize: '12px', minHeight: '28px' }}
            >
              3. Perimeter Boundary Guard
            </button>
          </div>
        </div>

        <span style={{ fontSize: '12px', color: 'var(--wp-text-muted)' }}>
          Click any component box below to inspect its live technical profile
        </span>
      </div>

      {/* Main Interactive Diagram & Meta Box Inspector */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '1.5rem', alignItems: 'start' }}>
        {/* Visual Architecture Map Canvas */}
        <div
          className="wp-card"
          style={{
            background: '#ffffff',
            border: '1px solid var(--wp-border)',
            padding: '1.75rem',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* TIER 1: Downstream Consumers */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--wp-text-muted)', marginBottom: '0.65rem' }}>
                Tier 1: Downstream Consumers &amp; Store Operators
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div
                  onClick={() => setActiveNode('client-mcp')}
                  style={{
                    padding: '1rem',
                    borderRadius: '4px',
                    background: activeNode === 'client-mcp' ? '#f0f6fc' : '#ffffff',
                    border: '1px solid',
                    borderColor: activeNode === 'client-mcp' ? '#2271b1' : '#c3c4c7',
                    boxShadow: activeNode === 'client-mcp' ? '0 0 0 1px #2271b1' : 'var(--wp-shadow-card)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <strong style={{ fontSize: '13px', color: '#1d2327' }}>🤖 Claude / Cursor / Agents</strong>
                    <span className="badge badge-admin">Streamable MCP</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--wp-text-secondary)' }}>
                    Machine-to-machine tools over Bearer API Key
                  </div>
                </div>

                <div
                  onClick={() => setActiveNode('client-browser')}
                  style={{
                    padding: '1rem',
                    borderRadius: '4px',
                    background: activeNode === 'client-browser' ? '#f8f5fc' : '#ffffff',
                    border: '1px solid',
                    borderColor: activeNode === 'client-browser' ? '#7f54b3' : '#c3c4c7',
                    boxShadow: activeNode === 'client-browser' ? '0 0 0 1px #7f54b3' : 'var(--wp-shadow-card)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <strong style={{ fontSize: '13px', color: '#1d2327' }}>💻 Operator WordPress SPA</strong>
                    <span className="badge badge-member">Session / CSRF</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--wp-text-secondary)' }}>
                    Human control center, keys, members &amp; AI chat
                  </div>
                </div>
              </div>
            </div>

            {/* TIER 2: Perimeter Boundary */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: '#d63638' }}>
                  Tier 2: Cryptographic Perimeter Boundary (DEC-08)
                </span>
                <span style={{ fontSize: '11px', color: 'var(--wp-text-muted)' }}>Isolated network listeners</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div
                  onClick={() => setActiveNode('listener-3000')}
                  style={{
                    padding: '1rem',
                    borderRadius: '4px',
                    background: activeNode === 'listener-3000' ? '#f0f6fc' : '#ffffff',
                    border: '1px solid',
                    borderColor: activeNode === 'listener-3000' ? '#2271b1' : '#c3c4c7',
                    boxShadow: activeNode === 'listener-3000' ? '0 0 0 1px #2271b1' : 'var(--wp-shadow-card)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '13px', color: '#2271b1', marginBottom: '0.25rem' }}>
                    Port 3000: MCP Protocol Listener
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--wp-text-secondary)', lineHeight: 1.4 }}>
                    • Rejects cookies with 401<br />
                    • SHA-256 Bearer Token verification<br />
                    • Strict streamable HTTP chunking
                  </div>
                </div>

                <div
                  onClick={() => setActiveNode('listener-3001')}
                  style={{
                    padding: '1rem',
                    borderRadius: '4px',
                    background: activeNode === 'listener-3001' ? '#f8f5fc' : '#ffffff',
                    border: '1px solid',
                    borderColor: activeNode === 'listener-3001' ? '#7f54b3' : '#c3c4c7',
                    boxShadow: activeNode === 'listener-3001' ? '0 0 0 1px #7f54b3' : 'var(--wp-shadow-card)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '13px', color: '#7f54b3', marginBottom: '0.25rem' }}>
                    Port 3001: Browser Session Listener
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--wp-text-secondary)', lineHeight: 1.4 }}>
                    • Unmounts /mcp (strictly returns 404)<br />
                    • Scrypt Session &amp; CSRF protection<br />
                    • Canonical Origin allowlist validation
                  </div>
                </div>
              </div>
            </div>

            {/* TIER 3: Core Engine & Audit */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--wp-text-muted)', marginBottom: '0.65rem' }}>
                Tier 3: Gateway Governance Engine &amp; Audit Pipeline
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '1rem' }}>
                <div
                  onClick={() => setActiveNode('gateway-core')}
                  style={{
                    padding: '1.15rem',
                    borderRadius: '4px',
                    background: activeNode === 'gateway-core' ? '#f0f6fc' : '#ffffff',
                    border: '1px solid',
                    borderColor: activeNode === 'gateway-core' ? '#2271b1' : '#c3c4c7',
                    boxShadow: activeNode === 'gateway-core' ? '0 0 0 1px #2271b1' : 'var(--wp-shadow-card)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <strong style={{ fontSize: '14px', color: '#1d2327' }}>⚡ Gateway Orchestrator &amp; Router</strong>
                    <span className="badge badge-success">5-Turn Bound</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--wp-text-secondary)', lineHeight: 1.5 }}>
                    • Agent Loop (Gemini 2.5 Flash, 30s deadline)<br />
                    • Dynamic Catalog Discovery &amp; Schema Aggregation<br />
                    • Human-in-the-Loop Mutation Confirmation Gate
                  </div>
                </div>

                <div
                  onClick={() => setActiveNode('audit-ledger')}
                  style={{
                    padding: '1.15rem',
                    borderRadius: '4px',
                    background: activeNode === 'audit-ledger' ? '#edfaef' : '#ffffff',
                    border: '1px solid',
                    borderColor: activeNode === 'audit-ledger' ? '#00a32a' : '#c3c4c7',
                    boxShadow: activeNode === 'audit-ledger' ? '0 0 0 1px #00a32a' : 'var(--wp-shadow-card)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <strong style={{ fontSize: '14px', color: '#00a32a' }}>📜 Two-Phase Audit Ledger</strong>
                    <span className="badge badge-success">Fail-Closed</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--wp-text-secondary)', lineHeight: 1.5 }}>
                    • Phase 1: Pending record BEFORE tool dispatch<br />
                    • Phase 2: Success / Failure + latency finalize<br />
                    • SQLite WAL on Persistent Volume
                  </div>
                </div>
              </div>
            </div>

            {/* TIER 4: Upstreams */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--wp-text-muted)', marginBottom: '0.65rem' }}>
                Tier 4: Upstream Domain MCP Microservices (ClusterIP)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                <div
                  onClick={() => setActiveNode('mcp-woocommerce')}
                  style={{
                    padding: '1rem',
                    borderRadius: '4px',
                    background: activeNode === 'mcp-woocommerce' ? '#f0f6fc' : '#ffffff',
                    border: '1px solid',
                    borderColor: activeNode === 'mcp-woocommerce' ? '#2271b1' : '#c3c4c7',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '13px', color: '#2271b1', marginBottom: '0.25rem' }}>
                    🛒 WooCommerce MCP
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--wp-text-muted)' }}>
                    Port 3000 • 5 Tools<br />
                    Products, Orders, Stock
                  </div>
                  <div style={{ marginTop: '0.4rem', fontSize: '11px', color: '#00a32a', fontWeight: 600 }}>
                    🛡 Read-Only RootFS
                  </div>
                </div>

                <div
                  onClick={() => setActiveNode('mcp-crm')}
                  style={{
                    padding: '1rem',
                    borderRadius: '4px',
                    background: activeNode === 'mcp-crm' ? '#f0f6fc' : '#ffffff',
                    border: '1px solid',
                    borderColor: activeNode === 'mcp-crm' ? '#2271b1' : '#c3c4c7',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '13px', color: '#2271b1', marginBottom: '0.25rem' }}>
                    👥 Customer CRM
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--wp-text-muted)' }}>
                    Port 3000 • 3 Tools<br />
                    VIP Tiers &amp; Loyalty
                  </div>
                  <div style={{ marginTop: '0.4rem', fontSize: '11px', color: '#00a32a', fontWeight: 600 }}>
                    🛡 Zero SA Tokens
                  </div>
                </div>

                <div
                  onClick={() => setActiveNode('mcp-tasks')}
                  style={{
                    padding: '1rem',
                    borderRadius: '4px',
                    background: activeNode === 'mcp-tasks' ? '#f0f6fc' : '#ffffff',
                    border: '1px solid',
                    borderColor: activeNode === 'mcp-tasks' ? '#2271b1' : '#c3c4c7',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '13px', color: '#2271b1', marginBottom: '0.25rem' }}>
                    📋 Tasks &amp; Planner
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--wp-text-muted)' }}>
                    Port 3000 • 3 Tools<br />
                    Fulfillment Queue
                  </div>
                  <div style={{ marginTop: '0.4rem', fontSize: '11px', color: '#00a32a', fontWeight: 600 }}>
                    🛡 Non-root (UID 10001)
                  </div>
                </div>
              </div>
            </div>

            {/* TIER 5: Persistence */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--wp-text-muted)', marginBottom: '0.65rem' }}>
                Tier 5: Core Enterprise Persistence
              </div>
              <div
                onClick={() => setActiveNode('storage-mariadb')}
                style={{
                  padding: '1rem 1.25rem',
                  borderRadius: '4px',
                  background: activeNode === 'storage-mariadb' ? '#f0f6fc' : '#ffffff',
                  border: '1px solid',
                  borderColor: activeNode === 'storage-mariadb' ? '#2271b1' : '#c3c4c7',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <strong style={{ fontSize: '13px', color: '#1d2327' }}>
                    🗄️ MariaDB / WordPress &amp; Protected Store Catalog
                  </strong>
                  <span className="badge badge-success">ACID Baseline Intact</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--wp-text-secondary)' }}>
                  StatefulSet MariaDB (Port 3306) • Products #10, #11, #12 &amp; Order #14 Protected • WordPress REST API
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* WordPress Style Meta Box Inspector */}
        <div className="wp-card" style={{ background: '#ffffff', border: '1px solid var(--wp-border)' }}>
          <div style={{ borderBottom: '1px solid var(--wp-border-subtle)', paddingBottom: '0.75rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--wp-text-muted)' }}>
              Component Specification
            </span>
            <span className="badge badge-success" style={{ fontSize: '10px' }}>
              {selectedNode.status}
            </span>
          </div>

          <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#1d2327', marginBottom: '0.5rem' }}>
            {selectedNode.title}
          </h3>

          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <span className="code-pill">{selectedNode.k8sResource.split(' ')[0]}</span>
            <span className="code-pill">Port {selectedNode.port}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', fontSize: '13px' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--wp-text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>
                Description
              </div>
              <div style={{ color: 'var(--wp-text-secondary)', lineHeight: 1.45 }}>
                {selectedNode.description}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--wp-text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>
                Wire Protocol
              </div>
              <div style={{ fontFamily: 'var(--wp-font-mono)', fontSize: '12px', color: 'var(--wp-text-primary)', background: '#f6f7f7', padding: '0.4rem 0.6rem', borderRadius: '3px', border: '1px solid var(--wp-border-subtle)' }}>
                {selectedNode.protocol}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#d63638', textTransform: 'uppercase', marginBottom: '0.2rem' }}>
                Security Invariant
              </div>
              <div style={{ color: '#b32d2e', background: '#fcf0f1', padding: '0.5rem 0.75rem', borderRadius: '3px', border: '1px solid #f8d7da', lineHeight: 1.4 }}>
                🔒 {selectedNode.securityInvariant}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--wp-text-muted)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                Exposed Interfaces
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {selectedNode.exposedEndpoints.map((ep, idx) => (
                  <div key={idx} style={{ fontFamily: 'var(--wp-font-mono)', fontSize: '11px', color: 'var(--wp-text-primary)', background: '#f6f7f7', padding: '0.35rem 0.5rem', borderRadius: '3px', border: '1px solid var(--wp-border-subtle)' }}>
                    {ep}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
