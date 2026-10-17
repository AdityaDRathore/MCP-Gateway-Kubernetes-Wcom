import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateToolArguments } from '../../src/upstream/json-schema-validator.js';

describe('Gateway JSON Schema Argument Validator Unit Tests', () => {
  it('validates valid object matching string, integer, and enum properties', () => {
    const schema = {
      type: 'object',
      required: ['id', 'status'],
      properties: {
        id: { type: 'string', pattern: '^CRM-CONT-[0-9]{3}$' },
        status: { type: 'string', enum: ['active', 'inactive', 'pending'] },
        count: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    };

    const validArgs = {
      id: 'CRM-CONT-001',
      status: 'active',
      count: 5,
    };

    const result = validateToolArguments(schema, validArgs);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('rejects missing required properties', () => {
    const schema = {
      type: 'object',
      required: ['name', 'price'],
      properties: {
        name: { type: 'string' },
        price: { type: 'number' },
      },
    };

    const result = validateToolArguments(schema, { name: 'T-Shirt' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === '#/price' && e.message.includes('Required property')));
  });

  it('rejects non-object root arguments', () => {
    const schema = {
      type: 'object',
      properties: { title: { type: 'string' } },
    };

    const arrayResult = validateToolArguments(schema, ['item1']);
    assert.equal(arrayResult.valid, false);
    assert.match(arrayResult.errors[0].message, /Arguments must be an object/);

    const stringResult = validateToolArguments(schema, 'not an object');
    assert.equal(stringResult.valid, false);
    assert.match(stringResult.errors[0].message, /Arguments must be an object/);
  });

  it('permits undefined or empty arguments when no required properties exist', () => {
    const schema = {
      type: 'object',
      properties: {
        filter: { type: 'string' },
      },
    };

    const undefinedResult = validateToolArguments(schema, undefined);
    assert.equal(undefinedResult.valid, true);

    const emptyResult = validateToolArguments(schema, {});
    assert.equal(emptyResult.valid, true);
  });

  it('rejects type mismatches: integer vs float, string vs number', () => {
    const schema = {
      type: 'object',
      properties: {
        quantity: { type: 'integer' },
        title: { type: 'string' },
      },
    };

    const floatResult = validateToolArguments(schema, { quantity: 3.14 });
    assert.equal(floatResult.valid, false);
    assert.match(floatResult.errors[0].message, /Expected integer, received float/);

    const stringResult = validateToolArguments(schema, { title: 12345 });
    assert.equal(stringResult.valid, false);
    assert.match(stringResult.errors[0].message, /Expected type string, received number/);
  });

  it('enforces numeric bounds: minimum, maximum, exclusiveMinimum, exclusiveMaximum', () => {
    const schema = {
      type: 'object',
      properties: {
        score: { type: 'number', minimum: 10, maximum: 50 },
        rate: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 },
      },
    };

    const tooLow = validateToolArguments(schema, { score: 9 });
    assert.equal(tooLow.valid, false);
    assert.match(tooLow.errors[0].message, /less than minimum 10/);

    const tooHigh = validateToolArguments(schema, { score: 51 });
    assert.equal(tooHigh.valid, false);
    assert.match(tooHigh.errors[0].message, /exceeds maximum 50/);

    const exclusiveZero = validateToolArguments(schema, { rate: 0 });
    assert.equal(exclusiveZero.valid, false);
    assert.match(exclusiveZero.errors[0].message, /strictly greater than 0/);

    const exclusiveOne = validateToolArguments(schema, { rate: 1 });
    assert.equal(exclusiveOne.valid, false);
    assert.match(exclusiveOne.errors[0].message, /strictly less than 1/);

    const validBounds = validateToolArguments(schema, { score: 25, rate: 0.5 });
    assert.equal(validBounds.valid, true);
  });

  it('enforces string constraints: minLength, maxLength, and regex pattern', () => {
    const schema = {
      type: 'object',
      properties: {
        code: { type: 'string', minLength: 3, maxLength: 6, pattern: '^[A-Z]+$' },
      },
    };

    const tooShort = validateToolArguments(schema, { code: 'AB' });
    assert.equal(tooShort.valid, false);
    assert.match(tooShort.errors[0].message, /shorter than minLength/);

    const tooLong = validateToolArguments(schema, { code: 'ABCDEFG' });
    assert.equal(tooLong.valid, false);
    assert.match(tooLong.errors[0].message, /exceeds maxLength/);

    const badPattern = validateToolArguments(schema, { code: 'abc' });
    assert.equal(badPattern.valid, false);
    assert.match(badPattern.errors[0].message, /does not match required pattern/);

    const validString = validateToolArguments(schema, { code: 'ABCD' });
    assert.equal(validString.valid, true);
  });

  it('enforces enums and const strictly', () => {
    const schema = {
      type: 'object',
      properties: {
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        version: { const: 1 },
      },
    };

    const badEnum = validateToolArguments(schema, { priority: 'critical' });
    assert.equal(badEnum.valid, false);
    assert.match(badEnum.errors[0].message, /Value must be one of/);

    const badConst = validateToolArguments(schema, { version: 2 });
    assert.equal(badConst.valid, false);
    assert.match(badConst.errors[0].message, /strictly equal to const 1/);

    const validConst = validateToolArguments(schema, { priority: 'medium', version: 1 });
    assert.equal(validConst.valid, true);
  });

  it('recursively validates nested objects and additionalProperties: false', () => {
    const schema = {
      type: 'object',
      required: ['billing'],
      properties: {
        billing: {
          type: 'object',
          required: ['city'],
          properties: {
            city: { type: 'string' },
            postalCode: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    };

    // Unknown top-level property
    const badTop = validateToolArguments(schema, { billing: { city: 'City' }, extra: 123 });
    assert.equal(badTop.valid, false);
    assert.match(badTop.errors[0].message, /Unexpected property 'extra'/);

    // Missing nested required property
    const missingNested = validateToolArguments(schema, { billing: { postalCode: '12345' } });
    assert.equal(missingNested.valid, false);
    assert.match(missingNested.errors[0].message, /Required property 'city'/);

    // Unknown nested property with additionalProperties: false
    const badNested = validateToolArguments(schema, { billing: { city: 'City', rogue: 'val' } });
    assert.equal(badNested.valid, false);
    assert.match(badNested.errors[0].message, /Unexpected property 'rogue'/);

    // Valid nested object
    const validNested = validateToolArguments(schema, { billing: { city: 'Springfield', postalCode: '12345' } });
    assert.equal(validNested.valid, true);
  });

  it('validates array items and bounds (minItems, maxItems)', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: { type: 'string', minLength: 2 },
        },
      },
    };

    const emptyArray = validateToolArguments(schema, { tags: [] });
    assert.equal(emptyArray.valid, false);
    assert.match(emptyArray.errors[0].message, /less than minItems/);

    const tooMany = validateToolArguments(schema, { tags: ['tag1', 'tag2', 'tag3', 'tag4'] });
    assert.equal(tooMany.valid, false);
    assert.match(tooMany.errors[0].message, /exceeds maxItems/);

    const badItem = validateToolArguments(schema, { tags: ['t'] });
    assert.equal(badItem.valid, false);
    assert.match(badItem.errors[0].message, /shorter than minLength/);

    const validArray = validateToolArguments(schema, { tags: ['tag1', 'tag2'] });
    assert.equal(validArray.valid, true);
  });

  it('handles nullability and union nulls correctly', () => {
    const schema = {
      type: 'object',
      properties: {
        nullableField: { type: 'string', nullable: true },
        unionNullField: { type: ['string', 'null'] },
        strictField: { type: 'string' },
      },
    };

    assert.equal(validateToolArguments(schema, { nullableField: null }).valid, true);
    assert.equal(validateToolArguments(schema, { unionNullField: null }).valid, true);

    const strictResult = validateToolArguments(schema, { strictField: null });
    assert.equal(strictResult.valid, false);
    assert.match(strictResult.errors[0].message, /Value cannot be null/);
  });
});
