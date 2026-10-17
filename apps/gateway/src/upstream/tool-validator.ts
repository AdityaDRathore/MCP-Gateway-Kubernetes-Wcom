import {
  CatalogTool,
  CATALOG_BOUNDS,
  InvalidMetadataError,
  DuplicateToolNameError,
  CatalogBoundsExceededError,
  ProhibitedRemoteRefError,
} from './types.js';

/**
 * Validates upstream server slug format.
 */
export function validateSlug(slug: string): void {
  if (!slug || typeof slug !== 'string' || !CATALOG_BOUNDS.SLUG_REGEX.test(slug)) {
    throw new InvalidMetadataError(
      `Invalid upstream slug "${slug}": Must be 2-32 lowercase alphanumeric characters or hyphens`
    );
  }
}

/**
 * Validates original tool name format.
 */
export function validateToolName(name: string): void {
  if (!name || typeof name !== 'string' || !CATALOG_BOUNDS.TOOL_NAME_REGEX.test(name)) {
    throw new InvalidMetadataError(
      `Invalid tool name "${name}": Must be 1-64 alphanumeric characters, underscores, or hyphens`
    );
  }
}

/**
 * Formats public tool name according to Urumi convention: {server_slug}__{original_tool_name}.
 */
export function formatPublicToolName(slug: string, originalName: string): string {
  validateSlug(slug);
  validateToolName(originalName);
  return `${slug}__${originalName}`;
}

/**
 * Recursively inspects a JSON Schema object to ensure no $ref values point to remote URLs.
 */
export function assertNoRemoteRefs(schema: unknown, path = 'schema'): void {
  if (!schema || typeof schema !== 'object') {
    return;
  }

  if (Array.isArray(schema)) {
    for (let i = 0; i < schema.length; i++) {
      assertNoRemoteRefs(schema[i], `${path}[${i}]`);
    }
    return;
  }

  const obj = schema as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (key === '$ref' && typeof value === 'string') {
      const lower = value.trim().toLowerCase();
      if (
        lower.startsWith('http://') ||
        lower.startsWith('https://') ||
        lower.startsWith('ftp://') ||
        lower.startsWith('//')
      ) {
        throw new ProhibitedRemoteRefError(
          `Prohibited remote $ref found at "${path}": "${value}". External schema resolution is forbidden.`
        );
      }
    } else if (typeof value === 'object' && value !== null) {
      assertNoRemoteRefs(value, `${path}.${key}`);
    }
  }
}

/**
 * Validates a single tool discovered from an upstream and normalizes it to a CatalogTool.
 */
