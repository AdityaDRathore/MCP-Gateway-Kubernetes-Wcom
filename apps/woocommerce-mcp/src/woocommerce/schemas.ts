import { z } from 'zod';

/**
 * Zod validation schemas for upstream WooCommerce REST API JSON responses.
 * Enforces structure before output projection to prevent runtime exceptions.
 */

export const WooCategorySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string().optional(),
});

export const WooProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string().optional(),
  type: z.string().default('simple'),
  status: z.string(),
  sku: z.string().default(''),
  price: z.string().default('0'),
  regular_price: z.string().default('0'),
  stock_status: z.string().optional(),
  manage_stock: z.boolean().optional(),
  stock_quantity: z.number().nullable().optional(),
  categories: z.array(WooCategorySchema).default([]),
});

export const WooLineItemSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  product_id: z.number().int(),
  quantity: z.number().int(),
  subtotal: z.string().default('0'),
  total: z.string().default('0'),
  sku: z.string().nullable().optional(),
});

export const WooOrderSchema = z.object({
  id: z.number().int(),
  status: z.string(),
  currency: z.string().default('INR'),
  total: z.string().default('0'),
  date_created: z.string().optional(),
  payment_method: z.string().optional(),
  payment_method_title: z.string().optional(),
  line_items: z.array(WooLineItemSchema).default([]),
});

export const WooProductListSchema = z.array(WooProductSchema);
export const WooOrderListSchema = z.array(WooOrderSchema);

export type WooProduct = z.infer<typeof WooProductSchema>;
export type WooOrder = z.infer<typeof WooOrderSchema>;
export type WooLineItem = z.infer<typeof WooLineItemSchema>;
