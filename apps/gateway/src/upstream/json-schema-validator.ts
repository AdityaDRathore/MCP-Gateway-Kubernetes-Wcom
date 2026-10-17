/**
 * Real JSON Schema Validator for Gate G6.
 * 
 * Explicit Supported JSON Schema Subset (Draft-07 / Draft 2020-12):
 * - Root: type: 'object'
 * - Object: properties, required, additionalProperties (boolean or schema object)
 * - Types: 'string', 'number', 'integer' (with float rejection), 'boolean', 'array', 'object', 'null' (and type unions, e.g. ['string', 'null'])
 * - Numeric Constraints: minimum, maximum, exclusiveMinimum, exclusiveMaximum
 * - String Constraints: minLength, maxLength, pattern
 * - Array Constraints: items (schema object for all items), minItems, maxItems
 * - Value Constraints: enum (deep JSON value equality), const (deep JSON value equality), nullable: boolean
 * 
 * Non-Negotiable Invariants:
 * - Pure validation: never mutates, coerces, or injects arguments.
 * - Deep recursive validation of nested objects and arrays up to maximum depth of 16.
 * - Strict required-property presence validation: checks presence; nullability is validated by property schema.
 * - Unsupported keywords (e.g. oneOf, anyOf, allOf, not, $ref, patternProperties) are explicitly rejected
 *   rather than silently ignored.
 * - Zero external npm dependencies (uses native Node.js isDeepStrictEqual).
 */

import { isDeepStrictEqual } from 'node:util';

export interface SchemaValidationError {
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly SchemaValidationError[];
}

export const UNSUPPORTED_SCHEMA_KEYWORDS = [
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  '$ref',
  '$defs',
  'definitions',
  'if',
  'then',
  'else',
  'patternProperties',
  'propertyNames',
  'dependencies',
  'dependentRequired',
  'dependentSchemas',
  'contains',
  'minContains',
  'maxContains',
  'uniqueItems',
  'prefixItems',
  'multipleOf',
] as const;

/**
 * Checks for unsupported JSON Schema keywords and records errors if found.
 */
function checkUnsupportedKeywords(
  schema: Record<string, unknown>,
  path: string,
  errors: SchemaValidationError[]
): void {
  for (const kw of UNSUPPORTED_SCHEMA_KEYWORDS) {
    if (kw in schema) {
      errors.push({
        path: path === '#' ? `#/${kw}` : `${path}/${kw}`,
        message: `Unsupported JSON Schema keyword '${kw}'. Gateway supports explicit core subset: type, properties, required, additionalProperties, items, minItems, maxItems, minLength, maxLength, pattern, minimum, maximum, exclusiveMinimum, exclusiveMaximum, enum, const, nullable.`,
      });
    }
  }
}

/**
 * Recursively inspects the entire schema tree upfront (properties, items, additionalProperties)
 * to reject unsupported keywords anywhere in the schema definition.
 */
function validateSchemaStructure(
  schema: Record<string, unknown>,
  path: string,
  errors: SchemaValidationError[],
  depth = 0
): void {
  if (depth > MAX_DEPTH) {
    errors.push({ path, message: 'Schema nesting depth exceeds maximum limit of 16' });
    return;
  }

  checkUnsupportedKeywords(schema, path, errors);

  if (schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
    for (const [key, propSchema] of Object.entries(schema.properties as Record<string, unknown>)) {
      if (propSchema && typeof propSchema === 'object' && !Array.isArray(propSchema)) {
        const propPath = path === '#' ? `#/${key}` : `${path}/${key}`;
        validateSchemaStructure(propSchema as Record<string, unknown>, propPath, errors, depth + 1);
      }
    }
  }

  if (schema.items && typeof schema.items === 'object') {
    if (Array.isArray(schema.items)) {
      schema.items.forEach((itemSchema, idx) => {
        if (itemSchema && typeof itemSchema === 'object' && !Array.isArray(itemSchema)) {
          validateSchemaStructure(itemSchema as Record<string, unknown>, `${path}[${idx}]`, errors, depth + 1);
        }
      });
    } else {
      validateSchemaStructure(schema.items as Record<string, unknown>, `${path}[]`, errors, depth + 1);
    }
  }

  if (schema.additionalProperties && typeof schema.additionalProperties === 'object' && !Array.isArray(schema.additionalProperties)) {
    validateSchemaStructure(schema.additionalProperties as Record<string, unknown>, `${path}/*`, errors, depth + 1);
  }
}

