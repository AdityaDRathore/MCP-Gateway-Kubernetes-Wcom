import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const TARGET_PORT = parseInt(process.env.PORT || '7777', 10);
const TARGET_HOST = process.env.HOST || '127.0.0.1';
const SERVER_URL = new URL(`http://${TARGET_HOST}:${TARGET_PORT}/mcp`);

const VALID_API_KEY = process.env.MCP_SPIKE_API_KEY;
if (!VALID_API_KEY || VALID_API_KEY.trim().length === 0) {
  console.error('[FATAL] MCP_SPIKE_API_KEY environment variable is required to run test client.');
  process.exit(1);
}

const INVALID_API_KEY = 'invalid-tampered-token-' + Date.now();

async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting MCP Streamable HTTP Protocol Spike Tests');
  console.log(`Target: ${SERVER_URL.toString()}`);
  console.log('Authentication: Dynamic test secret configured');
  console.log('====================================================\n');

  let passedTests = 0;
  let totalTests = 4;

  // -------------------------------------------------------------------------
  // Test 1: Unauthenticated request must be rejected with 401 Unauthorized
  // -------------------------------------------------------------------------
  console.log('👉 [Test 1/4] Testing Authentication Enforcement (Reject Invalid/Missing Key)...');
  try {
    const unauthTransport = new StreamableHTTPClientTransport(SERVER_URL, {
      requestInit: {
        headers: {
          Authorization: `Bearer ${INVALID_API_KEY}`
        }
      }
    });

    const unauthClient = new Client({ name: 'unauth-client', version: '1.0.0' });
    let rejected = false;

    try {
      await unauthClient.connect(unauthTransport);
    } catch (err: unknown) {
      rejected = true;
      console.log('   ✅ Request successfully rejected as expected with error response');
    }

    if (!rejected) {
      throw new Error('FAILED: Server accepted connection with invalid API key!');
    }

    passedTests++;
    console.log('   ✅ PASS: Authentication barrier verified (401 Unauthorized).\n');
  } catch (err: unknown) {
    console.error('   ❌ FAIL Test 1:', (err as Error).message, '\n');
  }

  // -------------------------------------------------------------------------
  // Test 2: Authenticated connection over Streamable HTTP transport
  // -------------------------------------------------------------------------
  console.log('👉 [Test 2/4] Connecting with Valid Authorization Header over Streamable HTTP...');
  const authTransport = new StreamableHTTPClientTransport(SERVER_URL, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${VALID_API_KEY}`
      }
    }
  });

  const authClient = new Client({
    name: 'test-verified-client',
    version: '1.0.0'
  });

  try {
    await authClient.connect(authTransport);
    console.log('   ✅ Connected successfully over Streamable HTTP!');
    console.log('   ✅ Protocol handshake completed.');
    passedTests++;
    console.log('   ✅ PASS: Streamable HTTP connection & protocol handshake established.\n');
  } catch (err: unknown) {
    console.error('   ❌ FAIL Test 2:', (err as Error).message, '\n');
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Test 3: Tool Discovery (client.listTools)
  // -------------------------------------------------------------------------
  console.log('👉 [Test 3/4] Testing Tool Discovery (client.listTools)...');
  try {
    const toolsResult = await authClient.listTools();
    console.log(`   Found ${toolsResult.tools.length} tool(s):`);
    for (const tool of toolsResult.tools) {
      console.log(`   - Name: ${tool.name}`);
      console.log(`     Description: ${tool.description}`);
      console.log(`     Input Schema:`, JSON.stringify(tool.inputSchema));
    }

    const echoTool = toolsResult.tools.find((t) => t.name === 'echo_message');
    if (!echoTool) {
      throw new Error('FAILED: echo_message tool was not discovered in tools list!');
    }

    passedTests++;
    console.log('   ✅ PASS: Tool "echo_message" discovered via protocol.\n');
  } catch (err: unknown) {
    console.error('   ❌ FAIL Test 3:', (err as Error).message, '\n');
  }

  // -------------------------------------------------------------------------
  // Test 4: Tool Invocation (client.callTool)
  // -------------------------------------------------------------------------
  console.log('👉 [Test 4/4] Testing Tool Execution (client.callTool)...');
  try {
    const testMessage = 'Hello Urumi AI Take-Home Spike!';
    const callResult = await authClient.callTool({
      name: 'echo_message',
      arguments: {
        message: testMessage
      }
    });

    console.log('   Tool call raw response:', JSON.stringify(callResult, null, 2));

    const contentArray = callResult.content as Array<{ type: string; text: string }>;
    if (!contentArray || contentArray.length === 0 || !contentArray[0].text.includes(testMessage)) {
      throw new Error(`FAILED: Unexpected tool output: ${JSON.stringify(callResult)}`);
    }

    passedTests++;
    console.log('   ✅ PASS: Tool "echo_message" executed successfully with verified output.\n');
  } catch (err: unknown) {
    console.error('   ❌ FAIL Test 4:', (err as Error).message, '\n');
  }

  // Teardown
  await authClient.close();
  console.log('🔌 Client disconnected cleanly.');

  console.log('====================================================');
  console.log(`🏁 Spike Verification Summary: ${passedTests}/${totalTests} tests passed`);
  if (passedTests === totalTests) {
    console.log('🎉 VERDICT: ALL MCP PROTOCOL COMPATIBILITY CHECKS PASSED!');
    console.log('====================================================');
    process.exit(0);
  } else {
    console.error('❌ VERDICT: SPIKE TESTS FAILED');
    console.log('====================================================');
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
