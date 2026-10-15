import { z } from 'zod';

export const CrmContactSchema = z.object({
  id: z.string().regex(/^CRM-CONT-[0-9]{3}$/, 'ID must match CRM-CONT-###'),
  name: z.string().min(1).max(100),
  title: z.string().min(1).max(100),
  company: z.string().min(1).max(100),
  email: z.string().email().refine((e) => e.endsWith('@example.mock'), 'Must use @example.mock domain'),
  phone: z.string().min(5).max(30),
  status: z.enum(['active', 'lead', 'inactive']),
  notes: z.string().max(500),
});

export type CrmContact = z.infer<typeof CrmContactSchema>;

/**
 * Tool 1: search_contacts input parameter shape
 */
export const SearchContactsInputShape = {
  query: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .optional()
    .describe('Optional query string to search contacts by name, company, email, title, or notes (1..50 characters)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(10)
    .describe('Maximum number of contacts to return (bounded 1 to 20, default 10)'),
};

/**
 * Tool 2: get_contact input parameter shape
 */
export const GetContactInputShape = {
  contact_id: z
    .string()
    .regex(/^CRM-CONT-[0-9]{3}$/, 'Invalid Contact ID format. Must match CRM-CONT-###')
    .describe('Unique CRM contact ID in format CRM-CONT-###'),
};