/**
 * Validates tool call arguments against a tool's JSON Schema.
 */
export function validateToolArguments(
  schema: Record<string, unknown> | undefined,
  args: unknown
): ValidationResult {
  const errors: SchemaValidationError[] = [];

  // Schema must be an object schema
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return {
      valid: false,
      errors: [{ path: '#', message: 'Tool inputSchema must be a valid JSON Schema object' }],
    };
  }

  // Statically validate the entire schema structure upfront for unsupported keywords
  validateSchemaStructure(schema, '#', errors, 0);
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Root schema must declare type: 'object'
  if (schema.type !== 'object') {
    return {
      valid: false,
      errors: [{ path: '#', message: `Root schema type must be 'object', got '${String(schema.type)}'` }],
    };
  }

  // Arguments must be an object (or undefined if no required properties)
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];

  if (args === undefined || args === null) {
    if (required.length > 0) {
      return {
        valid: false,
        errors: [{ path: '#', message: `Missing required arguments: ${required.join(', ')}` }],
      };
    }
    // No required arguments and args is empty/undefined -> valid empty object
    return { valid: true, errors: [] };
  }

  if (typeof args !== 'object' || Array.isArray(args)) {
    return {
      valid: false,
      errors: [{ path: '#', message: `Arguments must be an object, received ${Array.isArray(args) ? 'array' : typeof args}` }],
    };
  }

  validateObject(schema, args as Record<string, unknown>, '#', errors, 0);

  return {
    valid: errors.length === 0,
    errors,
  };
}

const MAX_DEPTH = 16;

function validateObject(
  schema: Record<string, unknown>,
  obj: Record<string, unknown>,
  currentPath: string,
  errors: SchemaValidationError[],
  depth: number
): void {
  if (depth > MAX_DEPTH) {
    errors.push({ path: currentPath, message: 'Argument nesting depth exceeds maximum limit of 16' });
    return;
  }

  // Check for unsupported keywords on this object schema
  checkUnsupportedKeywords(schema, currentPath, errors);

  // 1. Check required property presence
  // Per JSON Schema specification: 'required' checks whether the property key exists on the instance.
  // Whether the value is null, empty string, etc. is validated by the property's own schema.
  if (Array.isArray(schema.required)) {
    for (const reqKey of schema.required) {
      if (typeof reqKey === 'string') {
        const isPresent = Object.prototype.hasOwnProperty.call(obj, reqKey) && obj[reqKey] !== undefined;
        if (!isPresent) {
          errors.push({
            path: currentPath === '#' ? `#/${reqKey}` : `${currentPath}/${reqKey}`,
            message: `Required property '${reqKey}' is missing`,
          });
        }
      }
    }
  }

  const properties = (schema.properties as Record<string, unknown> | undefined) ?? {};
  const additionalProperties = schema.additionalProperties;

  // 2. Check each provided property in obj
  for (const [key, value] of Object.entries(obj)) {
    const propPath = currentPath === '#' ? `#/${key}` : `${currentPath}/${key}`;
    const propSchema = properties[key] as Record<string, unknown> | undefined;

    if (propSchema) {
      validateValue(propSchema, value, propPath, errors, depth + 1);
    } else {
      // Property is not explicitly declared in properties
      if (additionalProperties === false) {
        errors.push({
          path: propPath,
          message: `Unexpected property '${key}' not allowed by schema (additionalProperties is false)`,
        });
      } else if (typeof additionalProperties === 'object' && additionalProperties !== null && !Array.isArray(additionalProperties)) {
        validateValue(additionalProperties as Record<string, unknown>, value, propPath, errors, depth + 1);
      }
    }
  }
}

function isNullable(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const s = schema as Record<string, unknown>;
  if (s.nullable === true) return true;
  if (s.type === 'null') return true;
  if (Array.isArray(s.type) && s.type.includes('null')) return true;
  if (Array.isArray(s.enum) && s.enum.some((v) => v === null)) return true;
  if ('const' in s && s.const === null) return true;
  return false;
}

