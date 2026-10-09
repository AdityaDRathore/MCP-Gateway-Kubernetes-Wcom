Part 2 — Phase 1 Prompt
Urumi AI FDE — Phase 1 implementation work order
Role
Act as a senior software engineer responsible for executing Phase 1 of a technical take-home assignment. The product manager has defined the goals, requirements and architectural guardrails below.

Your responsibility is to inspect the actual environment, verify the proposed architecture, implement the Phase 1 foundation, and return evidence. Do not attempt to implement the entire product in this phase.

Deadline and scope
The assignment submission deadline is 26 October 2026, 11:59 PM IST.

Phase 1 target completion: 10 October 2026.

The assignment requires a Kubernetes-hosted WooCommerce store, a custom WooCommerce MCP server using Streamable HTTP, a gateway aggregating at least three upstream MCP servers, a React dashboard, member/admin access control, API keys, audit logging, a chat agent, Helm deployment and mandatory documentation.

The immediate goal is to remove technical uncertainty and prepare a reproducible foundation.

Rules you must follow
Inspect the current repository, working tree, installed tools and environment before editing or installing anything.

Preserve existing work. Do not reset Git, discard uncommitted changes, delete clusters, delete persistent volumes or modify unrelated infrastructure.

Never print, commit or transmit real passwords, API keys, access tokens, private keys or Secret values.

Do not claim a command, test, deployment or compatibility check passed unless you actually ran it and observed the result.

Do not invent tool versions, available credentials, Kubernetes configuration, network capabilities or SDK behavior.

If a required tool is missing or a technical decision cannot be verified, report the blocker and supporting evidence. Do not silently replace the intended design.

Do not use an existing WooCommerce MCP server or plugin to implement the required custom server in later phases.

Use the official MCP SDK rather than implementing Streamable HTTP transport from scratch.

Do not mix code examples from different MCP SDK generations without validating compatibility.

Keep all work within Phase 1 scope. Do not build the finished dashboard, WooCommerce MCP tools, gateway routing, chat agent or optional bonuses yet.

Task A — Environment audit
Inspect:

Git repository root, branch, status and existing files.

Node.js, package manager, Docker, kubectl, Helm, k3d and available Kubernetes tooling.

Active Kubernetes context, node state, Ingress classes and StorageClasses where a cluster is available.

CPU/memory/disk constraints and port availability relevant to local development.

Whether a required LLM provider credential is configured, reporting presence only and never its value.

Write the findings to docs/phase-1/environment-audit.md.

Include exact versions and actual command output summaries. Distinguish observed facts from inferences and recommendations.

Task B — Requirements and architecture
Create docs/requirements-traceability.md, mapping every mandatory assignment requirement to an owning component and a testable acceptance condition.

Create docs/architecture.md describing:

React dashboard.

Gateway backend, including the admin API, MCP endpoint, authentication, routing, audit and chat orchestration.

Independently deployed WooCommerce, CRM and task MCP servers.

WooCommerce application, database and persistent WordPress content.

Gateway metadata and persistence.

Public entry points versus internal-only services.

Kubernetes namespaces, services, storage and network access.

Local versus production configuration.

The CRM and task MCP servers are proposed simple, deterministic integrations. Define their purpose and the minimum cross-server workflow, but do not implement them during Phase 1.

Use a TypeScript monorepo as the default direction if the audit does not reveal a compelling reason to reuse an existing architecture. A suggested directory layout is:

apps/dashboard

apps/gateway

apps/mcp-woocommerce

apps/mcp-crm

apps/mcp-tasks

packages/shared

infra/helm

docs/decisions

docs/phase-1

scripts

Adapt the structure to the repository rather than duplicating or destroying existing code.

Task C — MCP compatibility proof
This is a P0 task.

Inspect the official MCP specification and TypeScript SDK documentation current at execution time. Identify the exact SDK packages, versions and protocol revision appropriate for this assignment.

The current official TypeScript SDK documentation identifies v2 as its stable release line for the 2026-07-28 revision and discusses compatibility with the earlier protocol era. Do not assume old v1 tutorials and new v2 APIs are interchangeable.

