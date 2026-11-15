import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspaceRuntime, row, bob } from './workspace-helpers.mjs';
import { initialBilling, freeBucket, currentBucket, reservePoints, settlePoint, publicEntitlements, billingTransition } from '../.local/build/src/billing/policy.js';
const env = { ENTITLEMENTS_ENABLED: 'true' };
const ai = { kind: 'learning', title: 'Practice SQLite', why: 'One small example', next_action: 'Run it', definition_of_done: 'Record what happened', repo_suggestion: '', commit_message: '', confidence: 'medium', effort_hours: 1, impact: 3, relevance: 4, novelty: 3, tags: ['sqlite'] };
async function runtime(t) { const rt = await workspaceRuntime({ limits: env }); t.after(() => rt.dispose()); await rt.provision(); return rt; }
async function begin(rt, items, id) { return rt.mutate('job.begin', { job: { id, kind: 'classification', status: 'STARTING', selected_ids: items.map(item => item.id), selected_revisions: Object.fromEntries(items.map(item => [item.id, item.revision])), reserved_bytes: 100000 } }); }
async function bind(rt, id = 'sub-synthetic') {
  const created = await rt.call('checkout.begin', { intent_id: 'checkout-synthetic', plan_id: 'plan-synthetic', amount: 10000, currency: 'INR' });
  assert.equal(created.submit, true);
  await rt.call('checkout.complete', { intent_id: created.intent_id, subscription_id: id, plan_id: created.plan_id, checkout_url: 'https://rzp.io/i/synthetic' });
}
const paid = (start, end, invoice = 'invoice-synthetic') => ({ subscription_id: 'sub-synthetic', plan_id: 'plan-synthetic', invoice_id: invoice, period_start: start, period_end: end });

test('free growth caps cover capture, restore and inline sections without blocking existing edits', async t => {
  const rt = await runtime(t);
  for (let sequence = 0; sequence < 4; sequence++) await rt.mutate('import', { import_id: 'free-limit', sequence, rows: Array.from({ length: 25 }, (_, n) => row(sequence * 25 + n, 'A useful example')) });
  const summary = await rt.call('state'); assert.equal(summary.entitlements.saves.used, 100); assert.equal(summary.entitlements.saves.remaining, 0);
  assert.equal((await rt.invoke('capture', { ...row(101), request_id: 'over-save' })).code, 'PLAN_SAVE_LIMIT');
  const item = (await rt.call('list', { limit: 1 })).items[0];
  let detail = await rt.call('detail', { id: item.id });
  detail = (await rt.mutate('item', { id: detail.id, expected_revision: detail.revision, note: 'Keep editing at the cap' })).item;
  for (const [name, kind] of [['Projects', 'project'], ['Learning', 'learning'], ['Experiences', 'experience']]) await rt.mutate('project', { name, kind });
  assert.equal((await rt.invoke('item', { id: detail.id, expected_revision: detail.revision, kind: 'learning', new_project_name: 'No orphan', request_id: 'inline-over' })).code, 'PLAN_SECTION_LIMIT');
  assert.equal((await rt.call('detail', { id: detail.id })).kind, 'untriaged');
  assert.equal((await rt.invoke('restore', { import_id: 'restore-over', sequence: 0, rows: [], workspace: { version: 1, projects: [{ id: 'fourth', name: 'Fourth' }] }, request_id: 'restore-over' })).code, 'PLAN_SECTION_LIMIT');
  assert.equal((await rt.call('state')).projects.length, 3);
  assert.equal((await rt.call('export', { limit: 1 })).items[0].note, 'Keep editing at the cap');
  assert.equal((await rt.invoke('billing.get', {}, bob)).code, 'NOT_FOUND');
});

