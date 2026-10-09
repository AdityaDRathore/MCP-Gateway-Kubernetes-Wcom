# ADR-003: Secrets Management, Access Control, and Threat Boundaries

**Status**: Accepted  
**Date**: 2026-10-09  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  

---

## 1. Context & Problem Statement
The gateway aggregates upstream MCP servers that require sensitive credentials (e.g. WooCommerce Consumer Key/Secret, internal API bearer tokens). Simultaneously, multiple human users (User A: Admin/Chat, User B: Team Member) access tools through the gateway using their own personal API keys. 

We must enforce strict credential isolation so that:
1. Team members never see, receive, or need upstream credentials.
2. Downstream user tokens are never forwarded to upstream servers.
3. User API keys are stored securely and support instantaneous revocation.
4. Credentials dynamically entered by admins live in Kubernetes Secrets, guarded by Kubernetes RBAC.
5. LLM provider costs, free-tier limits, and required environment variables are truthfully documented.

---

## 2. Decision

### 1. Gateway User API Key Lifecycle
- **Generation**: Cryptographically random 32-byte token formatted as `urumi_key_<random_hex>`.
- **Display**: Shown to the user exactly **once** upon creation in the Dashboard modal.
- **Storage**: The gateway **never stores plaintext API keys**. Keys are hashed using **SHA-256 with a system-wide salt** (or bcrypt) and stored in the SQLite `users_api_keys` table.
- **Revocation**: Admins (or the owning user) can revoke a key at any time by toggling `revoked_at` timestamp. Revocation takes effect immediately in-memory on the next request.

### 2. Static Platform Secrets
- WordPress database credentials, MariaDB root password, and initial WooCommerce API keys are stored in a Kubernetes Secret (`urumi-store-secrets`).
- Secrets are created declaratively via Helm templates from values files (`values-local.yaml` / `values-prod.yaml`). Real production values are never committed to git.

### 3. Dynamic Upstream Credential Secrets & Gateway RBAC
- When an admin registers an upstream MCP server in the Dashboard with a custom header or bearer token:
  - The Gateway backend creates a Kubernetes Secret object in a dedicated namespace: `urumi-gateway-secrets`.
  - The Gateway's SQLite metadata table only stores the Secret name and key reference (`secretName: upstream-woo-cred`, `secretKey: token`).
  - The Gateway pod runs with a dedicated Kubernetes `ServiceAccount` (`urumi-gateway-sa`) bound via a namespaced `Role` and `RoleBinding` granting `get`, `create`, `update`, `delete` permissions **only** on `secrets` in the `urumi-gateway-secrets` namespace.
- **Defense in Depth**: If the gateway database is dumped or SQL-injected, the attacker only acquires secret references, not the actual upstream credentials stored in etcd.

### 4. Preventing Token Passthrough & Upstream Leakage
- **No Client Token Forwarding**: Downstream clients connect using `Authorization: Bearer <urumi_user_key>`. The gateway strips this header completely before communicating with internal upstreams. It injects the upstream's dedicated credentials stored inside the cluster.
- **Response Sanitization**: Upstream credentials are removed from all Gateway REST APIs, audit log payloads, and error messages.
- **Untrusted Upstream Defense**: Tool descriptions from external upstreams are sanitized to prevent prompt-injection attacks against the Chat Agent.

---

## 3. Truthful LLM Provider Analysis (Costs, Limits & Env Vars)

In accordance with strict technical honesty, cloud LLM providers are not unconditionally free:

| Provider / Model | Cost Structure | Free Tier Limits | Required Environment Variable | Suitability for Take-Home |
| :--- | :--- | :--- | :--- | :--- |
| **Google Gemini API** (`gemini-2.5-flash` / `gemini-1.5-flash`) | **Free Tier Available** | 15 RPM (Requests Per Min), 1M TPM, 1,500 RPD (Requests Per Day). Zero credit card required on AI Studio. | `GEMINI_API_KEY` | **Recommended**. High rate limits, excellent tool-calling support, zero monetary cost. |
| **Anthropic Claude API** (`claude-3-5-sonnet`) | Paid commercial API | No perpetual free tier. Requires paid credits or active console balance. | `ANTHROPIC_API_KEY` | Paid option. Excellent reasoning, but costs money per million tokens. |
| **OpenAI API** (`gpt-4o-mini`) | Paid commercial API | Requires prepaid account balance. | `OPENAI_API_KEY` | Paid option. Cheap but not zero-cost. |
| **Local Ollama** (`qwen2.5:1.5b` / `llama3.2:1b`) | 100% Free & Open Source | Unlimited local execution. Zero internet or accounts required. | `OLLAMA_BASE_URL` | **Hardware Caution**: Host has 7.6 GiB total RAM (~1.4 GiB available). Running a local LLM simultaneously with WordPress, MariaDB, and K8s may cause OOM. Only recommended if using a quantized ≤1.5B parameter model. |

---

## 4. Threat Model Summary

1. **Compromised Team Member**:
   - Possesses a valid Gateway API key.
   - *Can*: Call tools permitted by their role; view their own tool execution history.
   - *Cannot*: Extract upstream credentials, reach internal ClusterIP pods directly, or access other members' private keys.
2. **Malicious Upstream MCP Server**:
   - An admin registers a rogue upstream whose tool schemas contain adversarial prompts (Prompt Injection).
   - *Mitigation*: The gateway strictly validates tool input arguments against declared JSON schemas before dispatching. Tool schemas are isolated under `{server_name}__{tool_name}` namespacing.
3. **Database Compromise**:
   - Attacker gains read access to `/data/gateway.db`.
   - *Result*: Attacker only acquires cryptographic hashes of user API keys (SHA-256) and Kubernetes Secret object names. Upstream bearer tokens remain sealed in Kubernetes etcd.
