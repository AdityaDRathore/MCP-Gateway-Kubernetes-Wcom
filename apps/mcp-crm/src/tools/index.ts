import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SearchContactsInputShape, GetContactInputShape, CrmContact } from './schemas.js';
import { SEEDED_CONTACTS } from '../data/fixtures.js';
import { AppConfig } from '../config.js';
import { logger } from '../logging/logger.js';

export function registerCrmTools(server: McpServer, config?: AppConfig): void {
  // 1. search_contacts
  server.registerTool(
    'search_contacts',
    {
      description: 'Search synthetic CRM contacts by query (name, company, email, title, notes, or ID) with deterministic sorting and bounded limit.',
      inputSchema: SearchContactsInputShape,
    },
    async (args) => {
      // Failure injection support for controlled resilience tests
      if (config?.MOCK_DELAY_MS && config.MOCK_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.MOCK_DELAY_MS));
      }

      if (config?.MOCK_FAIL_MODE === 'tool-error') {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Injected failure: CRM search_contacts simulated error' }],
        };
      }

      if (config?.MOCK_FAIL_MODE === 'http-500') {
        throw new Error('Injected failure: CRM simulated 500 internal server error');
      }

      const query = args.query?.toLowerCase();
      let matches = SEEDED_CONTACTS as readonly CrmContact[];

      if (query) {
        matches = matches.filter(
          (c) =>
            c.name.toLowerCase().includes(query) ||
            c.company.toLowerCase().includes(query) ||
            c.title.toLowerCase().includes(query) ||
            c.notes.toLowerCase().includes(query) ||
            c.email.toLowerCase().includes(query) ||
            c.id.toLowerCase().includes(query)
        );
      }

      // Deterministic sorting by ID ascending
      const sorted = [...matches].sort((a, b) => a.id.localeCompare(b.id));
      const limited = sorted.slice(0, args.limit);

      logger.debug('Executed search_contacts', {
        query: args.query,
        limit: args.limit,
        matchCount: limited.length,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(limited, null, 2),
          },
        ],
      };
    }
  );

  // 2. get_contact
  server.registerTool(
    'get_contact',
    {
      description: 'Retrieve full details for a synthetic CRM contact by contact_id.',
      inputSchema: GetContactInputShape,
    },
    async (args) => {
      // Failure injection support for controlled resilience tests
      if (config?.MOCK_DELAY_MS && config.MOCK_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.MOCK_DELAY_MS));
      }

      if (config?.MOCK_FAIL_MODE === 'tool-error') {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Injected failure: CRM get_contact simulated error' }],
        };
      }

      if (config?.MOCK_FAIL_MODE === 'http-500') {
        throw new Error('Injected failure: CRM simulated 500 internal server error');
      }

      const contact = SEEDED_CONTACTS.find((c) => c.id === args.contact_id);

      if (!contact) {
        logger.warn('Contact not found', { contact_id: args.contact_id });
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Contact not found: ${args.contact_id}`,
            },
          ],
        };
      }

      logger.debug('Retrieved contact', { contact_id: args.contact_id });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(contact, null, 2),
          },
        ],
      };
    }
  );
}
