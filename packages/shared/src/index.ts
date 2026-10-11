/**
 * Shared domain models and protocol definitions for Urumi Team MCP Platform
 */

export type UserRole = 'admin' | 'member';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface ApiKeyRecord {
  id: string;
  userId: string;
  keyPrefix: string;
  keyHash: string;
  createdAt: string;
  revokedAt: string | null;
}

export type UpstreamServerStatus = 'Connected' | 'Unreachable' | 'Disabled';

export interface UpstreamServerRecord {
  id: string;
  name: string;
  slug: string;
  url: string;
  secretRef?: string;
  status: UpstreamServerStatus;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  serverId: string;
  serverName: string;
  toolName: string;
  timestamp: string;
  durationMs: number;
  status: 'success' | 'error';
  errorMessage?: string;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}
