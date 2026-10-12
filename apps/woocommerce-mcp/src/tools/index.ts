import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ListProductsInputShape,
  CreateProductInputShape,
  ListOrdersInputShape,
  GetOrderInputShape,
  UpdateOrderStatusInputShape,
} from './schemas.js';

/**
 * Registers exactly the five required WooCommerce tools on the provided McpServer instance.
 * No generic proxy, SQL, or debug tools are exposed.
 */
export function registerAllTools(server: McpServer): void {
  // 1. list_products
  server.registerTool(
    'list_products',
    {
      description: 'List products from the store catalog with bounded pagination and optional filtering by status, search, or SKU.',
      inputSchema: ListProductsInputShape,
    },
    async (args) => {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'list_products skeleton executed',
              query: args,
              status: 'skeleton_ready',
            }),
          },
        ],
      };
    }
  );

  // 2. create_product
  server.registerTool(
    'create_product',
    {
      description: 'Create a simple product in the store catalog with strict field validation and duplicate SKU prevention.',
      inputSchema: CreateProductInputShape,
    },
    async (args) => {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'create_product skeleton executed',
              payload: { name: args.name, sku: args.sku, regular_price: args.regular_price, status: args.status },
              status: 'skeleton_ready',
            }),
          },
        ],
      };
    }
  );

  // 3. list_orders
  server.registerTool(
    'list_orders',
    {
      description: 'List customer orders with bounded pagination and status filtering. Output strictly redacts customer PII.',
      inputSchema: ListOrdersInputShape,
    },
    async (args) => {
      // Validate after < before if both supplied
      if (args.after && args.before && new Date(args.after) >= new Date(args.before)) {
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

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'list_orders skeleton executed',
              query: args,
              status: 'skeleton_ready',
            }),
          },
        ],
      };
    }
  );

  // 4. get_order
  server.registerTool(
    'get_order',
    {
      description: 'Retrieve order details by order ID, omitting customer PII (addresses, phone numbers, and emails).',
      inputSchema: GetOrderInputShape,
    },
    async (args) => {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'get_order skeleton executed',
              order_id: args.order_id,
              status: 'skeleton_ready',
            }),
          },
        ],
      };
    }
  );

  // 5. update_order_status
  server.registerTool(
    'update_order_status',
    {
      description: 'Update the fulfillment status of an order using an approved allow-list (pending, processing, on-hold, completed, cancelled, failed).',
      inputSchema: UpdateOrderStatusInputShape,
    },
    async (args) => {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'update_order_status skeleton executed',
              order_id: args.order_id,
              status: args.status,
              updated: true,
            }),
          },
        ],
      };
    }
  );
}
