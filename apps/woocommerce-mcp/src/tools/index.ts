import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ListProductsInputShape,
  CreateProductInputShape,
  ListOrdersInputShape,
  GetOrderInputShape,
  UpdateOrderStatusInputShape,
} from './schemas.js';
import { WooCommerceClient } from '../woocommerce/client.js';

/**
 * Registers exactly the five required WooCommerce tools on the provided McpServer instance.
 *
 * GATE G4 IMPLEMENTATION SCOPE:
 * - Read tools (list_products, list_orders, get_order) are fully wired to WooCommerceClient and response projections.
 * - Write tools (create_product, update_order_status) remain registered for discovery but unactivated until Gate G5.
 */
export function registerAllTools(server: McpServer, client?: WooCommerceClient): void {
  // 1. list_products (Read Tool — Implemented in G4)
  server.registerTool(
    'list_products',
    {
      description: 'List products from the store catalog with bounded pagination and optional filtering by status, search, SKU, or category.',
      inputSchema: ListProductsInputShape,
    },
    async (args) => {
      if (!client) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'WooCommerce API client is not configured.' }],
        };
      }

      try {
        const products = await client.listProducts({
          page: args.page,
          per_page: args.per_page,
          search: args.search,
          sku: args.sku,
          status: args.status,
          category: args.category,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(products, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error listing products: ${message}`,
            },
          ],
        };
      }
    }
  );

  // 2. create_product (Write Tool — Registered for discovery; implementation scheduled for Gate G5)
  server.registerTool(
    'create_product',
    {
      description: 'Create a simple product in the store catalog with strict field validation and duplicate SKU prevention.',
      inputSchema: CreateProductInputShape,
    },
    async () => {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Tool "create_product" is registered for discovery but not activated in Gate G4. Mutation operations are scheduled for Gate G5.',
          },
        ],
      };
    }
  );

  // 3. list_orders (Read Tool — Implemented in G4)
  server.registerTool(
    'list_orders',
    {
      description: 'List customer orders with bounded pagination and status/date filtering. Output strictly redacts customer PII.',
      inputSchema: ListOrdersInputShape,
    },
    async (args) => {
      // Validate date ranges and formats: 'after' must be strictly earlier than 'before'
      if (args.after && isNaN(new Date(args.after).getTime())) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Validation error: Invalid date format in "after" filter.' }],
        };
      }

      if (args.before && isNaN(new Date(args.before).getTime())) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Validation error: Invalid date format in "before" filter.' }],
        };
      }

      if (args.after && args.before) {
        const afterDate = new Date(args.after);
        const beforeDate = new Date(args.before);

        if (afterDate >= beforeDate) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'Validation error: "after" timestamp must be strictly earlier than "before" timestamp.',
              },
            ],
          };
        }
      }

      if (!client) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'WooCommerce API client is not configured.' }],
        };
      }

      try {
        const orders = await client.listOrders({
          page: args.page,
          per_page: args.per_page,
          status: args.status,
          after: args.after,
          before: args.before,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(orders, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error listing orders: ${message}`,
            },
          ],
        };
      }
    }
  );

  // 4. get_order (Read Tool — Implemented in G4)
  server.registerTool(
    'get_order',
    {
      description: 'Retrieve order details by order ID, omitting customer PII (addresses, phone numbers, customer notes, IP, and emails).',
      inputSchema: GetOrderInputShape,
    },
    async (args) => {
      // Validate positive safe integer order ID
      if (!Number.isSafeInteger(args.order_id) || args.order_id <= 0) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Validation error: "order_id" must be a positive integer.' }],
        };
      }

      if (!client) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'WooCommerce API client is not configured.' }],
        };
      }

      try {
        const order = await client.getOrder(args.order_id);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(order, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error retrieving order ${args.order_id}: ${message}`,
            },
          ],
        };
      }
    }
  );

  // 5. update_order_status (Write Tool — Registered for discovery; implementation scheduled for Gate G5)
  server.registerTool(
    'update_order_status',
    {
      description: 'Update the fulfillment status of an order using an approved allow-list (pending, processing, on-hold, completed, cancelled, failed).',
      inputSchema: UpdateOrderStatusInputShape,
    },
    async () => {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Tool "update_order_status" is registered for discovery but not activated in Gate G4. Mutation operations are scheduled for Gate G5.',
          },
        ],
      };
    }
  );
}
