import { CrmContact } from '../tools/schemas.js';

/**
 * Seeded Synthetic CRM Contact Fixtures.
 *
 * Privacy Invariants:
 * - Strictly non-PII.
 * - Uses IETF-reserved .mock domain (@example.mock).
 * - Fictional names, company names, and demonstration phone numbers.
 * - Deterministic across all server restarts.
 */
export const SEEDED_CONTACTS: readonly CrmContact[] = Object.freeze([
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
]);
