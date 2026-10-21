# Phase 6 Gate P6-G5 Implementation Plan: Cross-Path Security and Regression

## Goal Description
Phase 6 Gate P6-G5 ("Cross-path security and regression") provides definitive proof that the Urumi Team MCP Gateway enforces strict authentication separation, role-based access controls (RBAC), data isolation, secret protection, error resilience, and baseline data integrity across all communication paths.

The objective is to verify:
1. **Cross-Path Boundary & Token Non-Substitutability**: Prove that browser session cookies and downstream MCP Bearer API keys cannot substitute for each other across the `/mcp` MCP protocol endpoint and `/api/v1/browser/*` browser chat/admin endpoints.
2. **Member vs. Admin RBAC & IDOR Boundaries**: Verify member role vs. admin role access controls, preventing unauthorized administrative actions or cross-tenant key revocation (IDOR).
3. **Secret Isolation & PII Redaction**: Verify that upstream credentials, database secrets, and customer PII (e.g., billing phone, customer email) never leak into chat responses, logs, or external tool outputs.
4. **Resilience & Bounded Loop Controls**: Verify provider failure mappings (504 timeout, 429 rate limit, 503 unconfigured), upstream circuit breaker / unreachable handling, unknown tool rejection, and the strict 5-iteration loop termination cap.
5. **Zero Regression Verification**: Run the full suite of gateway unit tests (351 tests), gateway protocol tests (34 tests), live integration tests (4 tests), dashboard build, Helm lint/template checks, and verify that WooCommerce protected records (Product IDs 10, 11, 12 and Order #14) remain pristine.
6. **Deliverable Completion Report**: Produce `docs/phase-6/p6-g5-cross-path-security-and-regression-report.md`.

---

## User Review Required
> [!IMPORTANT]
> - **Zero Invariant Mutations**: Product IDs 10, 11, 12 and Order #14 will not be mutated or touched during any test run.
> - **Node 24 Environment**: As verified during preflight, tests utilizing `node:sqlite` require the Node 24 runtime (`/home/rathore/.nvm/versions/node/v24.20.0/bin/node`).
> - **Opt-In Live Calls**: Live external client tests remain strictly opt-in and bound to dedicated test credentials without affecting production state.

---

## Proposed Changes

### Component: Gateway Test Suite & Protocol Coverage

#### [NEW] `apps/gateway/test/protocol/p6-g5-cross-path-security.test.ts`
Implement an end-to-end automated protocol security test suite that programmatically validates:
1. **Cross-Perimeter Token Substitution Rejection**:
   - Browser session cookie sent to `/mcp` (without Bearer token) -> HTTP 401 Unauthorized (`Missing Authorization header`).
   - Browser session cookie sent to `/mcp` with invalid Bearer token -> HTTP 401 Unauthorized (`Invalid bearer token format` or `Invalid API key`).
   - Downstream MCP Bearer key sent to `/api/v1/browser/chat` without session cookie -> HTTP 401 Unauthorized (`SESSION_MISSING`).
   - Downstream MCP Bearer key sent to `/api/v1/browser/chat/confirm` without session cookie -> HTTP 401 Unauthorized (`SESSION_MISSING`).
   - Downstream MCP Bearer key sent to `/api/v1/browser/keys` without session cookie -> HTTP 401 Unauthorized (`SESSION_MISSING`).
   - Downstream MCP Bearer key sent to `/api/v1/browser/audit` without session cookie -> HTTP 401 Unauthorized (`SESSION_MISSING`).
   - Valid session cookie on POST `/api/v1/browser/chat` missing CSRF token -> HTTP 403 Forbidden (`CSRF_TOKEN_MISSING`).
   - Valid session cookie on POST `/api/v1/browser/chat` with invalid CSRF token -> HTTP 403 Forbidden (`CSRF_TOKEN_INVALID`).
   - Valid session cookie with unapproved Origin header -> HTTP 403 Forbidden (`ORIGIN_NOT_ALLOWED`).
2. **Role-Based Access Control (RBAC) & IDOR Defenses**:
   - Member session attempting admin endpoints (`POST /members`, `POST /invitations`, `POST /upstreams`, `GET /audit`) -> HTTP 403 Forbidden (`FORBIDDEN_ROLE`).
   - Member session accessing permitted endpoints (`POST /chat`, `GET /keys`) -> HTTP 200 OK.
   - Member session only sees their own API keys; attempting to revoke another member's key -> rejected (IDOR protection).
   - Deactivated member session attempting chat -> HTTP 401 Unauthorized.
3. **Secret Isolation & PII Redaction**:
   - Tool outputs and chat responses omit upstream bearer tokens, DB passwords, and provider API keys.
   - `woocommerce__list_orders` response redacts/omits sensitive billing email and phone.
   - Audit trail masks sensitive credentials as `[REDACTED]`.
4. **Audit Attribution**:
   - Tool execution via chat turn writes to `audit_logs` with exact user attribution (`user_id`), tool name, status, and duration.
5. **Provider Failure Mappings & Resilience**:
   - Provider timeout (`ProviderTimeoutError`) -> HTTP 504 Gateway Timeout (`PROVIDER_TIMEOUT`).
   - Provider rate limit (`ProviderRateLimitError`) -> HTTP 429 Too Many Requests (`PROVIDER_RATE_LIMITED`).
   - Provider unconfigured (`ProviderUnconfiguredError`) -> HTTP 503 Service Unavailable (`PROVIDER_UNCONFIGURED`).
   - Upstream service unreachable / circuit open -> handled gracefully without crashing agent loop.
   - Model requests unknown tool -> rejected with error status without crashing agent loop.
   - Endless tool calling by model -> terminates cleanly after exactly 5 iterations (`MAX_TOOL_ITERATIONS = 5`).

---

### Component: Documentation & Gate Report

#### [NEW] `docs/phase-6/p6-g5-cross-path-security-and-regression-report.md`
Create the comprehensive completion report detailing:
- Gate objective and acceptance criteria matrix.
- Baseline and final commit SHAs (`d5be9a1` baseline).
- Exact test commands executed, per-suite test counts, and exit codes.
- Security findings: cross-path token isolation, RBAC enforcement, PII protection, audit correlation.
- Baseline data integrity verification (MariaDB query results for IDs 10, 11, 12, 14).
- Helm lint/template and dashboard build results.
- Recommendation for P6-G6 based on the approved roadmap sequence.

---

## Verification Plan

### Automated Tests
1. **New P6-G5 Cross-Path Security Suite**:
   ```bash
   export PATH="/home/rathore/Documents/Urumi Assignment/node_modules/.bin:/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH"
   npx tsx --test apps/gateway/test/protocol/p6-g5-cross-path-security.test.ts
   ```
2. **Full Gateway Protocol Test Suite**:
   ```bash
   export PATH="/home/rathore/Documents/Urumi Assignment/node_modules/.bin:/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH"
   npm run test:protocol --workspace=apps/gateway
   ```
3. **Full Gateway Unit Test Suite**:
   ```bash
   export PATH="/home/rathore/Documents/Urumi Assignment/node_modules/.bin:/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH"
   npm run test:unit --workspace=apps/gateway
   ```
4. **Integration Acceptance Suite**:
   ```bash
   export PATH="/home/rathore/Documents/Urumi Assignment/node_modules/.bin:/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH"
   RUN_P6_G4_ACCEPTANCE=true npx tsx --test apps/gateway/test/integration/p6-g4-external-mcp-acceptance.test.ts
   ```
5. **Dashboard Build Verification**:
   ```bash
   npm run build --workspace=apps/dashboard
   ```
6. **Helm Chart & Manifest Validation**:
   ```bash
   helm lint infra/helm/urumi-platform
   helm template urumi-platform infra/helm/urumi-platform -f infra/helm/urumi-platform/values.yaml > /dev/null
   helm template urumi-platform infra/helm/urumi-platform -f infra/helm/urumi-platform/values-local.yaml > /dev/null
   ```
7. **MariaDB Protected Records Verification**:
   ```bash
   kubectl exec -n urumi urumi-mariadb-0 -- mariadb -u root -pbd060c749ed66437ad05c08400febb6e wordpress -e "SELECT ID, post_title, post_type, post_status FROM wp_posts WHERE ID IN (10, 11, 12, 14);"
   ```

### Manual Verification
- Review the generated `docs/phase-6/p6-g5-cross-path-security-and-regression-report.md` for complete coverage of all criteria, baseline preservation, and clean evidence logging.
