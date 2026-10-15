# ADR-018: Upstream Mock Services Architecture: Synthetic CRM and In-Memory Tasks Contracts

**Status**: Proposed — Pending Technical Head Approval  
**Date**: 2026-10-15 (Revised: 2026-10-15)  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  
**Related Documents**: [`ADR-002`](./ADR-002-mcp-compatibility.md), [`ADR-008`](./ADR-008-five-tool-contract-and-pii-redaction.md), [`ADR-016`](./ADR-016-upstream-catalog-snapshot-and-health-tracking.md)  

---

## 1. Context & Problem Statement

Requirement GTW-02 dictates that the gateway must aggregate at least three distinct upstream MCP servers:
1. **`urumi-woocommerce-mcp`**: The custom WooCommerce MCP service (verified in Phase 3).
2. **`urumi-mcp-crm`**: A deterministic CRM mock service.
3. **`urumi-mcp-tasks`**: A deterministic Tasks/Notes mock service.

To ensure reproducible testing, avoid external third-party dependencies, and enforce privacy standards:
- The CRM service must provide deterministic synthetic records with **zero real customer PII**.
- The Tasks service must validate assignee relationships against the CRM dataset.
- We must define exact idempotency scopes, persistence lifetimes, and strict Zod schema bounds.

---

## 2. Decision & Technical Architecture

### 2.1 CRM Mock Service (`apps/mcp-crm`)
- **Transport**: Stateless Streamable HTTP over port 3000 (`POST /mcp`, `GET /health`).
- **Nature**: Read-only deterministic dataset (zero external database).
- **Synthetic Fixtures (Demonstrably Non-PII)**:
  - All email addresses use the IETF-reserved `.mock` / `.example` domains.
  - All phone numbers use fictional demonstration prefixes.
  - All company names and contact names are fictional entities.

```typescript
export interface CrmContact {
  id: string; // Regex: ^CRM-CONT-[0-9]{3}$
  name: string;
  title: string;
  company: string;
  email: string; // Uses @example.mock domain
  phone: string;
  status: 'active' | 'lead' | 'inactive';
  notes: string;
}

export const SEEDED_CONTACTS: CrmContact[] = [
  {
    id: 'CRM-CONT-001',
    name: 'Alice Smith',
    title: 'Procurement Director',
    company: 'Acme Retail Ltd',
    email: 'alice.smith@example.mock',
    phone: '+91-98765-43210',
    status: 'active',
    notes: 'Key buyer for corporate merchandise and demo mugs.',
  },
  {
    id: 'CRM-CONT-002',
    name: 'Bob Jones',
    title: 'Logistics Manager',
    company: 'Globex Supply Chain',
    email: 'bob.jones@example.mock',
    phone: '+91-98765-43211',
    status: 'active',
    notes: 'Coordinates express shipping and warehouse drop-offs.',
  },
  {
    id: 'CRM-CONT-003',
    name: 'Charlie Brown',
    title: 'Store Operations Lead',
    company: 'Urumi Demo Merchant',
    email: 'charlie.brown@example.mock',
    phone: '+91-98765-43212',
    status: 'lead',
    notes: 'Inquired about notebook bundle pricing.',
  },
];
```

#### CRM Tool Contracts:
1. **`search_contacts`**:
   - **Input Schema**:
     - `query` (optional string, 1..50 characters, trimmed).
     - `limit` (optional integer, min 1, max 20, default 10).
   - **Output**: Array of matching `CrmContact` summaries, deterministically sorted by `id`.
2. **`get_contact`**:
   - **Input Schema**:
     - `contact_id` (string, regex `^CRM-CONT-[0-9]{3}$`).
   - **Output**: Full `CrmContact` record. Nonexistent ID returns a structured error (`isError: true`, message: `"Contact not found"`).

---

