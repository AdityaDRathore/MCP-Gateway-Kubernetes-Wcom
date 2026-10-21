import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { GeminiProviderAdapter } from '../../src/chat/gemini-provider.js';
import { ModelMessage, ModelToolDefinition } from '../../src/chat/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Opt-in guard: Live acceptance tests only run when RUN_P6_G4_ACCEPTANCE === 'true'
const RUN_ACCEPTANCE = process.env.RUN_P6_G4_ACCEPTANCE === 'true';

describe('Phase 6 Gate P6-G4: External MCP Client Acceptance & Cross-Server Verification', { skip: !RUN_ACCEPTANCE ? 'Set RUN_P6_G4_ACCEPTANCE=true to run live external client acceptance suite' : false }, () => {
  const GATEWAY_ORIGIN = process.env.GATEWAY_ORIGIN || 'http://dashboard.127.0.0.1.nip.io:8080';
  const MCP_ENDPOINT = `${GATEWAY_ORIGIN}/mcp`;
  const BROWSER_API = `${GATEWAY_ORIGIN}/api/v1/browser`;
  const HOST_HEADER = 'dashboard.127.0.0.1.nip.io';

  const TEST_MEMBER_ID = 'd6902021-d08e-45e1-9939-10cc4f1a3d3f'; // member_test_9690
  const TEST_MEMBER_USERNAME = 'member_test_9690';

  let adminSessionCookie = '';
  let adminCsrfToken = '';
  let memberRawApiKey = '';
  let memberKeyId = '';
  let disposableRawApiKey = '';
  let disposableKeyId = '';

  let mcpClient: Client;
  let mcpTransport: StreamableHTTPClientTransport;

  let geminiApiKey: string | undefined;

  before(async () => {
    // 1. Read Gemini API key from environment or .secrets/gemini.env
    geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      const secretPath = path.resolve(__dirname, '../../../../.secrets/gemini.env');
      if (fs.existsSync(secretPath)) {
        const content = fs.readFileSync(secretPath, 'utf8');
        const match = content.match(/GEMINI_API_KEY=(.+)/);
        if (match) geminiApiKey = match[1].trim();
      }
    }

    // 2. Authenticate as admin via Browser API to set up test credentials
    const adminPassword = process.env.ADMIN_PASSWORD || 'AdminPassword123!';
    const loginRes = await fetch(`${BROWSER_API}/session`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Origin: GATEWAY_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'admin', password: adminPassword }),
    });

    assert.equal(loginRes.status, 200, 'Admin login must succeed for acceptance setup');
    const loginBody: any = await loginRes.json();
    adminCsrfToken = loginBody.csrfToken;

    const setCookie = loginRes.headers.get('set-cookie') || '';
    const cookieMatch = setCookie.match(/urumi_session=([^;]+)/);
    assert.ok(cookieMatch, 'Admin session cookie must be issued');
    adminSessionCookie = cookieMatch[1];

    // 3. Reactivate member_test_9690 if inactive
    const reactivateRes = await fetch(`${BROWSER_API}/members/${TEST_MEMBER_ID}/reactivate`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Origin: GATEWAY_ORIGIN,
        Cookie: `urumi_session=${adminSessionCookie}`,
        'x-urumi-csrf': adminCsrfToken,
      },
    });
    // Status 200 or 400 if already active are acceptable
    assert.ok([200, 400].includes(reactivateRes.status), 'Reactivate member request completed');

    // 4. Generate dedicated member API key
    const keyRes = await fetch(`${BROWSER_API}/keys`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Origin: GATEWAY_ORIGIN,
        Cookie: `urumi_session=${adminSessionCookie}`,
        'x-urumi-csrf': adminCsrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'p6-g4-acceptance-member-key',
        userId: TEST_MEMBER_ID,
      }),
    });

    assert.equal(keyRes.status, 201, 'Member API key creation must succeed with 201');
    const keyBody: any = await keyRes.json();
    memberRawApiKey = keyBody.rawKey;
    memberKeyId = keyBody.apiKey.id;
    assert.equal(keyBody.apiKey.userId, TEST_MEMBER_ID, 'Generated key must belong to test member');
    assert.ok(memberRawApiKey.startsWith('urumi_live_'), 'Key must use urumi_live_ prefix');

    // 5. Generate dedicated disposable key for revocation testing
    const dispKeyRes = await fetch(`${BROWSER_API}/keys`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Origin: GATEWAY_ORIGIN,
        Cookie: `urumi_session=${adminSessionCookie}`,
        'x-urumi-csrf': adminCsrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'p6-g4-revocation-disposable-key',
        userId: TEST_MEMBER_ID,
      }),
    });

    assert.equal(dispKeyRes.status, 201, 'Disposable key creation must succeed');
    const dispKeyBody: any = await dispKeyRes.json();
    disposableRawApiKey = dispKeyBody.rawKey;
    disposableKeyId = dispKeyBody.apiKey.id;
    assert.equal(dispKeyBody.apiKey.userId, TEST_MEMBER_ID);

    // 6. Connect external MCP Client using member API key
    mcpClient = new Client(
      {
        name: 'p6-g4-external-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    mcpTransport = new StreamableHTTPClientTransport(
      new URL(MCP_ENDPOINT),
      {
        requestInit: {
          headers: {
            Host: HOST_HEADER,
            Authorization: `Bearer ${memberRawApiKey}`,
          },
        },
      }
    );

    await mcpClient.connect(mcpTransport);
  });

  after(async () => {
    // Clean client close
    if (mcpClient) {
      try {
        await mcpClient.close();
      } catch {
        // Ignore teardown close errors
      }
    }

    // Revoke test acceptance key if it was created
    if (adminSessionCookie && memberKeyId) {
      try {
        await fetch(`${BROWSER_API}/keys/${memberKeyId}/revoke`, {
          method: 'POST',
          headers: {
            Host: HOST_HEADER,
            Origin: GATEWAY_ORIGIN,
            Cookie: `urumi_session=${adminSessionCookie}`,
            'x-urumi-csrf': adminCsrfToken,
          },
        });
      } catch {
        // Ignore cleanup revocation errors
      }
    }
  });

  it('Criterion 1: External Client Connects via Gateway URL & Discovers Multi-Upstream Tools', async () => {
    assert.ok(mcpClient, 'MCP client must be connected');

    const toolsResult = await mcpClient.listTools();
    assert.ok(Array.isArray(toolsResult.tools), 'toolsResult must contain tools array');
    assert.equal(toolsResult.tools.length, 10, 'Gateway must expose exactly 10 aggregate tools');

    const toolNames = toolsResult.tools.map((t) => t.name);

    // Verify tools from all 3 upstreams are discovered
    const wooTools = toolNames.filter((n) => n.startsWith('woocommerce__'));
    const crmTools = toolNames.filter((n) => n.startsWith('crm__'));
    const taskTools = toolNames.filter((n) => n.startsWith('tasks__'));

    assert.equal(wooTools.length, 5, 'Must discover 5 WooCommerce tools');
    assert.equal(crmTools.length, 2, 'Must discover 2 CRM tools');
    assert.equal(taskTools.length, 3, 'Must discover 3 Tasks tools');

    // Verify specific expected tool names
    assert.ok(toolNames.includes('woocommerce__list_orders'));
    assert.ok(toolNames.includes('woocommerce__get_order'));
    assert.ok(toolNames.includes('woocommerce__list_products'));
    assert.ok(toolNames.includes('woocommerce__create_product'));
    assert.ok(toolNames.includes('woocommerce__update_order_status'));

    assert.ok(toolNames.includes('crm__search_contacts'));
    assert.ok(toolNames.includes('crm__get_contact'));

    assert.ok(toolNames.includes('tasks__list_tasks'));
    assert.ok(toolNames.includes('tasks__create_task'));
    assert.ok(toolNames.includes('tasks__update_task_status'));

    // Verify _meta.reachable contract on each tool
    for (const tool of toolsResult.tools) {
      assert.ok(tool._meta, `Tool ${tool.name} must have _meta`);
      assert.equal((tool._meta as any).reachable, true, `Tool ${tool.name} _meta.reachable must be true`);
    }

    // Verify no admin/private endpoints are exposed as tools
    assert.equal(toolNames.some((n) => n.includes('admin')), false, 'Admin endpoints must not be tools');
  });

  it('Criterion 2: Orders Query Acceptance through Central Gateway (woocommerce__list_orders)', async () => {
    const result: any = await mcpClient.callTool({
      name: 'woocommerce__list_orders',
      arguments: {
        per_page: 5,
      },
    });

    assert.ok(result.content, 'Tool call result must contain content array');
    assert.equal(result.content[0].type, 'text');

    const orders = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(orders), 'Orders output must be JSON array');
    assert.ok(orders.length >= 1, 'Must return at least Order #14');

    const order14 = orders.find((o: any) => o.id === 14);
    assert.ok(order14, 'Order #14 must be present in orders list');

    // Assert confirmed schema and fixture values
    assert.equal(order14.id, 14);
    assert.equal(order14.status, 'processing');
    assert.equal(order14.currency, 'INR');
    assert.equal(order14.total, '299.00');

    // Assert line item contract
    assert.ok(Array.isArray(order14.line_items), 'Order must have line_items array');
    assert.equal(order14.line_items[0].product_id, 10);
    assert.equal(order14.line_items[0].sku, 'URUMI-MUG-001');
    assert.equal(order14.line_items[0].name, 'Urumi Test Mug');

    // Assert customer PII redaction contract
    assert.equal(order14.billing, undefined, 'Customer billing address must be redacted/omitted');
    assert.equal(order14.shipping, undefined, 'Customer shipping address must be redacted/omitted');
    assert.equal(order14.customer_email, undefined, 'Customer email must be redacted/omitted');
    assert.equal(order14.customer_phone, undefined, 'Customer phone must be redacted/omitted');
  });

  it('Criterion 3: Single-Prompt Cross-Server Workflow (Model-Driven Multi-Turn Orchestration)', async () => {
    assert.ok(geminiApiKey, 'GEMINI_API_KEY must be configured for model-driven cross-server test');

    const toolsResult = await mcpClient.listTools();
    const modelTools: ModelToolDefinition[] = toolsResult.tools.map((t) => ({
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema as Record<string, unknown>,
    }));

    const adapter = new GeminiProviderAdapter({
      apiKey: geminiApiKey,
      model: 'gemini-flash-lite-latest',
    });

    const userPrompt = 'Who is the procurement contact for Acme Retail Ltd in our CRM, and what pending or in-progress tasks are assigned to them?';

    const messages: ModelMessage[] = [
      {
        role: 'user',
        content: userPrompt,
      },
    ];

    const executedTools: { name: string; args: any; result: any }[] = [];

    // Bounded agent loop: max 4 turns
    let finalAnswer = '';
    for (let turn = 1; turn <= 4; turn++) {
      const response = await adapter.generateChatTurn({
        messages,
        tools: modelTools,
      });

      if (response.toolCalls && response.toolCalls.length > 0) {
        // Record assistant turn with tool calls
        messages.push({
          role: 'assistant',
          toolCalls: response.toolCalls,
        });

        // Execute each requested tool call against the external MCP gateway client
        for (const toolCall of response.toolCalls) {
          const toolResult: any = await mcpClient.callTool({
            name: toolCall.name,
            arguments: toolCall.args,
          });

          const rawText = toolResult.content?.[0]?.text || '';
          executedTools.push({
            name: toolCall.name,
            args: toolCall.args,
            result: rawText,
          });

          messages.push({
            role: 'tool',
            toolCallId: toolCall.id,
            name: toolCall.name,
            content: rawText,
          });
        }
      } else if (response.content) {
        finalAnswer = response.content;
        messages.push({
          role: 'assistant',
          content: finalAnswer,
        });
        break;
      } else {
        break;
      }
    }

    // Verify model executed tools from TWO separate upstream servers
    const calledToolNames = executedTools.map((t) => t.name);
    const hasCrm = calledToolNames.some((n) => n.startsWith('crm__'));
    const hasTasks = calledToolNames.some((n) => n.startsWith('tasks__'));

    assert.ok(hasCrm, 'Model must invoke at least one tool from CRM upstream');
    assert.ok(hasTasks, 'Model must invoke at least one tool from Tasks upstream');
    assert.ok(finalAnswer.length > 0, 'Model must produce a final synthesized answer');

    // Verify domain data synthesized in the final response
    const answerLower = finalAnswer.toLowerCase();
    const mentionsAlice = answerLower.includes('alice');
    const mentionsTaskOrMug = answerLower.includes('task-001') || answerLower.includes('mug') || answerLower.includes('fulfillment');

    assert.ok(mentionsAlice, 'Final answer must mention Alice Smith from CRM');
    assert.ok(mentionsTaskOrMug, 'Final answer must mention TASK-001 or corporate mug fulfillment from Tasks');
  });

  it('Criterion 4: API-Key Revocation Acceptance & Rejection Verification', async () => {
    // 1. Verify the disposable key works initially with HTTP 200
    const preRevokeRes = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${disposableRawApiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    });

    assert.equal(preRevokeRes.status, 200, 'Pre-revocation request with valid disposable key must return 200');

    // 2. Revoke the disposable key via the supported Browser Admin API
    const revokeRes = await fetch(`${BROWSER_API}/keys/${disposableKeyId}/revoke`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Origin: GATEWAY_ORIGIN,
        Cookie: `urumi_session=${adminSessionCookie}`,
        'x-urumi-csrf': adminCsrfToken,
      },
    });

    assert.equal(revokeRes.status, 200, 'Revoke endpoint must return HTTP 200');
    const revokeBody: any = await revokeRes.json();
    assert.equal(revokeBody.success, true, 'Revoke response must indicate success');

    // 3. Make a fresh request using the revoked key via fresh transport
    const postRevokeRes = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${disposableRawApiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      }),
    });

    // 4. Confirm immediate rejection with HTTP 401 Unauthorized
    assert.equal(postRevokeRes.status, 401, 'Subsequent request with revoked key must return HTTP 401');
    const errorBody: any = await postRevokeRes.json().catch(() => ({}));
    assert.ok(
      errorBody.error && errorBody.error.includes('Unauthorized'),
      'Error message must state Unauthorized'
    );
  });
});