test('points reserve atomically, charge only applied saves, release skips and finish once', async t => {
  const rt = await runtime(t), items = [];
  for (let n = 1; n <= 3; n++) items.push((await rt.capture(n)).item);
  let job = await begin(rt, items, 'point-job');
  assert.deepEqual((await rt.call('state')).entitlements.points.used, 0);
  assert.equal((await rt.call('state')).entitlements.points.reserved, 3);
  assert.equal((await begin(rt, items, 'point-job')).replayed, true);
  assert.equal((await rt.call('state')).entitlements.points.reserved, 3);
  await rt.mutate('item', { id: items[1].id, expected_revision: items[1].revision, note: 'Changed after submission' });
  job = await rt.call('job.apply', { id: job.id, expected_job_revision: job.revision, candidates: items.slice(0, 2).map(item => ({ id: item.id, patch: ai })), terminal: true });
  const points = (await rt.call('state')).entitlements.points;
  assert.equal(points.used, 1); assert.equal(points.reserved, 0); assert.equal(points.remaining, 19);
  assert.equal((await rt.invoke('job.apply', { id: job.id, expected_job_revision: job.revision - 1, candidates: [{ id: items[0].id, patch: ai }], terminal: true })).code, 'REVISION_CONFLICT');
  assert.equal((await begin(rt, items, 'point-job')).replayed, true);
  assert.equal((await rt.call('state')).entitlements.points.used, 1);
});

test('uncertain work holds points, terminal failures release them, and oversized batches cannot reserve', async t => {
  const rt = await runtime(t), items = [];
  for (let n = 1; n <= 21; n++) items.push((await rt.capture(n)).item);
  const failed = await rt.invoke('job.begin', { request_id: 'too-many-points', job: { id: 'too-many', kind: 'classification', status: 'STARTING', selected_ids: items.map(item => item.id), selected_revisions: Object.fromEntries(items.map(item => [item.id, item.revision])), reserved_bytes: 100000 } });
  assert.equal(failed.code, 'AI_POINTS_LIMIT'); assert.equal((await rt.call('state')).entitlements.points.reserved, 0);
  let job = await begin(rt, items.slice(0, 20), 'uncertain-job');
  job = await rt.call('job.update', { id: job.id, expected_job_revision: job.revision, patch: { status: 'UNCERTAIN' } });
  assert.equal((await rt.call('state')).entitlements.points.remaining, 0);
  assert.equal((await rt.invoke('job.begin', { request_id: 'concurrent-job', job: { id: 'other-job', kind: 'classification', status: 'STARTING', selected_ids: [items[20].id], selected_revisions: { [items[20].id]: items[20].revision }, reserved_bytes: 100000 } })).code, 'JOB_ACTIVE');
  await rt.call('job.update', { id: job.id, expected_job_revision: job.revision, patch: { status: 'DISMISSED' } });
  assert.equal((await rt.call('state')).entitlements.points.remaining, 20);
  job = await begin(rt, [items[20]], 'failed-job');
  await rt.call('job.update', { id: job.id, expected_job_revision: job.revision, patch: { status: 'FAILED' } });
  assert.equal((await rt.call('state')).entitlements.points.reserved, 0);
});

test('checkout uncertainty blocks duplicate creation and signed-paid-period grants are private and replay safe', async t => {
  const rt = await runtime(t);
  const intent = await rt.call('checkout.begin', { intent_id: 'checkout-synthetic', plan_id: 'plan-synthetic', amount: 10000, currency: 'INR' }); assert.equal(intent.submit, true);
  await rt.call('checkout.uncertain', { intent_id: intent.intent_id });
  assert.equal((await rt.call('checkout.begin', { intent_id: 'new-intent', plan_id: 'plan-synthetic' })).submit, false);
  assert.equal((await rt.invoke('checkout.failed', { intent_id: intent.intent_id })).code, 'BILLING_UNCERTAIN');
  await rt.call('checkout.complete', { intent_id: intent.intent_id, plan_id: 'plan-synthetic', subscription_id: 'sub-synthetic', checkout_url: 'https://rzp.io/i/synthetic' });
  const at = Date.now(), first = paid(at - 1000, at + 100000);
  assert.equal((await rt.call('billing.paid', first)).applied, true);
  const item = (await rt.capture(1)).item, job = await begin(rt, [item], 'paid-job');
  await rt.call('job.apply', { id: job.id, expected_job_revision: job.revision, candidates: [{ id: item.id, patch: ai }], terminal: true });
  assert.equal((await rt.call('state')).entitlements.points.used, 1);
  assert.equal((await rt.call('billing.paid', first)).applied, false);
  assert.equal((await rt.call('billing.paid', paid(first.period_end, first.period_end + 30 * 86400000, 'invoice-next'))).applied, true);
  assert.equal((await rt.call('state')).entitlements.points.remaining, 199, 'future renewal must preserve current usage');
  assert.equal((await rt.invoke('billing.paid', { ...first, subscription_id: 'forged' })).code, 'BILLING_CONFLICT');
  assert.equal((await rt.invoke('billing.paid', { ...first, plan_id: 'forged' })).code, 'BILLING_CONFLICT');
  await rt.call('billing.cancel', { subscription_id: 'sub-synthetic', cancel_at_end: true });
  assert.equal((await rt.call('state')).entitlements.plan, 'pro');
  assert.equal((await rt.call('billing.get')).subscription.amount, 10000);
  assert.doesNotMatch(JSON.stringify(await rt.call('state')), /checkout_url|rzp.io|sub-synthetic|invoice-synthetic/);
  assert.doesNotMatch(JSON.stringify(await rt.call('export')), /checkout_url|rzp.io|sub-synthetic|invoice-synthetic/);
});

