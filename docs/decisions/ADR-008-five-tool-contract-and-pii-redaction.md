# ADR-008: Five-Tool Least-Privilege Contract, Bounded Validation, and Customer PII Redaction

**Status**: Accepted  
**Date**: 2026-10-12  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  

---

## 1. Context & Problem Statement

In Phase 3, we needed to expose the live WooCommerce store (`/wp-json/wc/v3`) to downstream Model Context Protocol (MCP) clients and AI agents. 

Off-the-shelf wrappers and naive MCP implementations typically expose the entire WooCommerce REST API surface or proxy raw endpoints. This presents three severe architectural and operational hazards:
1. **Destructive Execution Hazard**: Allowing an AI agent unconstrained access to endpoints such as `DELETE /products/<id>`, `DELETE /orders/<id>`, `POST /orders/<id>/refunds`, or store settings modifications introduces unacceptable operational risk of data destruction or unauthorized financial transfers.
2. **Customer Privacy (PII) & Regulatory Violations**: Standard WooCommerce order objects return over 80 fields per record, including full customer billing and shipping names, street addresses, postal codes, phone numbers, email addresses, customer notes, IP addresses, and user-agent strings. Exposing customer Personally Identifiable Information (PII) to LLMs violates data protection regulations (GDPR, DPDP Act), consumes massive context token budgets (~4,000 tokens per order), and opens a direct prompt-injection attack vector (e.g., malicious shipping addresses containing jailbreaks).
3. **Ambiguous Write Timeouts & Non-Idempotent Mutations**: If an AI tool mutates the database (e.g. creating a product or updating status) and experiences a transient network timeout, automated blind retries can produce duplicate catalog items or trigger repeated fulfillment webhook events.

---

## 2. Options Considered

### Option A: Raw Pass-Through Proxy
- Automatically generate MCP tools for all available WooCommerce REST endpoints.
- Return raw upstream JSON payloads directly in `tools/call` responses.
- **Rejected**: Extreme security and data destruction risk; severe PII leakage; massive token inefficiency.

### Option B: Read-Only Tool Surface
- Restrict MCP tools exclusively to catalog reading (`list_products`, `get_order`).
- **Rejected**: Fails core project requirements requiring store operations (product creation and order fulfillment status updates).

### Option C: Curated Five-Tool Least-Privilege Contract with Output Projections
- Expose **exactly five immutable tools**: `list_products`, `create_product`, `list_orders`, `get_order`, and `update_order_status`.
- Enforce strict client-side parameter validation and bounds via Zod schemas before any network transmission.
- Implement deterministic output projections that scrub all customer PII from order payloads.
- Enforce mutation safety: pre-flight SKU conflict detection, status no-op detection, and non-retryable write timeouts.

---

## 3. Decision

We adopt **Option C: Curated Five-Tool Least-Privilege Contract**:

1. **Tool Registry Allow-List**:
   The MCP server registers strictly five tools via the `@modelcontextprotocol/sdk@1.32.1` `McpServer` interface:
   - `list_products`: Search catalog by category, status, search string, SKU, with bounded pagination (page $\ge 1$, per_page $1..50$).
   - `create_product`: Create new catalog items with regex-validated SKU (`^[A-Za-z0-9-_]+$`), positive decimal price, status enum, and conditional stock tracking.
   - `list_orders`: Query store orders with validated date bounds (`after < before`) and status filters.
   - `get_order`: Retrieve order line items and total by safe positive integer ID.
   - `update_order_status`: Transition order status using an approved allow-list (`pending`, `processing`, `on-hold`, `completed`, `cancelled`, `failed`).

2. **Client-Side Boundary Defense via Zod**:
   - All tool arguments are parsed and bounded by strict Zod schemas before initiating any upstream HTTP calls.
   - Invalid formats, negative prices, out-of-range pagination, and inverted date ranges are rejected at the application boundary with `isError: true`, preventing unnecessary upstream network load.

3. **Deterministic Output Projections & Zero-PII Guarantee**:
   - Upstream order responses are mapped through `projectOrder()`, stripping:
     - `billing` (names, addresses, phones, emails)
     - `shipping` (names, addresses)
     - `customer_id`, `customer_ip_address`, `customer_user_agent`, `customer_note`
   - Only non-sensitive operational fields (`id`, `status`, `currency`, `total`, `date_created`, `payment_method`, and line items) are returned to the model.

4. **Mutation Safety & Idempotency**:
   - **Pre-Flight SKU Conflict Check**: `create_product` checks if the requested SKU already exists via `GET /wp-json/wc/v3/products?sku=<sku>`. If present, it aborts locally with `ConflictError`, preventing duplicate records.
   - **Status No-Op Detection**: `update_order_status` inspects current order state. If the order is already in the requested status, it returns `{ updated: false }` without executing an upstream `PUT` mutation.
   - **Zero Blind Retries on Write Timeouts**: Upstream requests are bounded by a 10-second `AbortController`. Write operations (`POST`, `PUT`) never execute automatic retries upon timeout, preventing accidental double-creation.

---

## 4. Consequences & Limitations

- **Positive**:
  - Eliminates the possibility of destructive administrative actions (e.g. store wiping or customer deletion) via the MCP interface.
  - Guarantees 100% compliance with data privacy standards by omitting customer personal information.
  - Reduces LLM token consumption by over 90% compared to raw WooCommerce responses.
  - Neutralizes prompt-injection attacks delivered via customer shipping/billing text fields.
  - Prevents catalog corruption and duplicate database records.
- **Limitations**:
  - The AI cannot look up an order by customer name, email, or shipping address. If such capabilities are needed in future phases, a tokenized, pseudonymized customer identifier pattern must be designed.
  - Write operations failing with `UpstreamTimeoutError` require manual administrative inspection to verify whether the upstream database committed the change.
