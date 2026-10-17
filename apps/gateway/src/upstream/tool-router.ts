/**
 * Dynamic Tool Router for Gate G6.
 * Orchestrates catalog resolution, JSON Schema validation, circuit breaker failure isolation,
 * two-phase audit lifecycle, bounded hierarchical concurrency, and deadline/cancellation propagation.
 * 
 * Non-Negotiable Invariants:
 * - Dynamic catalog snapshot as single source of truth for public name translation.
 * - Real JSON Schema validation before dispatch.
 * - Two-phase audit: fails closed if start write fails; dual-signaling if finalization degrades.
 * - Hierarchical concurrency: global 20 + upstream 4 with queue deadline accounting.
 * - Per-upstream circuit breaker with atomic permits and epoch tracking.
 * - Bounded response size (MAX_RESULT_SIZE_BYTES) without returning malformed/truncated payloads.
 * - Explicit mutation classification with conservative default (no automatic retries).
 */

import {
  CallToolResult,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { CatalogService } from './catalog-service.js';
import { CatalogTool, UpstreamTimeoutError } from './types.js';
import { UpstreamManager } from './upstream-manager.js';
import { AuditService } from '../audit/audit-service.js';
import type { AuditStatus } from '../db/audit-repo.js';
import { AuthenticatedUser } from '../auth/authenticator.js';
import { AppConfig } from '../config.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { ConcurrencyLimiter, ConcurrencyPermit } from './concurrency-limiter.js';
import { validateToolArguments } from './json-schema-validator.js';
import { logger } from '../logging/logger.js';

export interface ToolDispatchOptions {
  readonly publicToolName: string;
  readonly arguments?: Record<string, unknown>;
  readonly user?: AuthenticatedUser;
  readonly clientSignal?: AbortSignal;
  readonly onDegradedAudit?: () => void;
  readonly requestDeadlineMs?: number;
}

/**
 * Explicit registry of known Phase 4 tool operation classifications.
 */
export const KNOWN_TOOL_MUTABILITY: Readonly<Record<string, boolean>> = Object.freeze({
  // WooCommerce MCP tools
  'woocommerce__list_products': false,
  'woocommerce__create_product': true,
  'woocommerce__list_orders': false,
  'woocommerce__get_order': false,
  'woocommerce__update_order_status': true,

  // CRM MCP tools
  'crm__search_contacts': false,
  'crm__get_contact': false,

  // Tasks MCP tools
  'tasks__list_tasks': false,
  'tasks__create_task': true,
  'tasks__update_task_status': true,
});

export class ToolRouter {
  private readonly circuitBreakers = new Map<string, CircuitBreaker>();
  private readonly concurrencyLimiter: ConcurrencyLimiter;
  private readonly maxResultSizeBytes: number;
  private isShuttingDown = false;

  constructor(
    private readonly catalogService: CatalogService,
    private readonly upstreamManager: UpstreamManager,
    private readonly auditService: AuditService,
    private readonly config: AppConfig
  ) {
    this.maxResultSizeBytes = config.MAX_RESULT_SIZE_BYTES ?? 1048576; // 1 MiB default
    this.concurrencyLimiter = new ConcurrencyLimiter({
      globalLimit: config.GLOBAL_CONCURRENCY_LIMIT ?? 20,
      perUpstreamLimit: config.PER_UPSTREAM_CONCURRENCY_LIMIT ?? 4,
      maxQueueLengthPerUpstream: 10,
      maxQueueWaitMs: 1000,
    });
  }

  getCircuitBreaker(slug: string): CircuitBreaker {
    let breaker = this.circuitBreakers.get(slug);
    if (!breaker) {
      breaker = new CircuitBreaker(slug);
      this.circuitBreakers.set(slug, breaker);
    }
    return breaker;
  }

  getConcurrencyLimiter(): ConcurrencyLimiter {
    return this.concurrencyLimiter;
  }

  /**
   * Evaluates whether a tool performs a state-mutating operation.
   * Uses explicit registry -> tool annotations -> prefix matching -> conservative default (true).
   */
  isMutatingTool(tool: CatalogTool): boolean {
    // 1. Tool annotations override if provided
    if (tool.annotations && typeof tool.annotations.readOnly === 'boolean') {
      return !tool.annotations.readOnly;
    }

    // 2. Explicit dictionary lookup
    if (tool.name in KNOWN_TOOL_MUTABILITY) {
      return KNOWN_TOOL_MUTABILITY[tool.name];
    }

    // 3. Deterministic prefix conventions
    const lowerName = tool.originalName.toLowerCase();
    const readOnlyPrefixes = ['list_', 'get_', 'search_', 'find_', 'read_', 'fetch_', 'query_', 'check_', 'inspect_'];
    if (readOnlyPrefixes.some((p) => lowerName.startsWith(p))) {
      return false;
    }

    const mutatingPrefixes = ['create_', 'update_', 'delete_', 'set_', 'add_', 'remove_', 'modify_', 'patch_', 'post_', 'put_'];
    if (mutatingPrefixes.some((p) => lowerName.startsWith(p))) {
      return true;
    }

    // 4. Conservative default: treat unknown tools as mutating
    return true;
  }

  /**
   * Dispatches downstream MCP tools/call request.
   */
  async dispatch(options: ToolDispatchOptions): Promise<CallToolResult> {
    if (this.isShuttingDown) {
      return {
        content: [{ type: 'text', text: 'Gateway is shutting down. Rejecting tool execution.' }],
        isError: true,
      };
    }

    // Step 1: Catalog Resolution
    const snapshot = this.catalogService.getSnapshot();
    const tool = snapshot.toolsByPublicName.get(options.publicToolName);

    if (!tool) {
      // Must return standard JSON-RPC InvalidParams error for unknown tools
      throw new McpError(ErrorCode.InvalidParams, `Tool "${options.publicToolName}" not found`);
    }

    // Step 2: Unreachable / Disabled tool check
    if (tool._meta && (tool._meta as any).reachable === false) {
      return {
        content: [
          {
            type: 'text',
            text: `Upstream service '${tool.upstreamSlug}' is currently unreachable. The tool could not be executed.`,
          },
        ],
        isError: true,
      };
    }

    const client = this.upstreamManager.getClient(tool.upstreamSlug);
    if (!client || !client.isEnabled()) {
      return {
        content: [
          {
            type: 'text',
            text: `Upstream service '${tool.upstreamSlug}' is disabled or currently unavailable.`,
          },
        ],
        isError: true,
      };
    }

    // Step 3: Circuit Breaker Permit Acquisition (Atomic)
    const breaker = this.getCircuitBreaker(tool.upstreamSlug);
    const breakerResult = breaker.tryAcquirePermit();
    if (!breakerResult.allowed) {
      return {
        content: [
          {
            type: 'text',
            text: breakerResult.reason ?? `Upstream service '${tool.upstreamSlug}' circuit breaker is OPEN. Tool execution short-circuited.`,
          },
        ],
        isError: true,
      };
    }
    const breakerPermit = breakerResult.permit!;

    // Step 4: JSON Schema Argument Validation
    const validation = validateToolArguments(tool.inputSchema, options.arguments);
    if (!validation.valid) {
      // Caller validation failure does NOT trip breaker
      breakerPermit.recordAbort();
      const errorDetails = validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
      return {
        content: [
          {
            type: 'text',
            text: `Invalid arguments for tool "${tool.name}": ${errorDetails}`,
          },
        ],
        isError: true,
      };
    }

    const isMutating = this.isMutatingTool(tool);

    // Step 5: Phase 1 Audit Start (Fail Closed)
    let auditId: string;
    const startTimeMs = Date.now();

    try {
      auditId = this.auditService.startAudit({
        userId: options.user?.id,
        upstreamSlug: tool.upstreamSlug,
        toolName: tool.name,
        arguments: options.arguments,
      });
    } catch (err: unknown) {
      // Phase 1 write failed -> halt immediately, zero upstream dispatch
      breakerPermit.recordAbort();
      logger.error('Phase 1 audit start write failed. Halting tool execution to preserve fail-closed invariant.', {
        toolName: tool.name,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        content: [
          {
            type: 'text',
            text: 'Audit logging unavailable. Tool execution was halted to preserve security and attribution.',
          },
        ],
        isError: true,
      };
    }

    // Step 6: Hierarchical Concurrency Permit Acquisition (Global + Upstream)
    const totalTimeoutMs = options.requestDeadlineMs ?? client.getTimeoutMs();
    let concurrencyPermit: ConcurrencyPermit;

    try {
      concurrencyPermit = await this.concurrencyLimiter.acquire(
        tool.upstreamSlug,
        totalTimeoutMs,
        options.clientSignal
      );
    } catch (err: unknown) {
      breakerPermit.recordAbort();

      const isAbort = options.clientSignal?.aborted;
      const status: AuditStatus = isAbort ? 'client_disconnected' : 'failed';
      const errorCode = isAbort ? 'CLIENT_DISCONNECTED' : 'CONCURRENCY_LIMIT_EXCEEDED';

      this.auditService.finalizeAudit(auditId, {
        status,
        startTimeMs,
        errorCode,
        errorMessage: err instanceof Error ? err.message : String(err),
      });

      return {
        content: [
          {
            type: 'text',
            text: err instanceof Error ? err.message : 'Gateway concurrency limit reached',
          },
        ],
        isError: true,
      };
    }

    // Step 7: Bounded Execution with Timeout and Cancellation Propagation
    const remainingExecutionDeadline = concurrencyPermit.remainingDeadlineMs;
    const abortController = new AbortController();
    let timedOut = false;
    let clientDisconnected = false;

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      abortController.abort(
        new UpstreamTimeoutError(
          `The operation timed out after ${remainingExecutionDeadline}ms waiting for upstream service '${tool.upstreamSlug}'. The mutation may have completed. Inspect state before attempting any retry.`
        )
      );
    }, remainingExecutionDeadline);

    const onClientAbort = () => {
      clientDisconnected = true;
      abortController.abort(new Error('Client disconnected prematurely before response finished'));
    };

    if (options.clientSignal) {
      if (options.clientSignal.aborted) {
        onClientAbort();
      } else {
        options.clientSignal.addEventListener('abort', onClientAbort, { once: true });
      }
    }

    let upstreamResult: CallToolResult | null = null;
    let executionError: unknown = null;

    try {
      upstreamResult = await client.callTool(tool.originalName, options.arguments, {
        signal: abortController.signal,
      });
    } catch (err: unknown) {
      executionError = err;
    } finally {
      clearTimeout(timeoutTimer);
      if (options.clientSignal) {
        options.clientSignal.removeEventListener('abort', onClientAbort);
      }
      concurrencyPermit.release();
    }

    // Step 8: Result Processing, Circuit Breaker Accounting, and Phase 2 Finalization
    if (executionError !== null) {
      if (clientDisconnected) {
        breakerPermit.recordAbort();
        const status: AuditStatus = isMutating ? 'unconfirmed_outcome' : 'client_disconnected';
        this.auditService.finalizeAudit(auditId, {
          status,
          startTimeMs,
          errorCode: 'CLIENT_DISCONNECTED',
          errorMessage: 'Client disconnected prematurely before response finished',
        });

        return {
          content: [
            {
              type: 'text',
              text: `Operation cancelled due to client disconnect. ${
                isMutating ? 'The mutation may have completed upstream. Inspect state before attempting any retry.' : ''
              }`.trim(),
            },
          ],
          isError: true,
        };
      }

      const isTimeout =
        timedOut ||
        executionError instanceof UpstreamTimeoutError ||
        (executionError as any)?.code === 'UPSTREAM_TIMEOUT';

      if (isTimeout) {
        breakerPermit.recordFailure(executionError);
        const status: AuditStatus = isMutating ? 'unconfirmed_outcome' : 'timeout';
        this.auditService.finalizeAudit(auditId, {
          status,
          startTimeMs,
          errorCode: 'UPSTREAM_TIMEOUT',
          errorMessage: (executionError as Error).message,
        });

        return {
          content: [
            {
              type: 'text',
              text: (executionError as Error).message,
            },
          ],
          isError: true,
        };
      }

      // Infrastructure / Transport / 5xx failure
      breakerPermit.recordFailure(executionError);
      this.auditService.finalizeAudit(auditId, {
        status: 'failed',
        startTimeMs,
        errorCode: (executionError as any)?.code || 'UPSTREAM_ERROR',
        errorMessage: (executionError as Error).message,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Upstream service '${tool.upstreamSlug}' encountered an internal failure while processing the tool call.`,
          },
        ],
        isError: true,
      };
    }

    // Execution completed: validate result payload size
    const validResult = upstreamResult!;
    const serializedResult = JSON.stringify(validResult);
    const resultByteLength = Buffer.byteLength(serializedResult, 'utf8');

    if (resultByteLength > this.maxResultSizeBytes) {
      breakerPermit.recordSuccess();
      this.auditService.finalizeAudit(auditId, {
        status: 'failed',
        startTimeMs,
        errorCode: 'RESPONSE_TOO_LARGE',
        errorMessage: `Response size (${resultByteLength} bytes) exceeded maximum permissible limit of ${this.maxResultSizeBytes} bytes`,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Tool execution response size (${resultByteLength} bytes) exceeded maximum permissible limit of ${this.maxResultSizeBytes} bytes. The result was not forwarded to prevent client memory exhaustion.`,
          },
        ],
        isError: true,
      };
    }

    // Upstream tool-level domain error (isError: true returned by upstream MCP server)
    if (validResult.isError === true) {
      // Normal business tool error does NOT trip breaker
      breakerPermit.recordSuccess();
      this.auditService.finalizeAudit(auditId, {
        status: 'failed',
        startTimeMs,
        errorCode: 'TOOL_ERROR',
        errorMessage: 'Upstream tool returned domain error result',
      });

      return validResult;
    }

    // Confirmed Successful Execution
    breakerPermit.recordSuccess();
    const finalizeResult = this.auditService.finalizeAudit(auditId, {
      status: 'success',
      startTimeMs,
    });

    if (finalizeResult.degraded) {
      options.onDegradedAudit?.();
      return {
        ...validResult,
        _meta: {
          ...(validResult._meta || {}),
          urumi_audit_status: 'finalization-degraded',
          urumi_audit_warning:
            'Upstream mutation succeeded, but local audit finalization write failed on gateway storage. Do not retry.',
        },
      };
    }

    return validResult;
  }

  /**
   * Graceful shutdown: closes concurrency limiter and rejects new tool executions.
   */
  close(): void {
    this.isShuttingDown = true;
    this.concurrencyLimiter.close();
  }
}
