export const PROBE_OBJECT_NAME = 'save2ship-p1-single-run-v1';
export const MAX_ADMITTED_REQUESTS = 128;
export const MAX_VERIFICATION_CLAIMS = 16;
export const BASE_STEPS = ['seed-1', 'seed-2', 'read', 'edit', 'reject', 'delete'] as const;
export const FTS_STEPS = ['fts', 'fts-read'] as const;
export type ProbeStep = typeof BASE_STEPS[number] | typeof FTS_STEPS[number];
export const PROBE_LIMITS = Object.freeze({ items: 50, logicalBytes: 500_000, physicalBytes: 1_000_000 });

export interface ProbeEnvironment {
  PROBE_SECRET: string;
  PROBE_EXPIRES_AT: string;
  PROBE_INCLUDE_FTS?: string;
}

export function configuredPlan(env: ProbeEnvironment): readonly ProbeStep[] {
  return env.PROBE_INCLUDE_FTS === 'true' ? [...BASE_STEPS, ...FTS_STEPS] : BASE_STEPS;
}

export function expiry(env: ProbeEnvironment): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(env.PROBE_EXPIRES_AT ?? '')) return null;
  const value = Date.parse(env.PROBE_EXPIRES_AT);
  return Number.isFinite(value) ? value : null;
}

export function response(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
