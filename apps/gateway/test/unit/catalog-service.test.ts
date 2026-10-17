import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogService, ReadonlySnapshotMap } from '../../src/upstream/catalog-service.js';
import { CatalogTool, UpstreamStatusSummary, DiscoveredToolsResult } from '../../src/upstream/types.js';

describe('Gateway Catalog Service & Snapshot Unit Tests', () => {
  function makeTool(slug: string, originalName: string, overrides: Partial<CatalogTool> = {}): CatalogTool {
    return {
      name: `${slug}__${originalName}`,
      originalName,
      upstreamSlug: slug,
      description: `Description for ${originalName}`,
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      ...overrides,
    };
  }

  it('initializes with an empty, deeply immutable snapshot in O(1) read time', () => {
    const service = new CatalogService();
    const snapshot = service.getSnapshot();

    assert.equal(snapshot.version, 0);
    assert.equal(snapshot.tools.length, 0);
    assert.equal(snapshot.toolsByPublicName.size, 0);
    assert.ok(snapshot.createdAt > 0);
    assert.ok(typeof snapshot.fingerprint === 'string');
    assert.equal(snapshot.fingerprint.length, 64);

    // Assert maps are instances of ReadonlySnapshotMap and throw on mutation
    assert.ok(snapshot.toolsByPublicName instanceof ReadonlySnapshotMap);
    assert.throws(
      () => (snapshot.toolsByPublicName as any).set('key', {}),
      /Cannot modify immutable CatalogSnapshot Map: set\(\) is prohibited/
    );
    assert.throws(
      () => (snapshot.upstreamStatuses as any).clear(),
      /Cannot modify immutable CatalogSnapshot Map: clear\(\) is prohibited/
    );
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
    assert.ok(snapshot.fingerprint.length === 64);

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
    assert.equal(snapshot1.fingerprint, snapshot2.fingerprint);
  });

  it('creates a new snapshot when inputSchema changes under the same tool name', () => {
    const service = new CatalogService();

    const originalTool = makeTool('crm', 'get_contact', {
      inputSchema: {
        type: 'object',
        properties: { contactId: { type: 'string' } },
        required: ['contactId'],
      },
    });

    const statuses: UpstreamStatusSummary[] = [
      { slug: 'crm', healthState: 'available', persistedStatus: 'active', isEnabled: true, toolCount: 1, lastCheckedAt: 1000 },
    ];

    const snapshot1 = service.updateSnapshot([{ slug: 'crm', tools: [originalTool], discoveredAt: 1000 }], statuses);
    assert.equal(snapshot1.version, 1);

    // Modify schema: add a new property under the same tool name
    const updatedTool = makeTool('crm', 'get_contact', {
      inputSchema: {
        type: 'object',
        properties: { contactId: { type: 'string' }, includeNotes: { type: 'boolean' } },
        required: ['contactId'],
      },
    });

    const snapshot2 = service.updateSnapshot([{ slug: 'crm', tools: [updatedTool], discoveredAt: 2000 }], statuses);

    assert.notEqual(snapshot1, snapshot2, 'Must create a new snapshot instance when inputSchema changes');
    assert.equal(snapshot2.version, 2, 'Snapshot version must increment on schema change');
    assert.notEqual(snapshot1.fingerprint, snapshot2.fingerprint, 'Fingerprint must update on schema change');
    assert.deepEqual(
      (snapshot2.tools[0].inputSchema as any).properties.includeNotes,
      { type: 'boolean' }
    );
  });

  it('creates a new snapshot when description changes under the same tool name', () => {
    const service = new CatalogService();

    const toolV1 = makeTool('crm', 'get_contact', {
      description: 'Version 1 description',
    });

    const statuses: UpstreamStatusSummary[] = [
      { slug: 'crm', healthState: 'available', persistedStatus: 'active', isEnabled: true, toolCount: 1, lastCheckedAt: 1000 },
    ];

    const snapshot1 = service.updateSnapshot([{ slug: 'crm', tools: [toolV1], discoveredAt: 1000 }], statuses);
    assert.equal(snapshot1.version, 1);

    const toolV2 = makeTool('crm', 'get_contact', {
      description: 'Version 2 updated description with more details',
    });

    const snapshot2 = service.updateSnapshot([{ slug: 'crm', tools: [toolV2], discoveredAt: 2000 }], statuses);

    assert.notEqual(snapshot1, snapshot2, 'Must create a new snapshot instance when description changes');
    assert.equal(snapshot2.version, 2, 'Snapshot version must increment on description change');
    assert.notEqual(snapshot1.fingerprint, snapshot2.fingerprint, 'Fingerprint must change on description change');
    assert.equal(snapshot2.tools[0].description, 'Version 2 updated description with more details');
  });

  it('creates a new snapshot when outputSchema or annotations change', () => {
    const service = new CatalogService();

    const toolV1 = makeTool('crm', 'get_contact', {
      outputSchema: { type: 'object', properties: { score: { type: 'number' } } },
      annotations: { audience: ['member'] },
    });

    const statuses: UpstreamStatusSummary[] = [
      { slug: 'crm', healthState: 'available', persistedStatus: 'active', isEnabled: true, toolCount: 1, lastCheckedAt: 1000 },
    ];

    const snapshot1 = service.updateSnapshot([{ slug: 'crm', tools: [toolV1], discoveredAt: 1000 }], statuses);
    assert.equal(snapshot1.version, 1);

    const toolV2 = makeTool('crm', 'get_contact', {
      outputSchema: { type: 'object', properties: { score: { type: 'number' }, tier: { type: 'string' } } },
      annotations: { audience: ['member', 'admin'] },
    });

    const snapshot2 = service.updateSnapshot([{ slug: 'crm', tools: [toolV2], discoveredAt: 2000 }], statuses);

    assert.notEqual(snapshot1, snapshot2);
    assert.equal(snapshot2.version, 2);
    assert.notEqual(snapshot1.fingerprint, snapshot2.fingerprint);
  });

  it('guarantees deep immutability: consumers cannot mutate snapshot, maps, tools, or nested schemas', () => {
    const service = new CatalogService();

    const originalTool = makeTool('crm', 'get_contact', {
      inputSchema: {
        type: 'object',
        properties: {
          filter: {
            type: 'object',
            properties: { status: { type: 'string' } },
          },
        },
      },
    });

    const statuses: UpstreamStatusSummary[] = [
      { slug: 'crm', healthState: 'available', persistedStatus: 'active', isEnabled: true, toolCount: 1, lastCheckedAt: 1000 },
    ];

    const snapshot = service.updateSnapshot([{ slug: 'crm', tools: [originalTool], discoveredAt: 1000 }], statuses);

    // 1. Snapshot top-level immutability
    assert.throws(
      () => { (snapshot as any).version = 999; },
      /Cannot assign to read only property|Cannot add property/
    );
    assert.throws(
      () => { (snapshot as any).injectedField = 'hack'; },
      /Cannot add property/
    );

    // 2. Tools array immutability
    assert.throws(
      () => { (snapshot.tools as any).push(makeTool('hack', 'evil')); },
      /Cannot add property|Cannot modify/
    );
    assert.throws(
      () => { (snapshot.tools as any)[0] = makeTool('hack', 'evil'); },
      /Cannot assign to read only property/
    );

    // 3. Tool entry immutability
    assert.throws(
      () => { (snapshot.tools[0] as any).description = 'tampered description'; },
      /Cannot assign to read only property/
    );

    // 4. Nested schema deep immutability
    assert.throws(
      () => { (snapshot.tools[0].inputSchema as any).type = 'array'; },
      /Cannot assign to read only property/
    );
    assert.throws(
      () => { (snapshot.tools[0].inputSchema.properties as any).newField = { type: 'boolean' }; },
      /Cannot add property/
    );
    assert.throws(
      () => { ((snapshot.tools[0].inputSchema.properties as any).filter.properties as any).status = { type: 'integer' }; },
      /Cannot assign to read only property/
    );

    // 5. Map immutability (ReadonlySnapshotMap)
    assert.throws(
      () => { (snapshot.toolsByPublicName as any).set('hacked__tool', makeTool('hacked', 'tool')); },
      /Cannot modify immutable CatalogSnapshot Map: set\(\) is prohibited/
    );
    assert.throws(
      () => { (snapshot.toolsByPublicName as any).delete('crm__get_contact'); },
      /Cannot modify immutable CatalogSnapshot Map: delete\(\) is prohibited/
    );
    assert.throws(
      () => { (snapshot.toolsByPublicName as any).clear(); },
      /Cannot modify immutable CatalogSnapshot Map: clear\(\) is prohibited/
    );
    assert.throws(
      () => { (snapshot.upstreamStatuses as any).set('hacked', {}); },
      /Cannot modify immutable CatalogSnapshot Map: set\(\) is prohibited/
    );
    assert.throws(
      () => { (snapshot.upstreamStatuses as any).delete('crm'); },
      /Cannot modify immutable CatalogSnapshot Map: delete\(\) is prohibited/
    );

    // 6. Defensive copying proof: mutating original tool object after updateSnapshot does not affect snapshot
    (originalTool.inputSchema.properties as any).mutatedAfterCall = { type: 'string' };
    assert.equal((snapshot.tools[0].inputSchema.properties as any).mutatedAfterCall, undefined);
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
    const snap1 = service.updateSnapshot([crmTools], healthyStatuses);
    assert.equal(snap1.tools[0]._meta?.reachable, true);

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
    assert.notEqual(snap1, degradedSnapshot, 'Degraded snapshot must be a new instance');
    assert.equal(degradedSnapshot.version, 2);
    assert.equal(degradedSnapshot.tools.length, 1);
    const tool = degradedSnapshot.tools[0];
    assert.equal(tool.name, 'crm__get_contact');
    assert.equal(tool._meta?.reachable, false);
    assert.ok(typeof tool._meta?.error === 'string');
    assert.match(tool._meta?.error as string, /Connection refused/);
  });
});
