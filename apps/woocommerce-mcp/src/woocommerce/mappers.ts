import { WooProduct, WooOrder } from './schemas.js';

/**
 * Output projection types ensuring minimal, model-friendly payloads and zero customer PII.
 */

export interface ProjectedCategory {
  id: number;
  name: string;
}

export interface ProjectedProduct {
  id: number;
  name: string;
  sku: string;
  type: string;
  status: string;
  price: string;
  regular_price: string;
  stock_status?: string;
  categories: ProjectedCategory[];
}

export interface ProjectedLineItem {
  id: number;
  name: string;
  product_id: number;
  quantity: number;
  subtotal: string;
  total: string;
  sku: string;
}

export interface ProjectedOrder {
  id: number;
  status: string;
  currency: string;
  total: string;
  date_created?: string;
  payment_method?: string;
  line_items: ProjectedLineItem[];
}

/**
 * Projects a raw WooCommerce product into a bounded, model-safe object.
 */
export function projectProduct(raw: WooProduct): ProjectedProduct {
  return {
    id: raw.id,
    name: raw.name,
    sku: raw.sku,
    type: raw.type,
    status: raw.status,
    price: raw.price,
    regular_price: raw.regular_price,
    stock_status: raw.stock_status,
    categories: raw.categories.map((c) => ({
      id: c.id,
      name: c.name,
    })),
  };
}

/**
 * Projects a raw WooCommerce order into a sanitized summary.
 * STRICT PRIVACY REQUIREMENT:
 * Excludes billing/shipping addresses, customer email, customer phone, IP address, user agent,
 * and customer notes to prevent leaking PII to LLM context windows or logs.
 */
export function projectOrder(raw: WooOrder): ProjectedOrder {
  return {
    id: raw.id,
    status: raw.status,
    currency: raw.currency,
    total: raw.total,
    date_created: raw.date_created,
    payment_method: raw.payment_method_title || raw.payment_method,
    line_items: raw.line_items.map((item) => ({
      id: item.id,
      name: item.name,
      product_id: item.product_id,
      quantity: item.quantity,
      subtotal: item.subtotal,
      total: item.total,
      sku: item.sku || '',
    })),
  };
}
