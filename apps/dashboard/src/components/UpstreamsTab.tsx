import React from 'react';

interface UpstreamItem {
  slug: string;
  displayName: string;
  endpointUrl: string;
  timeoutMs: number;
  status: 'active' | 'degraded';
  tools: { name: string; description: string }[];
}

const UPSTREAMS_DATA: UpstreamItem[] = [
  {
    slug: 'woocommerce',
    displayName: 'WooCommerce Store Engine',
    endpointUrl: 'http://urumi-woocommerce-mcp.urumi.svc.cluster.local:3000/mcp',
    timeoutMs: 10000,
    status: 'active',
    tools: [
      { name: 'woocommerce_list_products', description: 'Lists published products from WooCommerce catalog' },
      { name: 'woocommerce_get_product', description: 'Retrieves single product details by integer ID' },
      { name: 'woocommerce_list_orders', description: 'Lists customer orders with status filtering' },
      { name: 'woocommerce_get_order', description: 'Retrieves order line items and shipping details' },
    ],
  },
  {
    slug: 'crm',
    displayName: 'Customer CRM Service',
    endpointUrl: 'http://urumi-crm.urumi.svc.cluster.local:3000/mcp',
    timeoutMs: 10000,
    status: 'active',
    tools: [
      { name: 'crm_list_customers', description: 'Lists customer profiles and purchase history' },
      { name: 'crm_get_customer', description: 'Fetches detailed CRM customer profile by ID' },
      { name: 'crm_update_customer', description: 'Updates contact info and loyalty tiers' },
    ],
  },
  {
    slug: 'tasks',
    displayName: 'Team Tasks & Project Planner',
    endpointUrl: 'http://urumi-tasks.urumi.svc.cluster.local:3000/mcp',
    timeoutMs: 10000,
    status: 'active',
    tools: [
      { name: 'tasks_list_tasks', description: 'Lists assigned team workflow tasks' },
      { name: 'tasks_get_task', description: 'Retrieves task execution state and deadlines' },
      { name: 'tasks_create_task', description: 'Dispatches new task assignment to team queue' },
    ],
  },
];

export const UpstreamsTab: React.FC = () => {
  return (
    <div id="upstreams-tab-view" className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Upstream Services &amp; Dynamic Catalog</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Registered upstream MCP providers connected via internal Kubernetes ClusterIP services.
          </p>
        </div>
        <div>
          <button className="btn btn-secondary" disabled title="Controlled via Administrator API">
            + Register Upstream (Admin Only)
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {UPSTREAMS_DATA.map((upstream) => (
          <div key={upstream.slug} className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
                  <h3 style={{ fontSize: '1.15rem' }}>{upstream.displayName}</h3>
                  <span className="code-pill">{upstream.slug}</span>
                  <span className="badge badge-success">
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor' }} />
                    {upstream.status}
                  </span>
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  Internal Endpoint: <code>{upstream.endpointUrl}</code>
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                Timeout: <strong>{upstream.timeoutMs}ms</strong>
              </div>
            </div>

            {/* Tool Inventory */}
            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.75rem' }}>
                Exposed MCP Tools ({upstream.tools.length})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
                {upstream.tools.map((tool) => (
                  <div
                    key={tool.name}
                    style={{
                      background: 'rgba(0, 0, 0, 0.2)',
                      padding: '0.75rem 1rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                      {tool.name}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                      {tool.description}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
