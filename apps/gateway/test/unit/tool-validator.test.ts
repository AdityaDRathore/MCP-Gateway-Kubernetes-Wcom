import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSlug,
  validateToolName,
  formatPublicToolName,
  validateToolMetadata,
  validateUpstreamToolList,
  validateGlobalCatalogBounds,
} from '../../src/upstream/tool-validator.js';
import {
  InvalidMetadataError,
  DuplicateToolNameError,
  CatalogBoundsExceededError,
  ProhibitedRemoteRefError,
} from '../../src/upstream/types.js';

describe('Gateway Tool Validator & Catalog Bounds Unit Tests', () => {
  it('validates upstream slug according to regex rules', () => {
    // Valid slugs
    assert.doesNotThrow(() => validateSlug('woocommerce'));
    assert.doesNotThrow(() => validateSlug('crm'));
    assert.doesNotThrow(() => validateSlug('tasks'));
    assert.doesNotThrow(() => validateSlug('custom-mcp-1'));

    // Invalid slugs
    assert.throws(() => validateSlug(''), InvalidMetadataError);
    assert.throws(() => validateSlug('a'), InvalidMetadataError); // min 2
    assert.throws(() => validateSlug('Uppercase_Slug'), InvalidMetadataError);
    assert.throws(() => validateSlug('slug.with.dots'), InvalidMetadataError);
    assert.throws(() => validateSlug('slug_with_underscores'), InvalidMetadataError);
    assert.throws(() => validateSlug('a'.repeat(33)), InvalidMetadataError); // max 32
  });

  it('validates tool name according to regex rules', () => {
    // Valid tool names
    assert.doesNotThrow(() => validateToolName('list_products'));
    assert.doesNotThrow(() => validateToolName('create_task'));
    assert.doesNotThrow(() => validateToolName('tool-name-123'));

    // Invalid tool names
    assert.throws(() => validateToolName(''), InvalidMetadataError);
    assert.throws(() => validateToolName('tool.with.dots'), InvalidMetadataError);
    assert.throws(() => validateToolName('tool with spaces'), InvalidMetadataError);
    assert.throws(() => validateToolName('x'.repeat(65)), InvalidMetadataError);
  });

  it('formats public tool name with exact {slug}__{originalName} convention', () => {
    assert.equal(formatPublicToolName('woocommerce', 'list_products'), 'woocommerce__list_products');
    assert.equal(formatPublicToolName('crm', 'search_contacts'), 'crm__search_contacts');
    assert.equal(formatPublicToolName('tasks', 'create_task'), 'tasks__create_task');
  });

  it('validates valid tool metadata and preserves input/output schemas', () => {
    const rawTool = {
      name: 'list_products',
      description: 'List products with bounded pagination',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          per_page: { type: 'integer' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          items: { type: 'array' },
        },
      },
    };

    const tool = validateToolMetadata('woocommerce', rawTool);
    assert.equal(tool.name, 'woocommerce__list_products');
    assert.equal(tool.originalName, 'list_products');
    assert.equal(tool.upstreamSlug, 'woocommerce');
    assert.equal(tool.description, 'List products with bounded pagination');
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.outputSchema?.type, 'object');
  });

  it('rejects description exceeding 2048 characters', () => {
    const rawTool = {
      name: 'test_tool',
      description: 'x'.repeat(2049),
      inputSchema: { type: 'object' },
    };

    assert.throws(
      () => validateToolMetadata('crm', rawTool),
      (err: unknown) => err instanceof CatalogBoundsExceededError && err.message.includes('description exceeds')
    );
  });

  it('rejects malformed inputSchema (non-object or type != object)', () => {
    assert.throws(
      () => validateToolMetadata('crm', { name: 'test', inputSchema: 'not-an-object' }),
      InvalidMetadataError
    );

    assert.throws(
      () => validateToolMetadata('crm', { name: 'test', inputSchema: { type: 'string' } }),
      (err: unknown) => err instanceof InvalidMetadataError && err.message.includes('inputSchema type must be "object"')
    );
  });

  it('rejects tool schemas exceeding 32 KiB byte limit', () => {
    const largeProperties: Record<string, unknown> = {};
    for (let i = 0; i < 600; i++) {
      largeProperties[`prop_${i}`] = {
        type: 'string',
        description: 'Large repetitive description padding out the schema byte size beyond 32 KiB limit',
      };
    }

    const rawTool = {
      name: 'oversized_tool',
      inputSchema: {
        type: 'object',
        properties: largeProperties,
      },
    };

    assert.throws(
      () => validateToolMetadata('tasks', rawTool),
      (err: unknown) => err instanceof CatalogBoundsExceededError && err.message.includes('schema size')
    );
  });

  it('prohibits remote $ref URIs in schemas (anti-SSRF)', () => {
    const rawTool = {
      name: 'remote_ref_tool',
      inputSchema: {
        type: 'object',
        properties: {
          user: {
            $ref: 'http://malicious.internal/schema.json#User',
          },
        },
      },
    };

    assert.throws(
      () => validateToolMetadata('crm', rawTool),
      (err: unknown) => err instanceof ProhibitedRemoteRefError && err.message.includes('Prohibited remote $ref')
    );

    // https check
    const rawToolHttps = {
      name: 'remote_ref_https',
      inputSchema: {
        type: 'object',
        properties: {
          data: {
            $ref: 'https://example.com/schema.json',
          },
        },
      },
    };
    assert.throws(() => validateToolMetadata('crm', rawToolHttps), ProhibitedRemoteRefError);

    // Local $ref must be permitted
    const rawToolLocal = {
      name: 'local_ref_tool',
      inputSchema: {
        type: 'object',
        properties: {
          data: {
            $ref: '#/$defs/LocalType',
          },
        },
      },
    };
    assert.doesNotThrow(() => validateToolMetadata('crm', rawToolLocal));
  });

  it('enforces per-upstream tool count limit (max 50)', () => {
    const tools = [];
    for (let i = 0; i < 51; i++) {
      tools.push({
        name: `tool_${i}`,
        inputSchema: { type: 'object' },
      });
    }

    assert.throws(
      () => validateUpstreamToolList('crm', tools),
      (err: unknown) => err instanceof CatalogBoundsExceededError && err.message.includes('exceeding the per-upstream limit')
    );
  });

  it('rejects duplicate original tool names from the same upstream', () => {
    const tools = [
      { name: 'duplicate_name', inputSchema: { type: 'object' } },
      { name: 'duplicate_name', inputSchema: { type: 'object' } },
    ];

    assert.throws(
      () => validateUpstreamToolList('crm', tools),
      (err: unknown) => err instanceof DuplicateToolNameError && err.message.includes('duplicate tool name')
    );
  });

  it('validates global catalog bounds: max 200 tools and duplicate public names', () => {
    const tooManyTools = [];
    for (let i = 0; i < 201; i++) {
      tooManyTools.push({
        name: `slug_${i}__tool`,
        originalName: 'tool',
        upstreamSlug: `slug_${i}`,
        inputSchema: { type: 'object' },
      });
    }

    assert.throws(
      () => validateGlobalCatalogBounds(tooManyTools),
      (err: unknown) => err instanceof CatalogBoundsExceededError && err.message.includes('exceeds global limit of 200')
    );

    const duplicatePublicTools = [
      { name: 'crm__search', originalName: 'search', upstreamSlug: 'crm', inputSchema: { type: 'object' } },
      { name: 'crm__search', originalName: 'search', upstreamSlug: 'crm', inputSchema: { type: 'object' } },
    ];

    assert.throws(
      () => validateGlobalCatalogBounds(duplicatePublicTools),
      DuplicateToolNameError
    );
  });
});
