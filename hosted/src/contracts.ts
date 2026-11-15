/** Shared closed-beta contract. Identity is supplied only by the trusted Worker. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Input = Record<string, unknown>;
export interface Access { uid: string; generation: string }
export type Result<T = unknown> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string };
export class Fault extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function failure(error: unknown): Result<never> {
  return error instanceof Fault
    ? { ok: false, status: error.status, code: error.code, message: error.message }
    : { ok: false, status: 503, code: 'TEMPORARILY_UNAVAILABLE', message: 'Please try again later.' };
}
export const LIMITS = Object.freeze({
  items: 1000, logicalBytes: 5_000_000, sqliteUsedBytes: 7_000_000, itemBytes: 131_072,
  requestBytes: 262_144, batch: 25, page: 50, groups: 100,
  receipts: 128, imports: 20, jobs: 20,
});
export const KINDS = ['untriaged', 'project', 'learning', 'experience', 'reference', 'skip'] as const;
export const STATUSES = ['inbox', 'ready', 'doing', 'done', 'parked'] as const;
export interface StorageEnv {
  ENTITLEMENTS_ENABLED?: string;
  CREDENTIAL_KEYS?: string;
  WORKSPACE_ITEM_LIMIT?: string;
  WORKSPACE_LOGICAL_LIMIT?: string;
  WORKSPACE_USED_LIMIT?: string;
}
export interface StoredJob extends Input {
  id: string;
  kind: 'retrieval' | 'classification';
  status: string;
  revision: number;
  selected_ids: string[];
  selected_revisions: Record<string, number>;
  created_at: string;
  updated_at: string;
}
export interface Ciphertext {
  version: string;
  nonce: string;
  ciphertext: string;
}
export interface Membership extends Access {
  state: 'reserved' | 'active' | 'suspended' | 'deleting' | 'deleted';
  created_at: string;
  lifecycle_epoch?: number;
}
export function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Fault(400, 'INVALID_INPUT', `${name} must be between ${min} and ${max}.`);
  return value;
}
export function string(value: unknown, name: string, max: number, blank = true): string {
  if (typeof value !== 'string' || Array.from(value).length > max || (!blank && !value.trim()))
    throw new Fault(400, 'INVALID_INPUT', `${name} is invalid.`);
  return value.trim();
}
export function object(value: unknown): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Fault(400, 'INVALID_INPUT', 'Expected an object.');
  return value as Input;
}