test('prior allowance jobs never debit a newly paid period and typed sections plus time preference round-trip', async t => {
  const rt = await runtime(t), item = (await rt.capture(1)).item;
  const old = await begin(rt, [item], 'old-free-job');
  await bind(rt); const at = Date.now(); await rt.call('billing.paid', paid(at - 1000, at + 30 * 86400000));
  await rt.call('job.apply', { id: old.id, expected_job_revision: old.revision, candidates: [{ id: item.id, patch: ai }], terminal: true });
  assert.equal((await rt.call('state')).entitlements.points.remaining, 200);
  let current = await rt.call('detail', { id: item.id });
  current = (await rt.mutate('item', { id: current.id, expected_revision: current.revision, new_project_name: 'Typed learning' })).item;
  const group = (await rt.call('state')).projects[0]; assert.equal(group.kind, 'learning');
  await rt.mutate('settings', { weekly_hours: 2.5 });
  assert.equal((await rt.call('state')).weekly_hours, 2.5);
  const backup = await rt.call('export'); assert.equal(backup.workspace.weekly_hours, 2.5); assert.equal(backup.workspace.projects[0].kind, 'learning');
  await rt.provision(bob);
  await rt.mutate('restore', { import_id: 'typed-restore', sequence: 0, workspace: backup.workspace, rows: backup.items }, bob);
  const restored = await rt.call('state', {}, bob); assert.equal(restored.weekly_hours, 2.5); assert.equal(restored.projects[0].kind, 'learning');
  for (const weekly_hours of [0, 169, '2', null]) assert.equal((await rt.invoke('settings', { request_id: `bad-hours-${weekly_hours}`, weekly_hours })).code, 'INVALID_INPUT');
});

test('UTC monthly rollover and expiry keep old jobs out of the active point bucket', () => {
  const november = Date.UTC(2026, 10, 30, 23, 59), december = Date.UTC(2026, 11, 1);
  let held = reservePoints(initialBilling(), 20, november);
  const next = reservePoints(held.state, 2, december);
  const settled = settlePoint(next.state, held.reservation, 'old-save', true);
  assert.equal(currentBucket(settled.state, december).reserved, 2);
  assert.equal(currentBucket(settled.state, december).used, 0);
  assert.equal(freeBucket(december).period_start, december);
  let state = initialBilling();
  state = billingTransition(state, 'checkout.begin', { intent_id: 'intent', plan_id: 'plan' }, november).state;
  state = billingTransition(state, 'checkout.complete', { intent_id: 'intent', plan_id: 'plan', subscription_id: 'sub', checkout_url: 'https://rzp.io/i/synthetic' }, november).state;
  state = billingTransition(state, 'billing.paid', { subscription_id: 'sub', plan_id: 'plan', invoice_id: 'paid', period_start: november, period_end: december }, november).state;
  assert.equal(publicEntitlements(env, state, 101, 4, december).plan, 'free');
  assert.equal(publicEntitlements(env, state, 101, 4, december).saves.remaining, 0);
  assert.deepEqual(publicEntitlements({}, state, 101, 4, december), { enabled: false });
});

