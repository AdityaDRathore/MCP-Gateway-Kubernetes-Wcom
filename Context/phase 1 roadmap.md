Part 1 — Phase 1 Roadmap
Urumi AI FDE — Execution roadmap and Phase 1 work order
We'll manage this as a real product engineering project, not as a sequence of prompts asking another AI to generate code.

My responsibility as your product/technical manager is to define the requirements, decide what matters, identify architectural risks, turn the brief into testable work, review evidence from the implementation agents, and stop us from building features that won't help you pass the assignment.

The other AI tools will act as implementation engineers. They must inspect the actual repository and environment, implement the assigned work, run tests, and show evidence that it works. We won't accept an implementation just because an AI says it is complete.

1. The project plan
Target outcome
A working, reproducible Kubernetes deployment of WooCommerce, three upstream MCP servers, a team gateway, a dashboard and an authenticated chat agent.

Project start

9 October 2026
Submission deadline

26 October, 11:59 PM IST
Planning horizon

17 calendar days
First milestone

10 October
The schedule is a proposed execution plan. It is not Urumi's official schedule or a promise that each phase will finish on time.

Here's the roadmap I recommend. I am keeping the mandatory core ahead of the optional production and security extras, in line with Urumi's explicit instructions.

Phase	Target dates	Primary outcome
1. Foundation and technical validation	Oct 9–10	Architecture, environment audit, repository structure, Kubernetes strategy and verified MCP compatibility
2. Store deployment	Oct 11–12	Real WooCommerce store, working checkout and persistent data
3. WooCommerce MCP	Oct 13–14	Five working tools against the real store
4. Gateway core	Oct 15–17	Aggregation, dynamic upstreams, routing, failure isolation and basic authentication
5. Team platform and dashboard	Oct 18–20	Admin/member roles, key lifecycle, management UI and audit log
6. AI agent and external clients	Oct 21–22	End-to-end chat tool loop, external MCP client and cross-server calls
7. Reliability and deployment hardening	Oct 23–24	Failure tests, Kubernetes hardening, production values and optional VPS deployment
8. Acceptance, documentation and submission	Oct 25–26	Full test sequence, demo recording, README, design notes and submission
These phases are not strictly isolated. We can prepare dashboard components while the gateway is being built, for example, but we must respect the dependency order: the chat agent can't be properly validated until the gateway works, and the WooCommerce tool operations can't be validated against real data until the store works.

2. How I will manage implementation AIs
Every phase will have five things: a goal, a bounded work order, explicit deliverables, acceptance tests and a rule for deciding whether we can proceed.

The implementation AI is not allowed to silently make important architectural decisions, substitute mocks for required functionality, or report tests as passing without execution evidence.

For each handoff, I want its response to contain:

Changed files: exact paths and the purpose of each meaningful change.

Commands executed: the actual test, build, deployment or verification commands.

Results: pass/fail status and relevant output, including failures.

Known gaps: what's not implemented and which requirement remains unmet.

Decisions: any deviation from the approved design and why it was necessary.

If an AI can't establish a fact, it must say so and gather the evidence needed. It must not fill the gap by inventing an environment detail, package behavior or successful test.

Phase 1 — Foundation, architecture and technical validation
Phase 1 work order
Current phase

9–10 October 2026 · Proposed completion: end of 10 October

Objective: Remove the biggest unknowns before we commit to a design. Prepare the repository and development environment so subsequent implementation can proceed without repeatedly changing the stack, Kubernetes configuration or MCP protocol.

Phase 1 is successful when: the architecture is documented, the local Kubernetes approach is verified, the framework and MCP compatibility choices are evidence-based, the project structure is ready, and the first deployment and protocol tests have passed.

3. Task 1.1 — Audit the actual starting point
Priority: P0. Do this before editing code or installing anything.

We don't yet have verified information about the working repository, the installed Kubernetes tooling, the active cluster, port availability or which model-provider credentials are available. The implementation agent must discover these facts first.

Work required
Inspect:

The Git repository, current branch, uncommitted changes and existing project structure.

The installed Node.js runtime, package manager, Docker, kubectl, Helm, k3d and any existing local Kubernetes setup.

The active Kubernetes context, node readiness, Ingress classes and StorageClasses, if a cluster exists.

Available disk and memory, as well as whether the required local ports are in use.

Whether any environment variables or credentials needed later are available. Report only whether a required value is configured, never the value itself.

Useful inspection commands include:

text
git rev-parse --show-toplevel
git status --short
git branch --show-current
git ls-files | head -100

