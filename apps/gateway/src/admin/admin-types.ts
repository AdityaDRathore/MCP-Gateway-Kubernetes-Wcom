import { z } from 'zod';
import { validateAndNormalizeUpstreamUrl } from '../upstream/url-validator.js';

/**
 * Validates endpointUrl against the canonical Gate G5 SSRF allowlist.
 */
export const CanonicalUpstreamUrlSchema = z.string().superRefine((val, ctx) => {
  try {
    validateAndNormalizeUpstreamUrl(val, {
      allowLocalhostForTesting: process.env.NODE_ENV !== 'production',
    });
  } catch (err: unknown) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export const CreateUpstreamSchema = z.object({
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(32, 'Slug must not exceed 32 characters')
    .regex(/^[a-z0-9-]{2,32}$/, 'Slug must consist only of lowercase alphanumeric characters and hyphens'),
  displayName: z
    .string()
    .min(1, 'Display name must not be empty')
    .max(100, 'Display name must not exceed 100 characters'),
  endpointUrl: CanonicalUpstreamUrlSchema,
  timeoutMs: z
    .coerce
    .number()
    .int('Timeout must be an integer')
    .min(500, 'Timeout must be at least 500ms')
    .max(30000, 'Timeout must not exceed 30000ms')
    .default(10000),
  credential: z
    .string()
    .min(1, 'Credential must not be empty')
    .max(4096, 'Credential must not exceed 4096 characters')
    .optional(),
  credentials: z
    .record(z.string().min(1), z.string().min(1).max(4096))
    .optional(),
  credentialKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Credential key must be alphanumeric, hyphen, or underscore')
    .optional(),
}).strict().refine(
  (data) => !(data.credential && data.credentials),
  'Specify either single "credential" or multi-key "credentials", not both'
);

export type CreateUpstreamInput = z.infer<typeof CreateUpstreamSchema>;

export const UpdateUpstreamSchema = z.object({
  displayName: z
    .string()
    .min(1, 'Display name must not be empty')
    .max(100, 'Display name must not exceed 100 characters')
    .optional(),
  endpointUrl: CanonicalUpstreamUrlSchema.optional(),
  timeoutMs: z
    .coerce
    .number()
    .int('Timeout must be an integer')
    .min(500, 'Timeout must be at least 500ms')
    .max(30000, 'Timeout must not exceed 30000ms')
    .optional(),
  credential: z
    .string()
    .min(1, 'Credential must not be empty')
    .max(4096, 'Credential must not exceed 4096 characters')
    .optional(),
  credentials: z
    .record(z.string().min(1), z.string().min(1).max(4096))
    .optional(),
  credentialKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Credential key must be alphanumeric, hyphen, or underscore')
    .optional(),
}).strict().refine(
  (data) => !(data.credential && data.credentials),
  'Specify either single "credential" or multi-key "credentials", not both'
);

export type UpdateUpstreamInput = z.infer<typeof UpdateUpstreamSchema>;

export interface UpstreamHealthDTO {
  healthState: 'connecting' | 'available' | 'unavailable' | 'disabled';
  toolCount: number;
  lastCheckedAt: number;
  lastError?: string;
}

export interface UpstreamResponseDTO {
  id: string;
  slug: string;
  displayName: string;
  endpointUrl: string;
  timeoutMs: number;
  isEnabled: boolean;
  status: 'provisioning' | 'active' | 'disabled' | 'deleting' | 'cleanup_required' | 'failed';
  secretRefName: string | null;
  cleanupError: string | null;
  createdAt: number;
  updatedAt: number;
  health: UpstreamHealthDTO;
  auditDegraded?: boolean;
}
