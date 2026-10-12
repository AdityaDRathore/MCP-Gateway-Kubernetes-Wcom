# Five-Tool Contract: Custom WooCommerce MCP Server

**Document Type:** MCP Interface Specification & Data Contract  
**Component:** `apps/woocommerce-mcp`  
**Transport:** Streamable HTTP (`POST /mcp`)  
**MCP SDK:** `@modelcontextprotocol/sdk@1.32.1` (Wire Revision `2024-11-05`)  
**Date:** 2026-10-13  
**Status:** Approved for Gate G8  

---

## 1. Overview & Protocol Guarantees

The **WooCommerce MCP Server** implements exactly five tools. No debug, administrative, mock, or proxy tools are registered or discoverable.

```
┌────────────────────────────────────────────────────────┐
│  Discovered Tools (tools/list)                         │
├────────────────────────────────────────────────────────┤
│  1. list_products       - Search & list catalog items  │
│  2. create_product      - Create catalog product       │
│  3. list_orders         - List store orders            │
│  4. get_order           - Retrieve sanitized order     │
│  5. update_order_status - Update order fulfillment     │
└────────────────────────────────────────────────────────┘
```

### Protocol Standards:
- **Wire Transport:** Stateless Streamable HTTP (`POST /mcp`).
- **Input Validation:** Enforced locally by Zod before initiating upstream network calls. Invalid arguments are rejected immediately with `isError: true` without reaching WooCommerce.
- **Privacy & PII:** Zero customer Personally Identifiable Information (PII) is exposed in responses. Billing, shipping, customer notes, IP addresses, emails, and phone numbers are strictly omitted.
- **Idempotency & Retries:** Write tools (`create_product`, `update_order_status`) never execute blind retries on ambiguous network timeouts.

---

## 2. Tool 1: `list_products`

### 2.1 Description
Searches and lists published or draft products from the WooCommerce catalog with bounded pagination and filtering.

### 2.2 Input Schema (`zod`)
```typescript
{
  page: z.number().int().min(1).default(1),
  per_page: z.number().int().min(1).max(50).default(10),
  category: z.number().int().positive().optional(),
  status: z.enum(['draft', 'pending', 'private', 'publish']).optional(),
  search: z.string().min(1).max(100).optional(),
  sku: z.string().min(1).max(50).optional()
}
```

### 2.3 Upstream Mapping
- **Endpoint:** `GET /wp-json/wc/v3/products`
- **Query Params:** `page`, `per_page`, `category`, `status`, `search`, `sku`.

### 2.4 Output Projection
```json
[
  {
    "id": 10,
    "name": "Urumi Test Mug",
    "sku": "URUMI-MUG-001",
    "type": "simple",
    "status": "publish",
    "price": "299.00",
    "regular_price": "299.00",
    "stock_status": "instock",
    "categories": [
      { "id": 15, "name": "Merchandise" }
    ]
  }
]
```

---

## 3. Tool 2: `create_product`

### 3.1 Description
Creates a new catalog product in WooCommerce. Validates SKU existence prior to creation to prevent database conflicts.

### 3.2 Input Schema (`zod`)
```typescript
{
  name: z.string().min(1).max(120),
  sku: z.string().regex(/^[A-Za-z0-9-_]+$/, "SKU must contain only alphanumeric characters, dashes, and underscores").max(50),
  regular_price: z.string().regex(/^\d+(\.\d{1,2})?$/, "regular_price must be a valid positive decimal string"),
  description: z.string().max(2000).optional(),
  status: z.enum(['draft', 'publish']).default('publish'),
  manage_stock: z.boolean().default(false),
  stock_quantity: z.number().int().min(0).optional()
}
// Refinement: If manage_stock is true, stock_quantity must be provided.
```

### 3.3 Upstream Mapping & Pre-Flight Conflict Check
1. Pre-flight check: Queries `GET /wp-json/wc/v3/products?sku=<sku>`. If product exists, aborts with `ConflictError: Product with SKU '<sku>' already exists`.
2. Mutation: `POST /wp-json/wc/v3/products`.
3. Timeout: Aborts after 10s via `AbortController`. Zero retries.

### 3.4 Output Projection
```json
{
  "id": 19,
  "name": "Urumi Demo Sticker",
  "sku": "URUMI-STICKER-001",
  "type": "simple",
  "status": "publish",
  "price": "49.00",
  "regular_price": "49.00",
  "stock_status": "instock",
  "categories": []
}
```

---

