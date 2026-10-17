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

  it('handles required properties with null values according to property schema nullability', () => {
    const schema = {
      type: 'object',
      required: ['nullableRequired', 'unionRequired', 'strictRequired'],
      properties: {
        nullableRequired: { type: 'string', nullable: true },
        unionRequired: { type: ['string', 'null'] },
        strictRequired: { type: 'string' },
      },
    };

    // Both nullableRequired and unionRequired allow null; strictRequired does not
    const result = validateToolArguments(schema, {
      nullableRequired: null,
      unionRequired: null,
      strictRequired: null,
    });

    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].path, '#/strictRequired');
    assert.match(result.errors[0].message, /Value cannot be null/);

    // Completely missing required property
    const missingResult = validateToolArguments(schema, {
      nullableRequired: null,
      unionRequired: null,
    });
    assert.equal(missingResult.valid, false);
    assert.ok(missingResult.errors.some((e) => e.path === '#/strictRequired' && e.message.includes('Required property')));

    // All required satisfied with valid values including permitted nulls
    const validResult = validateToolArguments(schema, {
      nullableRequired: null,
      unionRequired: null,
      strictRequired: 'valid-string',
    });
    assert.equal(validResult.valid, true);
  });

  it('validates deep equality for object and array values in enum and const', () => {
    const schema = {
      type: 'object',
      properties: {
        roleConfig: {
          enum: [
            { level: 'admin', tier: 1 },
            { level: 'member', tier: 2 },
          ],
        },
        coordinates: {
          enum: [
            [0, 0],
            [10, 20],
          ],
        },
        exactHeader: {
          const: {
            service: 'urumi-gateway',
            tags: ['internal', 'authenticated'],
          },
        },
      },
    };

    // Valid with distinct object/array references
    const validResult = validateToolArguments(schema, {
      roleConfig: { level: 'admin', tier: 1 },
      coordinates: [10, 20],
      exactHeader: { service: 'urumi-gateway', tags: ['internal', 'authenticated'] },
    });
    assert.equal(validResult.valid, true);

    // Invalid enum object
    const badRoleResult = validateToolArguments(schema, {
      roleConfig: { level: 'admin', tier: 99 },
    });
    assert.equal(badRoleResult.valid, false);
    assert.match(badRoleResult.errors[0].message, /Value must be one of/);

    // Invalid enum array
    const badCoordsResult = validateToolArguments(schema, {
      coordinates: [10, 99],
    });
    assert.equal(badCoordsResult.valid, false);
    assert.match(badCoordsResult.errors[0].message, /Value must be one of/);

    // Invalid const object
    const badConstResult = validateToolArguments(schema, {
      exactHeader: { service: 'urumi-gateway', tags: ['internal'] },
    });
    assert.equal(badConstResult.valid, false);
    assert.match(badConstResult.errors[0].message, /Value must be strictly equal to const/);
  });

  it('explicitly rejects unsupported JSON Schema keywords rather than silently accepting them', () => {
    // Unsupported root keywords
    assert.equal(
      validateToolArguments({ type: 'object', oneOf: [{ properties: { a: { type: 'string' } } }] }, { a: 'foo' }).valid,
      false
    );
    assert.match(
      validateToolArguments({ type: 'object', oneOf: [] }, {}).errors[0].message,
      /Unsupported JSON Schema keyword 'oneOf'/
    );

    assert.match(
      validateToolArguments({ type: 'object', anyOf: [] }, {}).errors[0].message,
      /Unsupported JSON Schema keyword 'anyOf'/
    );

    assert.match(
      validateToolArguments({ type: 'object', allOf: [] }, {}).errors[0].message,
      /Unsupported JSON Schema keyword 'allOf'/
    );

    assert.match(
      validateToolArguments({ type: 'object', not: {} }, {}).errors[0].message,
      /Unsupported JSON Schema keyword 'not'/
    );

    // Unsupported property keywords
    const refSchema = {
      type: 'object',
      properties: {
        target: { $ref: '#/definitions/Target' },
      },
    };
    const refResult = validateToolArguments(refSchema, { target: {} });
    assert.equal(refResult.valid, false);
    assert.match(refResult.errors[0].message, /Unsupported JSON Schema keyword '\$ref'/);

    const patternPropsSchema = {
      type: 'object',
      properties: {
        meta: {
          type: 'object',
          patternProperties: { '^[a-z]+$': { type: 'string' } },
        },
      },
    };
    const patternResult = validateToolArguments(patternPropsSchema, { meta: { foo: 'bar' } });
    assert.equal(patternResult.valid, false);
    assert.match(patternResult.errors[0].message, /Unsupported JSON Schema keyword 'patternProperties'/);

    // Unsupported keywords on omitted optional property schemas are rejected upfront
    const omittedPropSchema = {
      type: 'object',
      properties: {
        present: { type: 'string' },
        omittedOptional: {
          type: 'string',
          oneOf: [{ minLength: 3 }],
        },
      },
    };
    const omittedResult = validateToolArguments(omittedPropSchema, { present: 'hello' });
    assert.equal(omittedResult.valid, false);
    assert.ok(omittedResult.errors.some((e) => e.path === '#/omittedOptional/oneOf' && e.message.includes('oneOf')));

    // Unsupported keywords on array items schemas are rejected upfront even with empty array
    const emptyArrayItemsSchema = {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: {
            type: 'string',
            anyOf: [{ pattern: '^[a-z]+$' }],
          },
        },
      },
    };
    const emptyArrayResult = validateToolArguments(emptyArrayItemsSchema, { tags: [] });
    assert.equal(emptyArrayResult.valid, false);
    assert.ok(emptyArrayResult.errors.some((e) => e.path === '#/tags[]/anyOf' && e.message.includes('anyOf')));

    // Unsupported keywords on primitive-valued property schemas are rejected upfront
    const primitiveKeywordSchema = {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          allOf: [{ minLength: 1 }],
        },
      },
    };
    const primitiveResult = validateToolArguments(primitiveKeywordSchema, { description: 'test' });
    assert.equal(primitiveResult.valid, false);
    assert.ok(primitiveResult.errors.some((e) => e.path === '#/description/allOf' && e.message.includes('allOf')));
  });

  it('evaluates enum and const correctly for null values', () => {
    // 1. enum containing null permits null
    const enumWithNullSchema = {
      type: 'object',
      properties: {
        state: { enum: ['active', 'inactive', null] },
      },
    };
    const validEnumNull = validateToolArguments(enumWithNullSchema, { state: null });
    assert.equal(validEnumNull.valid, true);

    // 2. enum NOT containing null rejects null even if nullable: true is specified
    const enumWithoutNullNullableSchema = {
      type: 'object',
      properties: {
        state: { enum: ['active', 'inactive'], nullable: true },
      },
    };
    const invalidEnumNull = validateToolArguments(enumWithoutNullNullableSchema, { state: null });
    assert.equal(invalidEnumNull.valid, false);
    assert.match(invalidEnumNull.errors[0].message, /Value must be one of/);

    // 3. const: null permits null
    const constNullSchema = {
      type: 'object',
      properties: {
        marker: { const: null },
      },
    };
    const validConstNull = validateToolArguments(constNullSchema, { marker: null });
    assert.equal(validConstNull.valid, true);

    // 4. const NOT null rejects null even if nullable: true is specified
    const constNotNullNullableSchema = {
      type: 'object',
      properties: {
        secret: { const: 'REQUIRED_SECRET', nullable: true },
      },
    };
    const invalidConstNull = validateToolArguments(constNotNullNullableSchema, { secret: null });
    assert.equal(invalidConstNull.valid, false);
    assert.match(invalidConstNull.errors[0].message, /Value must be strictly equal to const "REQUIRED_SECRET"/);
  });
});

