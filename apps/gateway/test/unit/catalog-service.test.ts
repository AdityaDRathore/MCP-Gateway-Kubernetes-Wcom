import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogService } from '../../src/upstream/catalog-service.js';
import { CatalogTool, UpstreamStatusSummary, DiscoveredToolsResult } from '../../src/upstream/types.js';

describe('Gateway Catalog Service & Snapshot Unit Tests', () => {
  function makeTool(slug: string, originalName: string): CatalogTool {
    return {
      name: `${slug}__${originalName}`,
      originalName,
      upstreamSlug: slug,
      description: `Description for ${originalName}`,
      inputSchema: { type: 'object', properties: {} },
    };
  }

  it('initializes with an empty, immutable snapshot in O(1) read time', () => {
    const service = new CatalogService();
    const snapshot = service.getSnapshot();

    assert.equal(snapshot.version, 0);
    assert.equal(snapshot.tools.length, 0);
    assert.equal(snapshot.toolsByPublicName.size, 0);
    assert.ok(snapshot.createdAt > 0);
  });

  it('compiles discovered tools, enforces deterministic sorting, and atomically swaps pointer', () => {
    const service = new CatalogService();

    // Tools deliberately given out of order
    const tasksTools: DiscoveredToolsResult = {
      slug: 'tasks',
      tools: [
        makeTool('tasks', 'update_task_status'),
        makeTool('tasks', 'create_task'),
        makeTool('tasks', 'list_tasks'),
      ],
      discoveredAt: Date.now(),
    };

    const crmTools: DiscoveredToolsResult = {
      slug: 'crm',
      tools: [
        makeTool('crm', 'search_contacts'),
        makeTool('crm', 'get_contact'),
      ],
      discoveredAt: Date.now(),
    };

    const wooTools: DiscoveredToolsResult = {
      slug: 'woocommerce',
      tools: [
        makeTool('woocommerce', 'list_products'),
        makeTool('woocommerce', 'create_product'),
      ],
      discoveredAt: Date.now(),
    };

    const statuses: UpstreamStatusSummary[] = [
      { slug: 'tasks', healthState: 'available', persistedStatus: 'active', isEnabled: true, toolCount: 3, lastCheckedAt: Date.now() },
      { slug: 'crm', healthState: 'available', persistedStatus: 'active', isEnabled: true, toolCount: 2, lastCheckedAt: Date.now() },
      { slug: 'woocommerce', healthState: 'available', persistedStatus: 'active', isEnabled: true, toolCount: 2, lastCheckedAt: Date.now() },
    ];

    const snapshot = service.updateSnapshot([tasksTools, crmTools, wooTools], statuses);

    assert.equal(snapshot.version, 1);
    assert.equal(snapshot.tools.length, 7);

    // Verify deterministic ordering: slug ASC ('crm', 'tasks', 'woocommerce'), then originalName ASC
    const names = snapshot.tools.map((t) => t.name);
    assert.deepEqual(names, [
      'crm__get_contact',
      'crm__search_contacts',
      'tasks__create_task',
      'tasks__list_tasks',
      'tasks__update_task_status',
      'woocommerce__create_product',
      'woocommerce__list_products',
    ]);

    // Fast O(1) map lookup
    assert.equal(snapshot.toolsByPublicName.get('crm__get_contact')?.originalName, 'get_contact');
    assert.equal(snapshot.toolsByPublicName.get('woocommerce__list_products')?.originalName, 'list_products');
  });

  it('allows identical original tool names across different upstream servers', () => {
    const service = new CatalogService();

    const crmTools: DiscoveredToolsResult = {
      slug: 'crm',
      tools: [makeTool('crm', 'search')],
      discoveredAt: Date.now(),
    };

    const tasksTools: DiscoveredToolsResult = {
      slug: 'tasks',
      tools: [makeTool('tasks', 'search')],
      discoveredAt: Date.now(),
    };

    const statuses: UpstreamStatusSummary[] = [
      { slug: 'crm', healthState: 'available', persistedStatus: 'active', isEnabled: true, toolCount: 1, lastCheckedAt: Date.now() },
      { slug: 'tasks', healthState: 'available', persistedStatus: 'active', isEnabled: true, toolCount: 1, lastCheckedAt: Date.now() },
    ];

    const snapshot = service.updateSnapshot([crmTools, tasksTools], statuses);
    assert.equal(snapshot.tools.length, 2);
    assert.ok(snapshot.toolsByPublicName.has('crm__search'));
    assert.ok(snapshot.toolsByPublicName.has('tasks__search'));
  });

  it('preserves snapshot object reference when tools and statuses are unchanged (reference stability)', () => {
    const service = new CatalogService();

    const crmTools: DiscoveredToolsResult = {
      slug: 'crm',
      tools: [makeTool('crm', 'get_contact')],
      discoveredAt: 1000,
    };

    const statuses: UpstreamStatusSummary[] = [
      { slug: 'crm', healthState: 'available', persistedStatus: 'active', isEnabled: true, toolCount: 1, lastCheckedAt: 1000 },
    ];

    const snapshot1 = service.updateSnapshot([crmTools], statuses);
    const snapshot2 = service.updateSnapshot([crmTools], statuses);

    assert.equal(snapshot1, snapshot2, 'Snapshot reference must be strictly identical when content is unchanged');
    assert.equal(snapshot2.version, 1);
  });

  it('strictly excludes tools from disabled upstreams', () => {
    const service = new CatalogService();

    const crmTools: DiscoveredToolsResult = {
      slug: 'crm',
      tools: [makeTool('crm', 'get_contact')],
      discoveredAt: Date.now(),
    };

    const disabledStatuses: UpstreamStatusSummary[] = [
      { slug: 'crm', healthState: 'disabled', persistedStatus: 'disabled', isEnabled: false, toolCount: 0, lastCheckedAt: Date.now() },
    ];

    const snapshot = service.updateSnapshot([crmTools], disabledStatuses);
    assert.equal(snapshot.tools.length, 0);
  });

  it('retains prior tools tagged with reachable: false when an enabled upstream becomes unreachable', () => {
    const service = new CatalogService();

    // 1. Initial healthy state
    const crmTools: DiscoveredToolsResult = {
      slug: 'crm',
      tools: [makeTool('crm', 'get_contact')],
      discoveredAt: Date.now(),
    };
    const healthyStatuses: UpstreamStatusSummary[] = [
      { slug: 'crm', healthState: 'available', persistedStatus: 'active', isEnabled: true, toolCount: 1, lastCheckedAt: Date.now() },
    ];
    service.updateSnapshot([crmTools], healthyStatuses);

    // 2. Subsequent refresh where CRM is unavailable
    const unavailableStatuses: UpstreamStatusSummary[] = [
      {
        slug: 'crm',
        healthState: 'unavailable',
        persistedStatus: 'active',
        isEnabled: true,
        toolCount: 1,
        lastCheckedAt: Date.now(),
        lastError: 'Connection refused to 10.42.0.123:3000',
      },
    ];

    const degradedSnapshot = service.updateSnapshot([], unavailableStatuses);
    assert.equal(degradedSnapshot.tools.length, 1);
    const tool = degradedSnapshot.tools[0];
    assert.equal(tool.name, 'crm__get_contact');
    assert.equal(tool._meta?.reachable, false);
    assert.ok(typeof tool._meta?.error === 'string');
  });
});