export function validateToolMetadata(upstreamSlug: string, rawTool: unknown): CatalogTool {
  validateSlug(upstreamSlug);

  if (!rawTool || typeof rawTool !== 'object') {
    throw new InvalidMetadataError(`Malformed tool definition from upstream "${upstreamSlug}": expected an object`);
  }

  const toolObj = rawTool as Record<string, unknown>;
  const originalName = toolObj.name;
  if (!originalName || typeof originalName !== 'string') {
    throw new InvalidMetadataError(
      `Tool from upstream "${upstreamSlug}" is missing a valid "name" property`
    );
  }
  validateToolName(originalName);

  // Description validation & length bounds
  let description: string | undefined;
  if (toolObj.description !== undefined) {
    if (typeof toolObj.description !== 'string') {
      throw new InvalidMetadataError(
        `Tool "${upstreamSlug}__${originalName}" has invalid "description": expected string`
      );
    }
    if (toolObj.description.length > CATALOG_BOUNDS.MAX_TOOL_DESCRIPTION_CHARS) {
      throw new CatalogBoundsExceededError(
        `Tool "${upstreamSlug}__${originalName}" description exceeds maximum allowed length of ${CATALOG_BOUNDS.MAX_TOOL_DESCRIPTION_CHARS} characters`
      );
    }
    description = toolObj.description;
  }

  // Input Schema validation
  const inputSchema = toolObj.inputSchema;
  if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
    throw new InvalidMetadataError(
      `Tool "${upstreamSlug}__${originalName}" has malformed "inputSchema": expected a JSON Schema object`
    );
  }

  const schemaRecord = inputSchema as Record<string, unknown>;
  if (schemaRecord.type !== 'object') {
    throw new InvalidMetadataError(
      `Tool "${upstreamSlug}__${originalName}" inputSchema type must be "object", received "${schemaRecord.type}"`
    );
  }

  assertNoRemoteRefs(inputSchema, `${originalName}.inputSchema`);

  // Output Schema validation (optional)
  let outputSchema: Record<string, unknown> | undefined;
  if (toolObj.outputSchema !== undefined) {
    if (!toolObj.outputSchema || typeof toolObj.outputSchema !== 'object' || Array.isArray(toolObj.outputSchema)) {
      throw new InvalidMetadataError(
        `Tool "${upstreamSlug}__${originalName}" has malformed "outputSchema": expected a JSON Schema object`
      );
    }
    outputSchema = toolObj.outputSchema as Record<string, unknown>;
    assertNoRemoteRefs(outputSchema, `${originalName}.outputSchema`);
  }

  // Combined schema byte size bounds check (UTF-8)
  const schemaPayload = JSON.stringify({ inputSchema, outputSchema });
  const schemaByteLength = Buffer.byteLength(schemaPayload, 'utf8');
  if (schemaByteLength > CATALOG_BOUNDS.MAX_TOOL_SCHEMA_BYTES) {
    throw new CatalogBoundsExceededError(
      `Tool "${upstreamSlug}__${originalName}" schema size (${schemaByteLength} bytes) exceeds maximum permissible bound of ${CATALOG_BOUNDS.MAX_TOOL_SCHEMA_BYTES} bytes`
    );
  }

  const publicName = formatPublicToolName(upstreamSlug, originalName);

  return {
    name: publicName,
    originalName,
    upstreamSlug,
    description,
    inputSchema: schemaRecord,
    outputSchema,
    annotations: typeof toolObj.annotations === 'object' && toolObj.annotations !== null ? (toolObj.annotations as Record<string, unknown>) : undefined,
    _meta: typeof toolObj._meta === 'object' && toolObj._meta !== null ? (toolObj._meta as Record<string, unknown>) : undefined,
  };
}

/**
 * Validates an array of tools returned by a single upstream.
 */
export function validateUpstreamToolList(upstreamSlug: string, tools: unknown[]): CatalogTool[] {
  validateSlug(upstreamSlug);

  if (!Array.isArray(tools)) {
    throw new InvalidMetadataError(`Upstream "${upstreamSlug}" tools/list returned non-array payload`);
  }

  if (tools.length > CATALOG_BOUNDS.MAX_TOOLS_PER_UPSTREAM) {
    throw new CatalogBoundsExceededError(
      `Upstream "${upstreamSlug}" returned ${tools.length} tools, exceeding the per-upstream limit of ${CATALOG_BOUNDS.MAX_TOOLS_PER_UPSTREAM}`
    );
  }

  const validatedTools: CatalogTool[] = [];
  const seenOriginalNames = new Set<string>();

  for (const rawTool of tools) {
    const validated = validateToolMetadata(upstreamSlug, rawTool);
    if (seenOriginalNames.has(validated.originalName)) {
      throw new DuplicateToolNameError(
        `Upstream "${upstreamSlug}" returned duplicate tool name "${validated.originalName}"`
      );
    }
    seenOriginalNames.add(validated.originalName);
    validatedTools.push(validated);
  }

  return validatedTools;
}

/**
 * Validates global catalog constraints before snapshot publication.
 */
export function validateGlobalCatalogBounds(tools: readonly CatalogTool[]): void {
  if (tools.length > CATALOG_BOUNDS.MAX_TOTAL_CATALOG_TOOLS) {
    throw new CatalogBoundsExceededError(
      `Total catalog tool count (${tools.length}) exceeds global limit of ${CATALOG_BOUNDS.MAX_TOTAL_CATALOG_TOOLS}`
    );
  }

  const serialized = JSON.stringify(tools);
  const totalBytes = Buffer.byteLength(serialized, 'utf8');
  if (totalBytes > CATALOG_BOUNDS.MAX_TOTAL_CATALOG_BYTES) {
    throw new CatalogBoundsExceededError(
      `Total serialized catalog size (${totalBytes} bytes) exceeds global limit of ${CATALOG_BOUNDS.MAX_TOTAL_CATALOG_BYTES} bytes`
    );
  }

  const seenPublicNames = new Set<string>();
  for (const tool of tools) {
    if (seenPublicNames.has(tool.name)) {
      throw new DuplicateToolNameError(`Duplicate public tool name "${tool.name}" in compiled catalog`);
    }
    seenPublicNames.add(tool.name);
  }
}