node --version
npm --version
pnpm --version

docker --version
docker info
kubectl version --client
kubectl config current-context
kubectl get nodes -o wide
kubectl get ingressclass
kubectl get storageclass

helm version --short
k3d version

df -h
free -h
These are candidate checks, not commands to run blindly. If a tool is absent, its command may fail; record that fact rather than claiming it is available. Cluster-dependent checks only apply if a suitable cluster exists.

Safety constraints
Do not delete existing clusters, volumes, namespaces or resources. Do not overwrite the current working tree. Do not switch the active Kubernetes context silently. Do not print .env files, Kubernetes Secret values, access tokens, private keys or API-key contents.

Deliverable
docs/phase-1/environment-audit.md

It must contain the observed environment, exact tool versions, the current Git state, relevant constraints and any blockers. Sensitive values must be omitted.

Acceptance criterion: We can identify the actual working environment and choose a deployment strategy without assumptions about installed tools or infrastructure.

4. Task 1.2 — Freeze the MVP scope and requirement traceability
The assignment defines a large solution. Before implementation, convert every mandatory requirement into a component and a test.

Create docs/requirements-traceability.md with a row for each requirement:

Requirement	Owning component	Planned verification
Real store and checkout	WooCommerce deployment	Place an order and verify it in WooCommerce admin
Five required tools	WooCommerce MCP	Discover and invoke every tool
One endpoint aggregates three servers	Gateway	List and call tools from each upstream
User identity and revocation	Gateway/access layer	Revoke User B's key and verify the next request is rejected
Server disabling and failure isolation	Gateway	Disabled tools disappear; other upstreams remain functional
Audit log	Gateway and dashboard	Validate actor, server, tool, time, duration and result
Authenticated chat	Chat agent and gateway	Chat calls a tool as the logged-in user
Kubernetes and Helm	Deployment configuration	Validate the local deployment and production values
Demo and documentation	Repository	Run the documented acceptance sequence
These test cases are derived from Urumi's definition of done and mandatory requirements.

Also create a Non-goals for Round 1 section.

Unless all mandatory requirements are complete, the following are excluded from the MVP:

Multi-store provisioning.

OAuth as an alternative to API keys.

Hundreds of tools and advanced tool-search mechanisms.

A sophisticated visual design system.

Multiple gateway replicas and advanced scaling.

An elaborate observability platform.

These can be reconsidered after the core acceptance tests pass.

Acceptance criterion: Every mandatory requirement maps to an implementation owner and a test. No optional feature is accidentally treated as a prerequisite for the MVP.

5. Task 1.3 — Establish and document the architecture
We need to make the major decisions now because changes to the service boundaries, persistence or protocol later will be expensive.

The following is my proposed default architecture. It is a recommendation to validate during Phase 1, not a claim that the assignment prescribes these exact technologies.

React + TypeScript dashboard

Admin, member, server management, API keys, audit log and chat UI

Node.js + TypeScript gateway backend

Admin API · Gateway MCP endpoint · Authentication · Routing · Audit · Chat orchestration

MCP over Streamable HTTP

WooCommerce MCP

CRM MCP

Tasks MCP

WooCommerce store

WordPress + WooCommerce + persistent database and WordPress content

The CRM and task servers are proposed simple, deterministic internal integrations. Their exact tools and data model must be specified before implementation.

Decisions to record
D1 — Application stack

My starting recommendation is a TypeScript monorepo containing the React dashboard, gateway and three MCP servers. Use a single package manager and committed lockfile so different implementation agents don't install conflicting dependency versions.

A possible structure is:

text
urumi-gateway/
├── apps/
│   ├── dashboard/
│   ├── gateway/
│   ├── mcp-woocommerce/
│   ├── mcp-crm/
│   └── mcp-tasks/
├── packages/
│   └── shared/
├── infra/
│   └── helm/
├── docs/
│   ├── decisions/
│   ├── phase-1/
│   └── testing/
├── scripts/
├── README.md
└── package.json
This layout is a proposed organization, not a requirement from Urumi. Adapt it if the existing repository already has a sound structure.

D2 — Data persistence

Separate the WooCommerce application data from the gateway's team data.

The store needs persistent database storage and persistent WordPress content storage. The gateway also needs durable records for users, API-key hashes, upstream registrations and audit events.

Use MariaDB/MySQL for WooCommerce and evaluate PostgreSQL for gateway metadata. PostgreSQL is my preferred initial choice for the gateway's relational data, but we should verify that introducing a second database engine is practical on the actual machine before committing.