## 4. Tool 3: `list_orders`

### 4.1 Description
Retrieves a paginated list of store orders filtered by status or date range. Strictly omits customer PII.

### 4.2 Input Schema (`zod`)
```typescript
{
  page: z.number().int().min(1).default(1),
  per_page: z.number().int().min(1).max(50).default(10),
  status: z.enum(['any', 'pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed']).default('any'),
  after: z.string().datetime().optional(),
  before: z.string().datetime().optional()
}
// Refinement: If both after and before are provided, after must be strictly earlier than before.
```

### 4.3 Upstream Mapping
- **Endpoint:** `GET /wp-json/wc/v3/orders`
- **Query Params:** `page`, `per_page`, `status`, `after`, `before`.

### 4.4 Output Projection (Zero PII)
```json
[
  {
    "id": 14,
    "status": "processing",
    "currency": "INR",
    "total": "299.00",
    "date_created": "2026-10-12T14:32:00",
    "payment_method": "cod",
    "line_items": [
      {
        "id": 1,
        "name": "Urumi Test Mug",
        "product_id": 10,
        "quantity": 1,
        "subtotal": "299.00",
        "total": "299.00",
        "sku": "URUMI-MUG-001"
      }
    ]
  }
]
```

---

## 5. Tool 4: `get_order`

### 5.1 Description
Retrieves detailed information for a single order by ID. Customer billing/shipping addresses, phone numbers, and emails are stripped.

### 5.2 Input Schema (`zod`)
```typescript
{
  order_id: z.number().int().positive()
}
```

### 5.3 Upstream Mapping
- **Endpoint:** `GET /wp-json/wc/v3/orders/:order_id`

### 5.4 Output Projection (Zero PII)
```json
{
  "id": 14,
  "status": "processing",
  "currency": "INR",
  "total": "299.00",
  "date_created": "2026-10-12T14:32:00",
  "payment_method": "cod",
  "line_items": [
    {
      "id": 1,
      "name": "Urumi Test Mug",
      "product_id": 10,
      "quantity": 1,
      "subtotal": "299.00",
      "total": "299.00",
      "sku": "URUMI-MUG-001"
    }
  ]
}
```

---

## 6. Tool 5: `update_order_status`

### 6.1 Description
Updates the fulfillment status of an order using an approved status allow-list. Features built-in no-op detection.

### 6.2 Input Schema (`zod`)
```typescript
{
  order_id: z.number().int().positive(),
  status: z.enum(['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'failed'])
}
```

### 6.3 Upstream Mapping & No-Op Detection
1. Fetches current order state: `GET /wp-json/wc/v3/orders/:order_id`.
2. If `current.status === requested.status`, returns immediately without upstream mutation:
   ```json
   {
     "order_id": 14,
     "previous_status": "processing",
     "new_status": "processing",
     "updated": false,
     "message": "Order 14 is already in status 'processing'"
   }
   ```
3. If status differs, sends minimal payload `{ "status": status }` via `PUT /wp-json/wc/v3/orders/:order_id`.
4. Timeout: Aborts after 10s via `AbortController`. Zero blind retries.

### 6.4 Successful Mutation Output
```json
{
  "order_id": 21,
  "previous_status": "processing",
  "new_status": "completed",
  "updated": true,
  "message": "Order 21 status updated to 'completed'"
}
```

---

## 7. Centralized Error Mapping

All upstream HTTP status codes and operational failures are mapped to safe model-facing MCP errors:

| Upstream Code | Error Class | Model-Facing Message Format | `isError` |
|---|---|---|:---:|
| `400` / Invalid Input | `ValidationError` | `Validation failed: <parameter details>` | `true` |
| `401` / `403` Auth Failure | `AuthenticationError` | `WooCommerce authentication failed: <upstream message>` | `true` |
| `404` Not Found | `NotFoundError` | `<Resource> with ID <id> not found` | `true` |
| `409` Conflict | `ConflictError` | `Resource conflict: <details>` | `true` |
| `429` Rate Limit | `RateLimitError` | `WooCommerce API rate limit exceeded` | `true` |
| `5xx` Upstream Failure | `WooCommerceError` | `Upstream WooCommerce API error (status: 500)` | `true` |
| Timeout (>10s) | `UpstreamTimeoutError` | `Request to WooCommerce API timed out after 10000ms` | `true` |

*Security Guarantee: Stack traces, internal file paths, MySQL query snippets, and raw authorization headers are never returned in MCP error responses.*
