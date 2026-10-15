import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SEEDED_CONTACTS } from '../../src/data/fixtures.js';
import { CrmContactSchema } from '../../src/tools/schemas.js';

describe('CRM Mock Fixtures and Privacy Unit Tests', () => {
  test('SEEDED_CONTACTS contains exactly 3 synthetic fixtures', () => {
    assert.equal(SEEDED_CONTACTS.length, 3);
  });

  test('All seeded contacts strictly conform to CrmContactSchema', () => {
    for (const contact of SEEDED_CONTACTS) {
      const parsed = CrmContactSchema.safeParse(contact);
      assert.equal(parsed.success, true, `Fixture failed schema validation: ${contact.id}`);
    }
  });

  test('Strict non-PII constraint: all contact emails use the @example.mock domain', () => {
    for (const contact of SEEDED_CONTACTS) {
      assert.match(
        contact.email,
        /^[a-z0-9._%+-]+@example\.mock$/,
        `Email ${contact.email} must strictly use @example.mock domain`
      );
    }
  });

  test('Contact IDs strictly follow the ^CRM-CONT-[0-9]{3}$ format', () => {
    const expectedIds = ['CRM-CONT-001', 'CRM-CONT-002', 'CRM-CONT-003'];
    const actualIds = SEEDED_CONTACTS.map((c) => c.id);
    assert.deepEqual(actualIds, expectedIds);
  });

  test('Zero live customer data: all phone numbers use fictional demonstration prefixes', () => {
    for (const contact of SEEDED_CONTACTS) {
      assert.ok(contact.phone.startsWith('+91-98765-'), `Phone must use fictional prefix: ${contact.phone}`);
    }
  });

  test('Fixtures array is immutable (frozen)', () => {
    assert.throws(() => {
      // @ts-expect-error - testing immutability
      SEEDED_CONTACTS.push({});
    });
  });
});