Implement only a disposable test server with one echo_message tool.

Verify:

The server starts.

Streamable HTTP connectivity works.

The client successfully initializes or negotiates the protocol supported by that SDK.

The client discovers echo_message.

A tool invocation returns the expected result.

The selected configuration can be used by an external client intended for the final demo.

Use MCP Inspector for the initial test. Then test the intended external client's version and authentication configuration.

The gateway will use individual user API keys. Verify the client's ability to send the intended static authentication header rather than assuming it can.

Record exact versions, request/response evidence with all credentials redacted, client configuration requirements and compatibility limitations.

Create docs/decisions/ADR-002-mcp-compatibility.md.

Do not implement a custom MCP transport or choose a protocol revision based only on an outdated tutorial.

Task D — Security and persistence decisions
Create docs/decisions/ADR-003-secrets-and-access.md.

Explicitly decide and document:

Gateway API-key generation, hashing and revocation.

Storage of admin-entered upstream credentials.

Kubernetes Secrets and access permissions.

Whether the gateway needs a dedicated ServiceAccount and namespaced RBAC for managing upstream credential Secrets.

How credentials are prevented from appearing in dashboard responses, tool results and logs.

Persistence of team metadata and audit records.

The assignment requires credentials to be kept in Kubernetes Secrets and the gateway must protect upstream credentials from clients. Do not silently substitute plaintext database storage. If the proposed design cannot satisfy the requirements, present the concrete blocker and a compliant alternative.

Kubernetes Secret objects must not be assumed to be encrypted at rest merely because they are called Secrets.

Task E — Local Kubernetes and Helm foundation
Choose the local cluster approach only after inspecting the environment.

Preferred option: k3d if Docker and local resource constraints permit, because it runs K3s in containers and is compatible with the intended K3s deployment approach.

Do not delete or repurpose existing clusters. Keep the intended context explicit and document every cluster-creation command. Do not switch the user's active context silently.

Establish the proposed stable local hostnames:

shop.urumi.test

dashboard.urumi.test

mcp.urumi.test/mcp

Verify the Ingress controller, host port mappings and local DNS/hosts approach. Do not claim these URLs work until tested.

Prepare the Helm chart and values-file structure for local and production-like configuration. Do not duplicate the chart solely to change environment-specific domains, storage settings or resource configuration.

Run helm lint and helm template against the actual scaffold. If no chart can be validated without building unscoped application features, explain the dependency rather than creating misleading placeholder success.

Create docs/decisions/ADR-001-stack-and-deployment.md or appropriate separate ADRs, plus the minimum useful README setup instructions.

Task F — Quality and Git hygiene
Set up the relevant formatter, linter, type checker and test runner only after selecting the actual stack and versions.

Commit no real credentials, generated secrets or host-specific configuration.

Do not create empty test commands or scripts that report success without performing a check.

List every modified or created file. Avoid mass formatting or unrelated rewrites of existing code.

Definition of done
Phase 1 is complete only when:

The environment audit is accurate and documented.

Mandatory requirements map to components and tests.

The architecture and major security decisions are documented.

The MCP compatibility experiment has passed with a real client, or a concrete blocker and tested alternative are documented.

The actual external-client API-key configuration has been tested or remains explicitly blocking.

The selected Kubernetes strategy is validated against the environment, with constraints documented.

The Helm scaffold validates, or a real dependency preventing validation is documented.

No real credentials have been committed or exposed.

The repository contains the necessary Phase 1 documentation and working foundation.

Required final report
Return:

Executive summary: completed, blocked, not started.

Environment facts and detected constraints.

Architecture and protocol decisions, including evidence.

Files created or modified.

Commands actually executed and their pass/fail results.

MCP compatibility test result, including client and SDK versions.

Kubernetes/Helm validation result.

Security risks or unresolved decisions.

Remaining acceptance criteria and the exact next steps for Phase 2.

Do not claim Phase 1 complete merely because source files have been generated.