### 2.2 Tasks Mock Service (`apps/mcp-tasks`)
- **Transport**: Stateless Streamable HTTP over port 3000 (`POST /mcp`, `GET /health`).
- **State Model & Lifetime**: **Volatile In-Memory Array**.
  - Initialized at process startup with seeded baseline tasks (`TASK-001`, `TASK-002`).
  - Mutations (`create_task`, `update_task_status`) modify the in-memory array.
  - **State-Reset Semantics**: Restarting the pod resets task state back to the initial seeded baseline. This guarantees that automated test runs and Kubernetes crash simulations always start from a known deterministic state.
- **Idempotency Scope**:
  - Optional parameter `idempotency_key` (string, 1..64 characters).
  - The tasks service maintains an in-memory idempotency map (`Map<string, string>` mapping `idempotency_key` to `task_id`).
  - Maximum cache capacity: **1,000 keys** with a **24-hour TTL**.
  - If a `create_task` request arrives with a known `idempotency_key`, the service immediately returns the existing task without creating a duplicate.
- **Assignee Relationship Validation**:
  - `assignee_contact_id` is validated against the approved CRM contact set:
    `const VALID_ASSIGNEES = new Set(['CRM-CONT-001', 'CRM-CONT-002', 'CRM-CONT-003']);`
  - Submitting an unrecognized assignee ID rejects the request with **HTTP 400 Bad Request / InvalidAssigneeError** (`isError: true`, message: `"Unknown assignee_contact_id. Must match a valid CRM contact ID."`).

#### Initial Seeded Tasks:
```typescript
export interface TaskRecord {
  id: string; // Regex: ^TASK-[0-9]{3,}$
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  assignee_contact_id: string; // References CrmContact.id
  idempotency_key?: string;
  created_at: string; // ISO-8601
  updated_at: string;
}

export const SEEDED_TASKS: TaskRecord[] = [
  {
    id: 'TASK-001',
    title: 'Review corporate mug order fulfillment',
    description: 'Verify warehouse inventory for Order 14.',
    priority: 'high',
    status: 'in_progress',
    assignee_contact_id: 'CRM-CONT-001',
    created_at: '2026-10-15T10:00:00.000Z',
    updated_at: '2026-10-15T10:00:00.000Z',
  },
  {
    id: 'TASK-002',
    title: 'Update wireless mouse warranty guide',
    description: 'Prepare warranty documentation for URUMI-MOUSE-001.',
    priority: 'medium',
    status: 'todo',
    assignee_contact_id: 'CRM-CONT-002',
    created_at: '2026-10-15T11:00:00.000Z',
    updated_at: '2026-10-15T11:00:00.000Z',
  },
];
```

#### Tasks Tool Contracts:
1. **`create_task`**:
   - `title` (string, 1..120 characters).
   - `description` (optional string, max 500 characters).
   - `priority` (enum: `'low'`, `'medium'`, `'high'`, `'urgent'`).
   - `assignee_contact_id` (optional string, validated against `VALID_ASSIGNEES`).
   - `idempotency_key` (optional string, 1..64 characters).
2. **`list_tasks`**:
   - `status` (optional enum: `'todo'`, `'in_progress'`, `'done'`, `'cancelled'`).
   - `priority` (optional enum: `'low'`, `'medium'`, `'high'`, `'urgent'`).
   - `limit` (optional integer, min 1, max 50, default 20).
3. **`update_task_status`**:
   - `task_id` (string, regex `^TASK-[0-9]{3,}$`).
   - `status` (enum: `'todo'`, `'in_progress'`, `'done'`, `'cancelled'`).
   - Detects already-matching status as a no-op (`updated: false`). Nonexistent ID returns 404 `isError: true`.

---

## 3. Consequences & Verification
- **Positive**: Complete privacy compliance, zero synthetic PII leakage, verified relational integrity across CRM and Tasks, guaranteed idempotent test resets.
- **Negative**: Tasks do not survive pod restarts (intentional design for test determinism).
- **Verification**: Verified via schema validation unit tests, cross-referencing assignee rejection tests, and idempotency tests.