function validateValue(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  errors: SchemaValidationError[],
  depth: number
): void {
  // Check for unsupported keywords on this property/value schema
  checkUnsupportedKeywords(schema, path, errors);

  // Check nullability, enum, and const for null values
  if (value === null) {
    if (!isNullable(schema)) {
      errors.push({ path, message: 'Value cannot be null' });
      return;
    }

    // Enum validation for null values
    if (Array.isArray(schema.enum)) {
      const matched = schema.enum.some((allowed) => isDeepStrictEqual(allowed, value));
      if (!matched) {
        errors.push({
          path,
          message: `Value must be one of [${schema.enum.map((v) => JSON.stringify(v)).join(', ')}], received ${JSON.stringify(value)}`,
        });
        return;
      }
    }

    // Const validation for null values
    if ('const' in schema) {
      if (!isDeepStrictEqual(schema.const, value)) {
        errors.push({
          path,
          message: `Value must be strictly equal to const ${JSON.stringify(schema.const)}, received ${JSON.stringify(value)}`,
        });
        return;
      }
    }

    // null has satisfied nullability, enum, and const; numeric/string/array constraints do not apply
    return;
  }

  // Undefined values are allowed if property is optional and not explicitly provided
  if (value === undefined) {
    return;
  }

  // Enum validation (deep JSON value equality for primitives, objects, and arrays)
  if (Array.isArray(schema.enum)) {
    const matched = schema.enum.some((allowed) => isDeepStrictEqual(allowed, value));
    if (!matched) {
      errors.push({
        path,
        message: `Value must be one of [${schema.enum.map((v) => JSON.stringify(v)).join(', ')}], received ${JSON.stringify(value)}`,
      });
      return;
    }
  }

  // Const validation (deep JSON value equality)
  if ('const' in schema) {
    if (!isDeepStrictEqual(schema.const, value)) {
      errors.push({
        path,
        message: `Value must be strictly equal to const ${JSON.stringify(schema.const)}, received ${JSON.stringify(value)}`,
      });
      return;
    }
  }

  // Type validation
  if (schema.type) {
    const allowedTypes = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    const actualType = getJsonType(value);

    const typeMatch = allowedTypes.some((t) => {
      if (t === 'integer') return actualType === 'number' && Number.isInteger(value);
      if (t === 'number') return actualType === 'number';
      return t === actualType;
    });

    if (!typeMatch) {
      if (allowedTypes.includes('integer') && actualType === 'number' && !Number.isInteger(value)) {
        errors.push({
          path,
          message: `Expected integer, received float ${value}`,
        });
      } else {
        errors.push({
          path,
          message: `Expected type ${allowedTypes.join(' | ')}, received ${actualType}`,
        });
      }
      return;
    }
  }

  // Numeric constraints
  if (typeof value === 'number') {
    if (schema.type === 'integer' && !Number.isInteger(value)) {
      errors.push({ path, message: `Expected integer, received float ${value}` });
    }
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push({ path, message: `Value ${value} is less than minimum ${schema.minimum}` });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push({ path, message: `Value ${value} exceeds maximum ${schema.maximum}` });
    }
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
      errors.push({ path, message: `Value ${value} must be strictly greater than ${schema.exclusiveMinimum}` });
    }
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
      errors.push({ path, message: `Value ${value} must be strictly less than ${schema.exclusiveMaximum}` });
    }
  }

  // String constraints
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push({ path, message: `String length (${value.length}) is shorter than minLength ${schema.minLength}` });
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push({ path, message: `String length (${value.length}) exceeds maxLength ${schema.maxLength}` });
    }
    if (typeof schema.pattern === 'string') {
      try {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(value)) {
          errors.push({ path, message: `String does not match required pattern '${schema.pattern}'` });
        }
      } catch {
        errors.push({ path, message: `Invalid regex pattern in schema: '${schema.pattern}'` });
      }
    }
  }

  // Array constraints
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push({ path, message: `Array item count (${value.length}) is less than minItems ${schema.minItems}` });
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push({ path, message: `Array item count (${value.length}) exceeds maxItems ${schema.maxItems}` });
    }
    if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
      const itemSchema = schema.items as Record<string, unknown>;
      for (let i = 0; i < value.length; i++) {
        validateValue(itemSchema, value[i], `${path}[${i}]`, errors, depth + 1);
      }
    }
  }

  // Nested object validation
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    validateObject(schema, value as Record<string, unknown>, path, errors, depth + 1);
  }
}

function getJsonType(val: unknown): string {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  const t = typeof val;
  if (t === 'number') {
    if (Number.isNaN(val) || !Number.isFinite(val)) return 'null';
    return 'number';
  }
  return t;
}