test('simultaneous AI intents cannot overspend points or create two active jobs', async t => {
  const rt = await runtime(t), items = [];
  for (let n = 1; n <= 10; n++) items.push((await rt.capture(n)).item);
  const input = id => ({ request_id: id, job: { id, kind: 'classification', status: 'STARTING', selected_ids: items.map(item => item.id), selected_revisions: Object.fromEntries(items.map(item => [item.id, item.revision])), reserved_bytes: 100000 } });
  const results = await Promise.all([rt.invoke('job.begin', input('race-one')), rt.invoke('job.begin', input('race-two'))]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.find(result => !result.ok).code, 'JOB_ACTIVE');
  assert.equal((await rt.call('state')).entitlements.points.reserved, 10);
});

test('paid expiry preserves over-limit saves and sections while blocking further growth', async t => {
  const rt = await runtime(t); await bind(rt);
  const end = Date.now() + 1500;
  await rt.call('billing.paid', paid(end - 86400000, end));
  for (let sequence = 0; sequence < 4; sequence++) await rt.mutate('import', { import_id: 'paid-retained', sequence, rows: Array.from({ length: 25 }, (_, n) => row(sequence * 25 + n, 'An existing example')) });
  let item = (await rt.capture(101)).item;
  const groups = [];
  for (let n = 1; n <= 4; n++) groups.push(await rt.mutate('project', { name: `Retained ${n}`, kind: 'project' }));
  await rt.call('billing.closed', { subscription_id: 'sub-synthetic' });
  assert.equal((await rt.call('state')).entitlements.plan, 'pro', 'cancelled subscription retains its already-paid period');
  await new Promise(resolve => setTimeout(resolve, Math.max(0, end - Date.now() + 25)));
  assert.equal((await rt.call('state')).entitlements.plan, 'free');
  item = (await rt.mutate('item', { id: item.id, expected_revision: item.revision, note: 'My retained annotation' })).item;
  await rt.mutate('project', { id: groups[0].id, name: 'Renamed retained section' });
  assert.equal((await rt.call('detail', { id: item.id })).note, 'My retained annotation');
  assert.equal((await rt.call('export', { limit: 1 })).workspace.projects.length, 4);
  assert.equal((await rt.invoke('capture', { ...row(102), request_id: 'expired-save' })).code, 'PLAN_SAVE_LIMIT');
  assert.equal((await rt.invoke('project', { name: 'Fifth', kind: 'project', request_id: 'expired-section' })).code, 'PLAN_SECTION_LIMIT');
  const summary = await rt.call('state'); assert.equal(summary.entitlements.saves.used, 101); assert.equal(summary.entitlements.sections.used, 4);
});

test('deletion freeze accepts only repair of its retained checkout and cancellation binding', async t => {
  const rt = await runtime(t);
  await rt.call('checkout.begin', { intent_id: 'checkout-synthetic', plan_id: 'plan-synthetic', amount: 10000, currency: 'INR' });
  await rt.call('delete.prepare');
  assert.equal((await rt.invoke('close')).code, 'BILLING_UNCERTAIN');
  assert.equal((await rt.invoke('checkout.begin', { intent_id: 'new-checkout', plan_id: 'plan-synthetic' })).code, 'MEMBERSHIP_SUSPENDED');
  assert.equal((await rt.invoke('checkout.complete', { intent_id: 'wrong-intent', plan_id: 'plan-synthetic', subscription_id: 'sub-synthetic', checkout_url: 'https://rzp.io/i/synthetic' })).code, 'BILLING_CONFLICT');
  await rt.call('checkout.complete', { intent_id: 'checkout-synthetic', plan_id: 'plan-synthetic', subscription_id: 'sub-synthetic', checkout_url: 'https://rzp.io/i/synthetic' });
  assert.equal((await rt.invoke('close')).code, 'BILLING_ACTIVE');
  assert.equal((await rt.call('billing.get')).subscription.id, 'sub-synthetic');
  const at = Date.now(); assert.equal((await rt.invoke('billing.paid', paid(at - 1000, at + 10000))).code, 'MEMBERSHIP_SUSPENDED');
  await rt.call('billing.cancel', { subscription_id: 'sub-synthetic', cancel_at_end: true });
  await rt.call('billing.closed', { subscription_id: 'sub-synthetic' });
  assert.equal((await rt.call('billing.get')).subscription.closed, true);
  await rt.call('close'); assert.equal((await rt.invoke('billing.get')).code, 'NOT_FOUND');
});