The specific persistence mechanism and backup story must be documented. Do not use an in-memory database for team identities or audit history.

D3 — Service boundaries

The gateway backend should own the admin API, gateway MCP endpoint, user authentication, upstream configuration, tool routing and audit recording. The chat agent should call tools through that gateway, not bypass it.

WooCommerce MCP should be an independent service. The CRM and tasks MCP services should also be independently addressable so that the failure-isolation test is meaningful.

D4 — Local Kubernetes and production parity

If the environment supports Docker, my preferred local target is k3d, which runs K3s in containers. It is a good fit to the brief because the VPS target may also use K3s. k3d's documented networking supports mapping local HTTP/HTTPS ports to the cluster's load balancer.

Do not adopt this choice blindly. Verify Docker, machine resources, port availability and compatibility with the actual environment first. If they do not support k3d, document a justified alternative instead of switching tools silently.

D5 — Ingress and local domains

We need stable local hostnames for the store, dashboard and MCP endpoint. A proposed convention is:

shop.urumi.test

dashboard.urumi.test

mcp.urumi.test/mcp

For local development, these can resolve to the loopback address using the operating system's hosts configuration, with HTTP routing through the local Ingress controller. The exact controller and port mapping must be confirmed in the environment audit.

An Ingress resource alone is not enough: Kubernetes requires an Ingress controller to implement its routing. The assignment requires Ingress, so we will use that API and a verified controller instead of substituting an unrelated networking design.

Acceptance criterion for Task 1.3: docs/architecture.md explains the component boundaries, data flow, persistence, namespace/network boundaries, local URLs and deployment differences. Each important choice is recorded in a short architecture decision record, including rejected alternatives and the reason for the decision.

6. Task 1.4 — Resolve MCP protocol compatibility before implementation
Priority: P0. This is the most important technical spike in Phase 1.

Do not tell an implementation AI to find an MCP tutorial and start coding from it. MCP's protocol and SDK have evolved, and mixing instructions from different versions is an easy way to end up with a server that runs but does not interoperate with your intended clients.

The official TypeScript SDK documentation currently identifies v2 as the stable line implementing the 2026-07-28 protocol revision. It also distinguishes that revision from the earlier protocol era, up to 2025-11-25. The two have different HTTP transport behavior.

That matters because Urumi requires a working Streamable HTTP implementation and names external clients such as Claude Code, Cursor and MCP Inspector.

Required technical experiment
Before building the gateway, create a tiny disposable MCP server with a single tool named echo_message that returns the supplied text.

Test the following:

The server starts and exposes an MCP endpoint over Streamable HTTP.

An MCP client successfully connects to it.

The client discovers echo_message through the protocol.

The client invokes the tool and receives the correct result.

Authentication can be tested using a static gateway API key, without exposing any real upstream credential.

The chosen client and SDK combination works with the protocol version you intend to use.

Use the official SDK rather than implementing the protocol transport from scratch. Record the exact package names, versions, protocol revision and tested client version.

Pay particular attention to external authentication
The assignment expects User B to configure a gateway URL and an API key. It does not require OAuth for this test.

Cursor's published MCP documentation lists Streamable HTTP for remote servers and describes OAuth in its transport table. That documentation alone does not establish whether a particular Cursor version can be configured with the static custom header we need. We must verify it rather than assume compatibility.

For the spike, use MCP Inspector to establish the baseline first, then try the external client we intend to demonstrate. If static headers or the selected protocol revision prove incompatible with a client, document the exact limitation and select a supported client configuration rather than inventing a workaround.

Deliverable
docs/decisions/ADR-002-mcp-compatibility.md

It must contain:

The exact SDK package names and pinned versions.

The protocol revision chosen and the reason for it.

The supported transport and authentication configuration.

Evidence from successful initialization, tool discovery and tool invocation.

The exact external client and version tested.

Any known compatibility limitations.

Acceptance criterion: A real client can discover and successfully invoke the test tool over the intended Streamable HTTP endpoint. A server process merely starting is not sufficient.

7. Task 1.5 — Set the security and credential-storage design
Priority: P0. Decide before the gateway's persistence schema is built.

We need a clear distinction between three sets of data.

Data	Recommended treatment
Gateway user API keys	Generate securely, show the plaintext key only when issued, store only a cryptographic hash, and support revocation
Static deployment credentials	Supply through Kubernetes Secrets, not source code or committed values files
Credentials entered when an admin registers an upstream	Keep server-side, never return them through the dashboard API, and document their storage and access controls
There is an important implementation decision here: admins can register upstreams dynamically, but the brief also requires credentials to live in Kubernetes Secrets.

