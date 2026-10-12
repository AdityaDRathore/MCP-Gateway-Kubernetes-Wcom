import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools } from '../../src/tools/index.js';
import {
  ListProductsInputShape,
  ListOrdersInputShape,
  GetOrderInputShape,
  UpdateOrderStatusInputShape,
  CreateProductInputShape,
} from '../../src/tools/schemas.js';
import { WooCommerceClient } from '../../src/woocommerce/client.js';
import { NotFoundError, UpstreamProtocolError } from '../../src/woocommerce/errors.js';
import { ProjectedProduct, ProjectedOrder } from '../../src/woocommerce/mappers.js';

describe('Gate G4 Read Tools Unit & Contract Tests', () => {
  const dummyProduct: ProjectedProduct = {
    id: 10,
    name: 'Urumi Test Mug',
    sku: 'URUMI-MUG-001',
    type: 'simple',
    status: 'publish',
    price: '299',
    regular_price: '299',
    stock_status: 'instock',
    categories: [{ id: 16, name: 'Accessories' }],
  };

  const dummyOrder: ProjectedOrder = {
    id: 14,
    status: 'processing',
    currency: 'INR',
    total: '299.00',
    date_created: '2026-10-11T18:23:04',
    payment_method: 'Cash on delivery',
    line_items: [
      {
        id: 1,
        name: 'Urumi Test Mug',
        product_id: 10,
        quantity: 1,
        subtotal: '299.00',
        total: '299.00',
        sku: 'URUMI-MUG-001',
      },
    ],
  };

  // Helper to extract registered tool handlers from McpServer
  function getRegisteredHandlers(mockClient?: WooCommerceClient) {
    const server = new McpServer({ name: 'test-server', version: '1.0.0' });
    registerAllTools(server, mockClient);
    // Access internal tool map for direct unit execution of handlers
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> }> })._registeredTools;
    return tools;
  }

  // --- 1. Schema Validation Unit Tests ---
  describe('Tool Input Schema Constraints', () => {
    test('ListProductsInputShape enforces bounded pagination and type constraints', () => {
      const schema = z.object(ListProductsInputShape);

      // Valid defaults
      const validDefault = schema.parse({});
      assert.equal(validDefault.page, 1);
      assert.equal(validDefault.per_page, 10);

      // Valid bounded filters
      const validFilters = schema.parse({
        page: 2,
        per_page: 50,
        category: '16',
        sku: 'URUMI-MUG-001',
        status: 'publish',
        search: 'Mug',
      });
      assert.equal(validFilters.page, 2);
      assert.equal(validFilters.per_page, 50);
      assert.equal(validFilters.category, '16');

      // Invalid: page < 1
      assert.throws(() => schema.parse({ page: 0 }), /Number must be greater than or equal to 1/);

      // Invalid: per_page > 50
      assert.throws(() => schema.parse({ per_page: 51 }), /Number must be less than or equal to 50/);

      // Invalid: unapproved status
      assert.throws(() => schema.parse({ status: 'archived' }), /Invalid enum value/);
    });

    test('ListOrdersInputShape validates bounded pagination and ISO timestamps', () => {
      const schema = z.object(ListOrdersInputShape);

      // Valid with ISO-8601 timestamps
      const valid = schema.parse({
        page: 1,
        per_page: 25,
        status: 'processing',
        after: '2026-10-01T00:00:00Z',
        before: '2026-10-15T00:00:00+00:00',
      });
      assert.equal(valid.page, 1);
      assert.equal(valid.per_page, 25);
      assert.equal(valid.status, 'processing');

      // Invalid: non-ISO date string
      assert.throws(() => schema.parse({ after: 'not-a-date' }), /Must be a valid ISO-8601 timestamp/);

      // Invalid: out-of-bounds per_page
      assert.throws(() => schema.parse({ per_page: 100 }), /Number must be less than or equal to 50/);
    });

    test('GetOrderInputShape strictly enforces positive safe integer order ID', () => {
      const schema = z.object(GetOrderInputShape);

      // Valid ID
      const valid = schema.parse({ order_id: 14 });
      assert.equal(valid.order_id, 14);

      // Invalid: negative ID
      assert.throws(() => schema.parse({ order_id: -1 }), /Number must be greater than 0/);

      // Invalid: zero
      assert.throws(() => schema.parse({ order_id: 0 }), /Number must be greater than 0/);

      // Invalid: non-integer float
      assert.throws(() => schema.parse({ order_id: 14.5 }), /Expected integer/);

      // Invalid: unsafe integer beyond MAX_SAFE_INTEGER
      assert.throws(() => schema.parse({ order_id: Number.MAX_SAFE_INTEGER + 10 }), /Number must be less than or equal to/);
    });
  });

  // --- 2. list_products Handler Unit Tests ---
  describe('list_products Handler', () => {
    test('successfully returns projected products with filters', async () => {
      let capturedParams: unknown;
      const mockClient = {
        listProducts: async (params: unknown) => {
          capturedParams = params;
          return [dummyProduct];
        },
      } as unknown as WooCommerceClient;

      const handlers = getRegisteredHandlers(mockClient);
      const res = await handlers.list_products.handler({
        page: 1,
        per_page: 10,
        category: '16',
        sku: 'URUMI-MUG-001',
        status: 'publish',
        search: 'Mug',
      });

      assert.equal(res.isError, undefined);
      assert.equal(res.content.length, 1);
      const products = JSON.parse(res.content[0].text);
      assert.equal(products.length, 1);
      assert.equal(products[0].sku, 'URUMI-MUG-001');
      assert.deepEqual(capturedParams, {
        page: 1,
        per_page: 10,
        category: '16',
        sku: 'URUMI-MUG-001',
        status: 'publish',
        search: 'Mug',
      });
    });

    test('handles empty results cleanly returning empty array', async () => {
      const mockClient = {
        listProducts: async () => [],
      } as unknown as WooCommerceClient;

      const handlers = getRegisteredHandlers(mockClient);
      const res = await handlers.list_products.handler({ page: 1, per_page: 10 });

      assert.equal(res.isError, undefined);
      const products = JSON.parse(res.content[0].text);
      assert.deepEqual(products, []);
    });

    test('maps upstream client failure to isError response', async () => {
      const mockClient = {
        listProducts: async () => {
          throw new UpstreamProtocolError('Upstream service returned invalid JSON payload');
        },
      } as unknown as WooCommerceClient;

      const handlers = getRegisteredHandlers(mockClient);
      const res = await handlers.list_products.handler({ page: 1, per_page: 10 });

      assert.equal(res.isError, true);
      assert.ok(res.content[0].text.includes('Invalid or unexpected response structure received from WooCommerce: Upstream service returned invalid JSON payload'));
    });

    test('returns error when client is unconfigured', async () => {
      const handlers = getRegisteredHandlers(undefined);
      const res = await handlers.list_products.handler({ page: 1, per_page: 10 });

      assert.equal(res.isError, true);
      assert.ok(res.content[0].text.includes('WooCommerce API client is not configured'));
    });
  });

  // --- 3. list_orders Handler Unit Tests ---
  describe('list_orders Handler', () => {
    test('successfully returns projected orders list', async () => {
      let capturedParams: unknown;
      const mockClient = {
        listOrders: async (params: unknown) => {
          capturedParams = params;
          return [dummyOrder];
        },
      } as unknown as WooCommerceClient;

      const handlers = getRegisteredHandlers(mockClient);
      const res = await handlers.list_orders.handler({
        page: 1,
        per_page: 10,
        status: 'processing',
        after: '2026-10-01T00:00:00Z',
        before: '2026-10-15T00:00:00Z',
      });

      assert.equal(res.isError, undefined);
      const orders = JSON.parse(res.content[0].text);
      assert.equal(orders.length, 1);
      assert.equal(orders[0].id, 14);
      assert.deepEqual(capturedParams, {
        page: 1,
        per_page: 10,
        status: 'processing',
        after: '2026-10-01T00:00:00Z',
        before: '2026-10-15T00:00:00Z',
      });
    });

    test('rejects after >= before date range before making any upstream call', async () => {
      let clientCalled = false;
      const mockClient = {
        listOrders: async () => {
          clientCalled = true;
          return [];
        },
      } as unknown as WooCommerceClient;

      const handlers = getRegisteredHandlers(mockClient);
      const res = await handlers.list_orders.handler({
        page: 1,
        per_page: 10,
        after: '2026-10-15T00:00:00Z',
        before: '2026-10-01T00:00:00Z', // after > before
      });

      assert.equal(res.isError, true);
      assert.ok(res.content[0].text.includes('"after" timestamp must be strictly earlier than "before" timestamp'));
      assert.equal(clientCalled, false, 'Client must NOT be called on date range validation error');
    });

    test('rejects identical after == before date range before upstream call', async () => {
      let clientCalled = false;
      const mockClient = {
        listOrders: async () => {
          clientCalled = true;
          return [];
        },
      } as unknown as WooCommerceClient;

      const handlers = getRegisteredHandlers(mockClient);
      const res = await handlers.list_orders.handler({
        page: 1,
        per_page: 10,
        after: '2026-10-15T00:00:00Z',
        before: '2026-10-15T00:00:00Z', // after == before
      });

      assert.equal(res.isError, true);
      assert.ok(res.content[0].text.includes('"after" timestamp must be strictly earlier than "before" timestamp'));
      assert.equal(clientCalled, false);
    });

    test('handles empty results returning empty list', async () => {
      const mockClient = {
        listOrders: async () => [],
      } as unknown as WooCommerceClient;

      const handlers = getRegisteredHandlers(mockClient);
      const res = await handlers.list_orders.handler({ page: 1, per_page: 10 });

      assert.equal(res.isError, undefined);
      assert.deepEqual(JSON.parse(res.content[0].text), []);
    });

    test('maps upstream list orders error to isError response', async () => {
      const mockClient = {
        listOrders: async () => {
          throw new Error('Connection refused upstream');
        },
      } as unknown as WooCommerceClient;

      const handlers = getRegisteredHandlers(mockClient);
      const res = await handlers.list_orders.handler({ page: 1, per_page: 10 });

      assert.equal(res.isError, true);
      assert.ok(res.content[0].text.includes('Error listing orders: Connection refused upstream'));
    });
  });

  // --- 4. get_order Handler Unit Tests & PII Contract ---
  describe('get_order Handler & PII Redaction Contract', () => {
    test('successfully retrieves existing order and returns projected summary with line items', async () => {
      const mockClient = {
        getOrder: async (id: number) => {
          assert.equal(id, 14);
          return dummyOrder;
        },
      } as unknown as WooCommerceClient;

      const handlers = getRegisteredHandlers(mockClient);
      const res = await handlers.get_order.handler({ order_id: 14 });

      assert.equal(res.isError, undefined);
      const order = JSON.parse(res.content[0].text);
      assert.equal(order.id, 14);
      assert.equal(order.status, 'processing');
      assert.equal(order.total, '299.00');
      assert.equal(order.line_items.length, 1);
      assert.equal(order.line_items[0].sku, 'URUMI-MUG-001');
    });

    test('PII Omission Contract: verify zero customer PII exists in returned tool output string', async () => {
      const mockClient = {
        getOrder: async () => dummyOrder,
      } as unknown as WooCommerceClient;

      const handlers = getRegisteredHandlers(mockClient);
      const res = await handlers.get_order.handler({ order_id: 14 });

      const text = res.content[0].text;
      const parsed = JSON.parse(text);

      // Verify approved keys exist
      assert.ok('id' in parsed);
      assert.ok('status' in parsed);
      assert.ok('currency' in parsed);
      assert.ok('total' in parsed);
      assert.ok('line_items' in parsed);

      // Strictly verify sensitive PII fields are completely absent from output
      const forbiddenPiiKeys = [
        'billing',
        'shipping',
        'email',
        'customer_email',
        'phone',
        'customer_phone',
        'customer_ip_address',
        'customer_user_agent',
        'customer_note',
        'customer_id',
        'first_name',
        'last_name',
        'address_1',
        'postcode',
      ];

      for (const key of forbiddenPiiKeys) {
        assert.equal(
          key in parsed,
          false,
          `Security violation: Key "${key}" found in tool output payload!`
        );
        assert.equal(
          text.includes(`"${key}"`),
          false,
          `Security violation: Field "${key}" present in raw JSON output string!`
        );
      }
    });

    test('rejects negative or non-safe integer order_id before calling upstream client', async () => {
      let clientCalled = false;
      const mockClient = {
        getOrder: async () => {
          clientCalled = true;
          return dummyOrder;
        },
      } as unknown as WooCommerceClient;

      const handlers = getRegisteredHandlers(mockClient);

      // Negative ID
      const resNeg = await handlers.get_order.handler({ order_id: -5 });
      assert.equal(resNeg.isError, true);
      assert.ok(resNeg.content[0].text.includes('Validation error: "order_id" must be a positive integer'));

      // Non-safe integer
      const resUnsafe = await handlers.get_order.handler({ order_id: 1.5 });
      assert.equal(resUnsafe.isError, true);
      assert.ok(resUnsafe.content[0].text.includes('Validation error: "order_id" must be a positive integer'));

      assert.equal(clientCalled, false, 'Client must NOT be called on invalid order_id');
    });

    test('maps NotFoundError for nonexistent order to descriptive error message', async () => {
      const mockClient = {
        getOrder: async (id: number) => {
          throw new NotFoundError('order', id);
        },
      } as unknown as WooCommerceClient;

      const handlers = getRegisteredHandlers(mockClient);
      const res = await handlers.get_order.handler({ order_id: 999999 });

      assert.equal(res.isError, true);
      assert.ok(res.content[0].text.includes('Error retrieving order 999999: order with ID 999999 not found in store catalog.'));
    });
  });

  // --- 5. Gate G5 Write Tools Handler Unit Tests ---
  describe('Gate G5 Write Tools Handlers', () => {
    describe('create_product Handler', () => {
      test('successfully creates product and returns projected summary', async () => {
        let capturedPayload: unknown;
        const mockClient = {
          createProduct: async (payload: unknown) => {
            capturedPayload = payload;
            return dummyProduct;
          },
        } as unknown as WooCommerceClient;

        const handlers = getRegisteredHandlers(mockClient);
        const res = await handlers.create_product.handler({
          name: 'Urumi Test Mug',
          sku: 'URUMI-MUG-001',
          regular_price: '299.00',
          status: 'publish',
          description: 'Official Urumi ceramic coffee mug.',
          manage_stock: true,
          stock_quantity: 50,
        });

        assert.equal(res.isError, undefined);
        const product = JSON.parse(res.content[0].text);
        assert.equal(product.sku, 'URUMI-MUG-001');
        assert.deepEqual(capturedPayload, {
          name: 'Urumi Test Mug',
          sku: 'URUMI-MUG-001',
          regular_price: '299.00',
          status: 'publish',
          description: 'Official Urumi ceramic coffee mug.',
          manage_stock: true,
          stock_quantity: 50,
        });
      });

      test('rejects zero or negative regular_price before calling client', async () => {
        let clientCalled = false;
        const mockClient = {
          createProduct: async () => {
            clientCalled = true;
            return dummyProduct;
          },
        } as unknown as WooCommerceClient;

        const handlers = getRegisteredHandlers(mockClient);
        const res = await handlers.create_product.handler({
          name: 'Free Mug',
          sku: 'FREE-MUG',
          regular_price: '0.00',
        });

        assert.equal(res.isError, true);
        assert.ok(res.content[0].text.includes('Validation error: "regular_price" must be a positive decimal greater than zero'));
        assert.equal(clientCalled, false);
      });

      test('rejects stock_quantity without manage_stock before calling client', async () => {
        let clientCalled = false;
        const mockClient = {
          createProduct: async () => {
            clientCalled = true;
            return dummyProduct;
          },
        } as unknown as WooCommerceClient;

        const handlers = getRegisteredHandlers(mockClient);
        const res = await handlers.create_product.handler({
          name: 'Stock Mug',
          sku: 'STOCK-MUG',
          regular_price: '199.00',
          manage_stock: false,
          stock_quantity: 10,
        });

        assert.equal(res.isError, true);
        assert.ok(res.content[0].text.includes('Validation error: "stock_quantity" requires "manage_stock" to be true'));
        assert.equal(clientCalled, false);
      });

      test('maps duplicate SKU ConflictError to isError response', async () => {
        const mockClient = {
          createProduct: async () => {
            throw new (await import('../../src/woocommerce/errors.js')).ConflictError(
              'Product with SKU "URUMI-MUG-001" already exists.'
            );
          },
        } as unknown as WooCommerceClient;

        const handlers = getRegisteredHandlers(mockClient);
        const res = await handlers.create_product.handler({
          name: 'Duplicate Mug',
          sku: 'URUMI-MUG-001',
          regular_price: '299.00',
        });

        assert.equal(res.isError, true);
        assert.ok(res.content[0].text.includes('Product with SKU "URUMI-MUG-001" already exists'));
      });

      test('returns error when client is unconfigured', async () => {
        const handlers = getRegisteredHandlers(undefined);
        const res = await handlers.create_product.handler({
          name: 'Mug',
          sku: 'MUG',
          regular_price: '10.00',
        });

        assert.equal(res.isError, true);
        assert.ok(res.content[0].text.includes('WooCommerce API client is not configured'));
      });
    });

    describe('update_order_status Handler', () => {
      test('successfully updates order status and returns mutation result', async () => {
        let capturedArgs: unknown;
        const mockClient = {
          updateOrderStatus: async (id: number, status: string) => {
            capturedArgs = { id, status };
            return {
              id,
              previous_status: 'pending',
              status,
              updated: true,
            };
          },
        } as unknown as WooCommerceClient;

        const handlers = getRegisteredHandlers(mockClient);
        const res = await handlers.update_order_status.handler({
          order_id: 14,
          status: 'completed',
        });

        assert.equal(res.isError, undefined);
        const result = JSON.parse(res.content[0].text);
        assert.equal(result.id, 14);
        assert.equal(result.previous_status, 'pending');
        assert.equal(result.status, 'completed');
        assert.equal(result.updated, true);
        assert.deepEqual(capturedArgs, { id: 14, status: 'completed' });
      });

      test('detects already-matching status as no-op (updated: false)', async () => {
        const mockClient = {
          updateOrderStatus: async (id: number, status: string) => {
            return {
              id,
              previous_status: status,
              status,
              updated: false,
            };
          },
        } as unknown as WooCommerceClient;

        const handlers = getRegisteredHandlers(mockClient);
        const res = await handlers.update_order_status.handler({
          order_id: 14,
          status: 'processing',
        });

        assert.equal(res.isError, undefined);
        const result = JSON.parse(res.content[0].text);
        assert.equal(result.id, 14);
        assert.equal(result.previous_status, 'processing');
        assert.equal(result.status, 'processing');
        assert.equal(result.updated, false);
      });

      test('rejects negative or non-safe integer order_id before calling client', async () => {
        let clientCalled = false;
        const mockClient = {
          updateOrderStatus: async () => {
            clientCalled = true;
            return { id: 14, previous_status: 'pending', status: 'completed', updated: true };
          },
        } as unknown as WooCommerceClient;

        const handlers = getRegisteredHandlers(mockClient);
        const res = await handlers.update_order_status.handler({
          order_id: -1,
          status: 'completed',
        });

        assert.equal(res.isError, true);
        assert.ok(res.content[0].text.includes('Validation error: "order_id" must be a positive integer'));
        assert.equal(clientCalled, false);
      });

      test('maps NotFoundError for nonexistent order to descriptive error message', async () => {
        const mockClient = {
          updateOrderStatus: async (id: number) => {
            throw new NotFoundError('order', id);
          },
        } as unknown as WooCommerceClient;

        const handlers = getRegisteredHandlers(mockClient);
        const res = await handlers.update_order_status.handler({
          order_id: 999999,
          status: 'completed',
        });

        assert.equal(res.isError, true);
        assert.ok(res.content[0].text.includes('Error updating order 999999 status to "completed": order with ID 999999 not found in store catalog.'));
      });

      test('returns error when client is unconfigured', async () => {
        const handlers = getRegisteredHandlers(undefined);
        const res = await handlers.update_order_status.handler({
          order_id: 14,
          status: 'completed',
        });

        assert.equal(res.isError, true);
        assert.ok(res.content[0].text.includes('WooCommerce API client is not configured'));
      });
    });
  });
});
