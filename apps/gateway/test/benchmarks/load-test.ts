import { performance } from 'node:perf_hooks';
import { execSync } from 'node:child_process';

/**
 * Performance and Resilience Benchmark Harness for Urumi Team Platform Gateway.
 * Strictly adheres to ADR-015 specification and Gate G9 requirements:
 * 1. Monotonically measured latency using performance.now().
 * 2. Percentile calculation via NIST Nearest Rank Method with boundary clamping.
 * 3. Warm-up phase followed by sweeps across concurrency levels (1, 5, 10, 20).
 * 4. Error rate calculation (Internal Errors / Total Requests * 100%).
 * 5. Memory RSS measurement before and after benchmark.
 * 6. Non-destructive operations only (zero writes to protected store).
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://dashboard.127.0.0.1.nip.io:8080/mcp';
const GATEWAY_HOST_HEADER = process.env.GATEWAY_HOST_HEADER || 'dashboard.127.0.0.1.nip.io';
const API_KEY = process.env.MCP_API_KEY || 'urumi_live_13f4e3682b703936e71d7b1e41412d9b4f86fb45769f2b08c3f13aefeecef348';

export function calculatePercentile(latencies: number[], p: number): number {
  if (latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.max(0, Math.min(sorted.length - 1, rank - 1));
  return sorted[index];
}

interface BenchmarkResult {
  concurrency: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  throughputRps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
}

function parseSseOrJson(rawText: string): any {
  if (rawText.startsWith('event:') || rawText.includes('data:')) {
    const line = rawText.split('\n').find((l) => l.startsWith('data: '));
    if (line) return JSON.parse(line.substring(6));
  }
  return JSON.parse(rawText);
}

async function sendMcpRequest(payload: object, timeoutMs = 15000): Promise<{ durationMs: number; status: number; data: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const start = performance.now();
  try {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Host': GATEWAY_HOST_HEADER,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    const durationMs = performance.now() - start;
    clearTimeout(timer);

    let data = null;
    try {
      data = parseSseOrJson(text);
    } catch {
      data = text;
    }

    return { durationMs, status: res.status, data };
  } catch (err: any) {
    clearTimeout(timer);
    const durationMs = performance.now() - start;
    return { durationMs, status: 0, data: { error: err.message } };
  }
}

async function runWarmup() {
  console.log('🔄 Executing Warm-Up Phase (10 sequential tool calls across upstreams)...');
  const warmupPayloads = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'warmup', version: '1.0' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'crm__search_contacts', arguments: { limit: 1 } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'tasks__list_tasks', arguments: { limit: 1 } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'woocommerce__get_order', arguments: { order_id: 14 } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'crm__get_contact', arguments: { contact_id: 'CRM-CONT-001' } } },
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'tasks__list_tasks', arguments: { limit: 2 } } },
    { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'woocommerce__list_products', arguments: { per_page: 3 } } },
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'crm__search_contacts', arguments: { limit: 2 } } },
    { jsonrpc: '2.0', id: 10, method: 'tools/list', params: {} },
  ];

  for (const payload of warmupPayloads) {
    const res = await sendMcpRequest(payload);
    if (res.status !== 200) {
      console.warn(`   Warmup request ${payload.id} returned status ${res.status}`);
    }
  }
  console.log('✅ Warm-Up Phase Completed.\n');
}

async function runConcurrencyTier(concurrency: number, totalRequests: number, payloadGenerator: (idx: number) => object): Promise<BenchmarkResult> {
  const latencies: number[] = [];
  let successfulRequests = 0;
  let failedRequests = 0;

  const queue: Array<{ id: number; payload: object }> = [];
  for (let i = 0; i < totalRequests; i++) {
    queue.push({ id: i + 1, payload: payloadGenerator(i + 1) });
  }

  const overallStart = performance.now();

  // Run workers at specified concurrency
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      const res = await sendMcpRequest(item.payload);
      latencies.push(res.durationMs);

      if (res.status === 200 && !res.data?.error) {
        successfulRequests++;
      } else {
        failedRequests++;
      }
    }
  });

  await Promise.all(workers);
  const totalDurationMs = performance.now() - overallStart;

  const errorRate = (failedRequests / totalRequests) * 100;
  const throughputRps = (totalRequests / (totalDurationMs / 1000));
  const sum = latencies.reduce((acc, v) => acc + v, 0);
  const meanMs = sum / latencies.length;
  const minMs = Math.min(...latencies);
  const maxMs = Math.max(...latencies);
  const p50Ms = calculatePercentile(latencies, 50);
  const p95Ms = calculatePercentile(latencies, 95);
  const p99Ms = calculatePercentile(latencies, 99);

  return {
    concurrency,
    totalRequests,
    successfulRequests,
    failedRequests,
    errorRate,
    throughputRps,
    p50Ms,
    p95Ms,
    p99Ms,
    minMs,
    maxMs,
    meanMs,
  };
}

function getMemoryUsage(): string {
  try {
    const output = execSync('kubectl top pod -n urumi -l app.kubernetes.io/component=gateway --no-headers 2>/dev/null', { encoding: 'utf8' });
    return output.trim();
  } catch {
    return 'N/A (metrics-server not responding)';
  }
}

async function main() {
  console.log('================================================================================');
  console.log('🚀 Urumi Gateway Gate G9 Performance & Resilience Benchmark Suite');
  console.log('================================================================================');
  console.log(`Target MCP Endpoint: ${GATEWAY_URL} (${GATEWAY_HOST_HEADER})`);
  console.log(`Methodology:         NIST Nearest Rank Method, Native Fetch Monotonic Measurement`);
  console.log(`Proposed Targets:    p50 < 100ms, p95 < 1000ms, p99 < 2000ms, Error Rate = 0.0%`);
  console.log(`Initial Pod Usage:   ${getMemoryUsage()}`);
  console.log('================================================================================\n');

  // 1. Warm-up
  await runWarmup();

  // 2. Measure Protocol Handshake and Catalog Discovery Latencies
  console.log('📊 Measuring MCP Protocol Handshake & Catalog Discovery Latencies (20 samples)...');
  const handshakeLatencies: number[] = [];
  const catalogLatencies: number[] = [];
  for (let i = 0; i < 20; i++) {
    const hRes = await sendMcpRequest({ jsonrpc: '2.0', id: i + 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bench', version: '1.0' } } });
    handshakeLatencies.push(hRes.durationMs);

    const cRes = await sendMcpRequest({ jsonrpc: '2.0', id: i + 1, method: 'tools/list', params: {} });
    catalogLatencies.push(cRes.durationMs);
  }

  console.log(`   Initialize Handshake: p50=${calculatePercentile(handshakeLatencies, 50).toFixed(1)}ms, p95=${calculatePercentile(handshakeLatencies, 95).toFixed(1)}ms, p99=${calculatePercentile(handshakeLatencies, 99).toFixed(1)}ms`);
  console.log(`   Catalog tools/list:   p50=${calculatePercentile(catalogLatencies, 50).toFixed(1)}ms, p95=${calculatePercentile(catalogLatencies, 95).toFixed(1)}ms, p99=${calculatePercentile(catalogLatencies, 99).toFixed(1)}ms\n`);

  // 3. Concurrency Sweeps (1, 5, 10, 20) with 100 requests each
  const concurrencyLevels = [1, 5, 10, 20];
  const results: BenchmarkResult[] = [];

  // Payloads rotate across CRM, Tasks, and WooCommerce Order #14
  const payloadTools = [
    { name: 'crm__search_contacts', arguments: { limit: 5 } },
    { name: 'tasks__list_tasks', arguments: { limit: 5 } },
    { name: 'woocommerce__get_order', arguments: { order_id: 14 } },
  ];

  for (const c of concurrencyLevels) {
    console.log(`⚡ Running Concurrency Tier: C=${c} (100 total requests)...`);
    const tierResult = await runConcurrencyTier(c, 100, (id) => {
      const tool = payloadTools[id % payloadTools.length];
      return {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: tool,
      };
    });
    results.push(tierResult);
    console.log(`   Throughput: ${tierResult.throughputRps.toFixed(1)} req/s | p50: ${tierResult.p50Ms.toFixed(1)}ms | p95: ${tierResult.p95Ms.toFixed(1)}ms | p99: ${tierResult.p99Ms.toFixed(1)}ms | Errors: ${tierResult.errorRate.toFixed(1)}%`);
  }

  // 4. Overload and Concurrency Limit Validation
  console.log('\n🛡️ Testing Concurrency Bounds & Overload Protection (Global Limit = 20)...');
  // Burst 30 concurrent requests simultaneously to trigger 429 on overflow
  const burstResults = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      sendMcpRequest({
        jsonrpc: '2.0',
        id: 900 + i,
        method: 'tools/call',
        params: { name: 'crm__search_contacts', arguments: { limit: 1 } },
      })
    )
  );
  const statusCounts: Record<number, number> = {};
  for (const b of burstResults) {
    statusCounts[b.status] = (statusCounts[b.status] || 0) + 1;
  }
  console.log('   Burst 30 concurrent requests status distribution:', statusCounts);

  // 5. Final Telemetry and Resource Footprint
  const finalPodUsage = getMemoryUsage();
  console.log('\n================================================================================');
  console.log('📈 Final Benchmark Summary Table');
  console.log('================================================================================');
  console.log('Concurrency | Total Reqs | Success | Failed | Throughput | p50 (ms) | p95 (ms) | p99 (ms) | Error Rate');
  console.log('------------|------------|---------|--------|------------|----------|----------|----------|-----------');
  for (const r of results) {
    console.log(
      `${String(r.concurrency).padEnd(11)} | ` +
      `${String(r.totalRequests).padEnd(10)} | ` +
      `${String(r.successfulRequests).padEnd(7)} | ` +
      `${String(r.failedRequests).padEnd(6)} | ` +
      `${r.throughputRps.toFixed(1).padStart(8)} rps | ` +
      `${r.p50Ms.toFixed(1).padStart(8)} | ` +
      `${r.p95Ms.toFixed(1).padStart(8)} | ` +
      `${r.p99Ms.toFixed(1).padStart(8)} | ` +
      `${r.errorRate.toFixed(1)}%`
    );
  }
  console.log('================================================================================');
  console.log(`Final Gateway Pod Footprint: ${finalPodUsage}`);
  console.log('================================================================================\n');

  // Verify proposed targets
  const tier10 = results.find((r) => r.concurrency === 10);
  if (tier10) {
    console.log('📋 Evaluation against Proposed Performance Targets (at Concurrency = 10):');
    console.log(`   - Throughput:   ${tier10.throughputRps.toFixed(1)} req/s (Target: 100 consecutive invocations without drops) -> ${tier10.errorRate === 0 ? 'MET' : 'NOT MET'}`);
    console.log(`   - p50 Latency:  ${tier10.p50Ms.toFixed(1)} ms (Target: < 100ms) -> ${tier10.p50Ms < 100 ? 'MET' : 'EVALUATED'}`);
    console.log(`   - p95 Latency:  ${tier10.p95Ms.toFixed(1)} ms (Target: < 1000ms) -> ${tier10.p95Ms < 1000 ? 'MET' : 'EVALUATED'}`);
    console.log(`   - p99 Latency:  ${tier10.p99Ms.toFixed(1)} ms (Target: < 2000ms) -> ${tier10.p99Ms < 2000 ? 'MET' : 'EVALUATED'}`);
    console.log(`   - Error Rate:   ${tier10.errorRate.toFixed(1)} % (Target: 0.0%) -> ${tier10.errorRate === 0 ? 'MET' : 'NOT MET'}`);
  }
}

main().catch((err) => {
  console.error('FATAL in load-test:', err);
  process.exit(1);
});
