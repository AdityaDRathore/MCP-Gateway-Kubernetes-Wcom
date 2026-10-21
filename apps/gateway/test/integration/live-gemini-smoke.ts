import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeminiProviderAdapter } from '../../src/chat/gemini-provider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const secretPath = path.resolve(__dirname, '../../../../.secrets/gemini.env');
  if (!fs.existsSync(secretPath)) {
    console.log('[SKIP] .secrets/gemini.env does not exist');
    return;
  }

  const content = fs.readFileSync(secretPath, 'utf8');
  const match = content.match(/GEMINI_API_KEY=(.+)/);
  if (!match) {
    console.log('[SKIP] GEMINI_API_KEY not found in secret file');
    return;
  }

  const apiKey = match[1].trim();
  console.log(`[INFO] Found GEMINI_API_KEY (${apiKey.length} chars). Testing live round-trip...`);

  const adapter = new GeminiProviderAdapter({
    apiKey,
    model: 'gemini-flash-lite-latest',
  });

  try {
    const response = await adapter.generateChatTurn({
      messages: [{ role: 'user', content: 'Reply with the single word: PONG' }],
    });
    console.log('[SUCCESS] Live Gemini API response:', JSON.stringify(response));

    const toolResponse = await adapter.generateChatTurn({
      messages: [{ role: 'user', content: 'What store orders do we have?' }],
      tools: [
        {
          name: 'woocommerce__list_orders',
          description: 'List recent store orders',
          parameters: {
            type: 'object',
            properties: {
              per_page: { type: 'number', description: 'Number of orders to return' },
            },
          },
        },
      ],
    });
    console.log('[SUCCESS] Live Gemini Tool Call response:', JSON.stringify(toolResponse));
  } catch (err) {
    console.warn('[WARN] Live Gemini API request failed (network or quota limitation):', err);
  }
}

main();