test('disabling entitlements preserves outstanding checkout repair and subscription cancellation', async t => {
  const persist = await mkdtemp(join(tmpdir(), 'save2ship-entitlement-switch-'));
  let rt = await workspaceRuntime({ persist, limits: env });
  t.after(async () => { await rt.dispose(); await rm(persist, { recursive: true, force: true }); });
  await rt.provision();
  await rt.call('checkout.begin', { intent_id: 'checkout-synthetic', plan_id: 'plan-synthetic' });
  await rt.dispose(); rt = await workspaceRuntime({ persist });
  assert.equal((await rt.call('billing.get')).checkout.status, 'CREATING');
  assert.equal((await rt.invoke('checkout.begin', { intent_id: 'new-checkout', plan_id: 'plan-synthetic' })).code, 'ENTITLEMENTS_DISABLED');
  await rt.call('checkout.complete', { intent_id: 'checkout-synthetic', plan_id: 'plan-synthetic', subscription_id: 'sub-synthetic', checkout_url: 'https://rzp.io/i/synthetic' });
  const at = Date.now(); assert.equal((await rt.invoke('billing.paid', paid(at - 1000, at + 10000))).code, 'ENTITLEMENTS_DISABLED');
  await rt.call('billing.cancel', { subscription_id: 'sub-synthetic', cancel_at_end: true });
  await rt.call('billing.closed', { subscription_id: 'sub-synthetic' });
  assert.equal((await rt.call('billing.get')).subscription.closed, true);
  assert.deepEqual((await rt.call('state')).entitlements, { enabled: false });
});

test('future invoice arriving first cannot erase or duplicate the current paid allowance', () => {
  const at = Date.UTC(2026, 10, 15), start = Date.UTC(2026, 10, 1), next = Date.UTC(2026, 11, 1), after = Date.UTC(2027, 0, 1);
  let state = billingTransition(initialBilling(), 'checkout.begin', { intent_id: 'intent', plan_id: 'plan' }, at).state;
  state = billingTransition(state, 'checkout.complete', { intent_id: 'intent', plan_id: 'plan', subscription_id: 'sub', checkout_url: 'https://rzp.io/i/synthetic' }, at).state;
  const current = { subscription_id: 'sub', plan_id: 'plan', invoice_id: 'invoice-current', period_start: start, period_end: next };
  const future = { subscription_id: 'sub', plan_id: 'plan', invoice_id: 'invoice-future', period_start: next, period_end: after };
  state = billingTransition(state, 'billing.paid', future, at).state;
  assert.equal(publicEntitlements(env, state, 0, 0, at).plan, 'free');
  state = billingTransition(state, 'billing.paid', current, at).state;
  const held = reservePoints(state, 1, at);
  state = settlePoint(held.state, held.reservation, 'save', true).state;
  assert.equal(publicEntitlements(env, state, 0, 0, at).points.remaining, 199);
  state = billingTransition(state, 'billing.paid', future, at).state;
  state = billingTransition(state, 'billing.paid', current, at).state;
  assert.equal(publicEntitlements(env, state, 0, 0, at).points.remaining, 199);
  assert.equal(state.paid_periods.length, 2);
  state = billingTransition(state, 'billing.closed', { subscription_id: 'sub' }, at).state;
  assert.throws(() => billingTransition(state, 'billing.paid', current, at), { code: 'BILLING_CLOSED' });
  assert.equal(publicEntitlements(env, state, 0, 0, at).plan, 'pro');
});
