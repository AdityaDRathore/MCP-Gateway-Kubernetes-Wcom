import { z } from 'zod';

/**
 * Strict input validation schemas for the exactly five immutable MCP tools.
 * Bounds all parameters, strictly formats numeric and decimal values, and rejects arbitrary extensions.
 */

export const OrderStatusEnum = z.enum([
  'pending',
  'processing',
  'on-hold',
  'completed',
  'cancelled',
  'failed',
]);

export const ProductStatusEnum = z.enum([
  'publish',
  'draft',
  'pending',
  'private',
]);

export const CreateProductStatusEnum = z.enum([
  'draft',
  'publish',
]);

// 1. list_products input shape
export const ListProductsInputShape = {
  page: z.number().int().min(1).default(1).describe('Page number of results (1-indexed, positive integer)'),
  per_page: z.number().int().min(1).max(50).default(10).describe('Number of items per page (bounded 1 to 50)'),
  search: z.string().max(100).optional().describe('Optional search query to filter products by title or description'),
  sku: z.string().max(50).optional().describe('Optional SKU filter'),
  status: ProductStatusEnum.optional().describe('Optional product status filter'),
};

// 2. create_product input shape
export const CreateProductInputShape = {
  name: z.string().trim().min(1).max(120).describe('Product title (1 to 120 characters)'),
  sku: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9-_]+$/, 'SKU must contain only alphanumeric, dash, and underscore characters').describe('Unique product SKU'),
  regular_price: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Price must be a valid positive decimal string (e.g. "299.00")').describe('Product price in store currency (decimal string)'),
  description: z.string().max(2000).optional().describe('Optional plain text product description'),
  status: CreateProductStatusEnum.default('draft').describe('Product publication status (defaults to "draft")'),
  manage_stock: z.boolean().optional().describe('Whether stock management is enabled for this product'),
  stock_quantity: z.number().int().nonnegative().optional().describe('Initial stock quantity (requires manage_stock=true)'),
};

// 3. list_orders input shape
export const ListOrdersInputShape = {
  page: z.number().int().min(1).default(1).describe('Page number of results (1-indexed, positive integer)'),
  per_page: z.number().int().min(1).max(50).default(10).describe('Number of orders per page (bounded 1 to 50)'),
  status: OrderStatusEnum.optional().describe('Optional order status filter'),
  after: z.string().datetime({ message: 'Must be a valid ISO-8601 timestamp' }).optional().describe('Optional ISO-8601 start timestamp filter'),
  before: z.string().datetime({ message: 'Must be a valid ISO-8601 timestamp' }).optional().describe('Optional ISO-8601 end timestamp filter'),
};

// 4. get_order input shape
export const GetOrderInputShape = {
  order_id: z.number().int().positive().describe('Unique WooCommerce order ID (positive integer)'),
};

// 5. update_order_status input shape
export const UpdateOrderStatusInputShape = {
  order_id: z.number().int().positive().describe('Unique WooCommerce order ID to update (positive integer)'),
  status: OrderStatusEnum.describe('Target order status from approved allow-list'),
};