My preferred design is to create a dedicated namespace for gateway-managed upstream credential Secrets, keep only the Secret reference in gateway metadata, and give the gateway a narrowly scoped Kubernetes ServiceAccount for managing those credential objects. This introduces an additional security boundary and must be accompanied by a documented RBAC policy.

The implementation AI must validate that this design can be implemented with the actual Kubernetes permissions and namespace boundaries. It must not silently store plaintext credentials in a database to avoid implementing the Secret-management mechanism.

Also, Kubernetes Secrets are not automatically encrypted at rest: Kubernetes documentation warns that their contents are, by default, stored unencrypted in etcd unless additional protections are configured.

Deliverable
docs/decisions/ADR-003-secrets-and-access.md

Record where each credential lives, which component can read it, how it reaches its intended destination, how it can be rotated or revoked, and what happens if the gateway is compromised.

Acceptance criterion: We can explain and test how the gateway uses an upstream credential without exposing it to a member, external MCP client or browser response.

8. Task 1.6 — Prepare the repository and deployment skeleton
Only after the preceding decisions are recorded should the implementation agent establish the project scaffolding.

Required work
Initialize or clean up the monorepo, preserving any useful existing code.

Pin runtime and dependency versions that were verified during the audit.

Set up basic formatting, linting, type checking and test commands appropriate to the selected stack.

Establish the proposed service directories and initial shared types only where genuinely needed.

Create the top-level Helm structure and local/production values-file strategy.

Document the secrets interface without committing any real credentials.

Create a local cluster setup guide appropriate to the environment.

Add a .gitignore that prevents local credentials, private keys, generated files and other machine-specific artifacts from entering Git.

Do not build the finished dashboard, WooCommerce tools or chat agent in this phase.

Helm validation
At minimum, establish a chart structure that can be validated without deploying unfinished application components.

Run the relevant checks, such as:

text
helm lint <chart-directory>
helm template urumi <chart-directory> \
  -f <local-values-file>
Replace placeholders with the actual repository paths.

The purpose is to prove that the Helm structure and values-file strategy are valid. It does not prove that the application can already be deployed; that comes in later phases.

Helm officially supports supplying environment-specific values files to the same chart. This is the mechanism we intend to use for local and production configuration.

When the application workloads are added later, each must have the required resource requests and limits, as well as suitable health probes. These cannot be copied indiscriminately from one service to another; readiness must represent whether that service is ready to receive traffic, while liveness should detect failures that warrant restarting it.

Deliverables
README.md and docs/phase-1/ should include setup instructions, dependency versions and the commands used to validate the skeleton.

Acceptance criterion: Another developer can inspect the architecture and prepare the same environment using documented steps, and Helm can render the scaffold without errors.

9. Phase 1 acceptance gate
We will not declare Phase 1 complete just because the documents exist.

Go/no-go review
0/8
Environment facts established

Repository state, tool versions, active cluster context and relevant machine constraints recorded.

Scope and architecture documented

Mandatory requirements trace to components and acceptance tests; major decisions are recorded.

MCP compatibility demonstrated

A real client discovers and invokes an MCP tool through the selected Streamable HTTP implementation.

External authentication investigated

The intended external client's actual ability to send the required API key has been tested or a verified alternative selected.

Kubernetes strategy validated

The local cluster approach, Ingress controller, domains and storage strategy are documented and tested where applicable.

Security boundaries defined

Static and dynamic credentials, user keys and Kubernetes permissions have explicit storage and access decisions.

Repository and Helm baseline valid

Project structure, lockfile, initial checks and chart/values scaffold are present and validated.

Evidence delivered

The implementation agent supplies changed files, executed commands, results, blockers and remaining work.

Do not move to Phase 2 solely because the schedule says so. Resolve blocking unknowns or explicitly document an agreed, evidence-based exception.

This checklist is our internal project gate, not a claim that Urumi uses these exact criteria or scoring weights.

11. What happens after the implementation AI returns
Bring its full report back here, including command results and any architecture decisions. We will review it against the Phase 1 acceptance gate before authorizing Phase 2.

The next phase will be WooCommerce on Kubernetes, with the goal of making the real store work and proving persistence across pod restarts. We will not begin building the custom WooCommerce MCP layer until that store is verifiably operational.

One final management rule: do not let the implementation AI spend the remaining deadline on an elegant but untested architecture. We need a small, coherent system that is demonstrably correct, is deployable through Helm, and can be explained by you during the live walkthrough.