import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createCrmMcpServer } from '../../src/server.js';
import { SearchContactsInputShape, GetContactInputShape } from '../../src/tools/schemas.js';
import { AppConfig } from '../../src/config.js';

const DEFAULT_TEST_CONFIG: AppConfig = {
  PORT: 3000,
  HOST: '127.0.0.1',
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  MOCK_DELAY_MS: 0,
  MOCK_FAIL_MODE: 'none',
};

describe('CRM Mock Tools Unit Tests', () => {
  describe('Schema Validation Bounds', () => {
    const searchSchema = z.object(SearchContactsInputShape);
    const getSchema = z.object(GetContactInputShape);

    test('search_contacts accepts valid query and limit', () => {
      const parsed = searchSchema.parse({ query: 'Alice', limit: 5 });
      assert.equal(parsed.query, 'Alice');
      assert.equal(parsed.limit, 5);
    });

    test('search_contacts applies default limit of 10', () => {
      const parsed = searchSchema.parse({});
      assert.equal(parsed.limit, 10);
      assert.equal(parsed.query, undefined);
    });

    test('search_contacts trims query whitespace', () => {
      const parsed = searchSchema.parse({ query: '   Bob   ' });
      assert.equal(parsed.query, 'Bob');
    });

    test('search_contacts rejects limit > 20 or < 1', () => {
      assert.throws(() => searchSchema.parse({ limit: 0 }));
      assert.throws(() => searchSchema.parse({ limit: 21 }));
      assert.throws(() => searchSchema.parse({ limit: -1 }));
    });

    test('search_contacts rejects query > 50 chars', () => {
      assert.throws(() => searchSchema.parse({ query: 'a'.repeat(51) }));
    });

    test('get_contact validates strict ID regex', () => {
      assert.equal(getSchema.parse({ contact_id: 'CRM-CONT-001' }).contact_id, 'CRM-CONT-001');
      assert.throws(() => getSchema.parse({ contact_id: 'CRM-CONT-1' }));
      assert.throws(() => getSchema.parse({ contact_id: 'CONT-001' }));
      assert.throws(() => getSchema.parse({ contact_id: 'random-string' }));
    });
  });

  describe('Tool Handlers Execution', () => {
    test('search_contacts returns all contacts deterministically sorted by ID when query is omitted', async () => {
      const server = createCrmMcpServer(DEFAULT_TEST_CONFIG);
      const tool = (server as any)._registeredTools['search_contacts'];

      const result = await tool.handler({ limit: 10 });
      assert.equal(result.isError, undefined);
      assert.ok(Array.isArray(result.content));
      assert.equal(result.content[0].type, 'text');

      const contacts = JSON.parse(result.content[0].text);
      assert.equal(contacts.length, 3);
      assert.equal(contacts[0].id, 'CRM-CONT-001');
      assert.equal(contacts[1].id, 'CRM-CONT-002');
      assert.equal(contacts[2].id, 'CRM-CONT-003');
    });

    test('search_contacts filters case-insensitively across name, company, email, notes, and title', async () => {
      const server = createCrmMcpServer(DEFAULT_TEST_CONFIG);
      const tool = (server as any)._registeredTools['search_contacts'];

      // Search by company
      const byCompany = await tool.handler({ query: 'globex', limit: 10 });
      const contacts1 = JSON.parse(byCompany.content[0].text);
      assert.equal(contacts1.length, 1);
      assert.equal(contacts1[0].id, 'CRM-CONT-002');

      // Search by notes
      const byNotes = await tool.handler({ query: 'notebook', limit: 10 });
      const contacts2 = JSON.parse(byNotes.content[0].text);
      assert.equal(contacts2.length, 1);
      assert.equal(contacts2[0].id, 'CRM-CONT-003');

      // Search by title
      const byTitle = await tool.handler({ query: 'procurement', limit: 10 });
      const contacts3 = JSON.parse(byTitle.content[0].text);
      assert.equal(contacts3.length, 1);
      assert.equal(contacts3[0].id, 'CRM-CONT-001');
    });

    test('search_contacts respects limit parameter', async () => {
      const server = createCrmMcpServer(DEFAULT_TEST_CONFIG);
      const tool = (server as any)._registeredTools['search_contacts'];

      const res = await tool.handler({ limit: 1 });
      const contacts = JSON.parse(res.content[0].text);
      assert.equal(contacts.length, 1);
      assert.equal(contacts[0].id, 'CRM-CONT-001');
    });

    test('search_contacts returns empty array for non-matching query', async () => {
      const server = createCrmMcpServer(DEFAULT_TEST_CONFIG);
      const tool = (server as any)._registeredTools['search_contacts'];

      const res = await tool.handler({ query: 'nonexistent-entity-query', limit: 10 });
      const contacts = JSON.parse(res.content[0].text);
      assert.equal(contacts.length, 0);
    });

    test('get_contact returns full contact record for valid ID', async () => {
      const server = createCrmMcpServer(DEFAULT_TEST_CONFIG);
      const tool = (server as any)._registeredTools['get_contact'];

      const res = await tool.handler({ contact_id: 'CRM-CONT-001' });
      assert.equal(res.isError, undefined);
      const contact = JSON.parse(res.content[0].text);
      assert.equal(contact.id, 'CRM-CONT-001');
      assert.equal(contact.name, 'Alice Smith');
      assert.equal(contact.email, 'alice.smith@example.mock');
    });

    test('get_contact returns structured error for nonexistent ID', async () => {
      const server = createCrmMcpServer(DEFAULT_TEST_CONFIG);
      const tool = (server as any)._registeredTools['get_contact'];

      const res = await tool.handler({ contact_id: 'CRM-CONT-999' });
      assert.equal(res.isError, true);
      assert.ok(Array.isArray(res.content));
      assert.equal(res.content[0].type, 'text');
      assert.ok(res.content[0].text.includes('Contact not found'));
    });
  });

  describe('Failure Injection Controls', () => {
    test('Simulates tool-error when MOCK_FAIL_MODE is tool-error', async () => {
      const failConfig: AppConfig = {
        ...DEFAULT_TEST_CONFIG,
        MOCK_FAIL_MODE: 'tool-error',
      };
      const server = createCrmMcpServer(failConfig);
      const tool = (server as any)._registeredTools['search_contacts'];

      const res = await tool.handler({ limit: 10 });
      assert.equal(res.isError, true);
      assert.ok(res.content[0].text.includes('Injected failure'));
    });

    test('Simulates delay when MOCK_DELAY_MS is set', async () => {
      const delayConfig: AppConfig = {
        ...DEFAULT_TEST_CONFIG,
        MOCK_DELAY_MS: 50,
      };
      const server = createCrmMcpServer(delayConfig);
      const tool = (server as any)._registeredTools['get_contact'];

      const start = Date.now();
      await tool.handler({ contact_id: 'CRM-CONT-001' });
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 45, `Expected >= 45ms delay, got ${elapsed}ms`);
    });
  });
});
