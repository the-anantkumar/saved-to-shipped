import { Fault, type Access, type Input } from '../contracts';
import { FirestoreClient, isFirestoreCommitUncertain, isFirestoreConflict, type FirestoreEnv, type FirestorePort } from '../firestore/client';

/** Immutable original sale terms, with a permanent late-webhook tombstone. */
export interface BillingBinding extends Access {
  subscription_id: string; plan_id: string; amount: number; currency: 'INR'; closed: boolean;
}
export interface BillingBindings {
  get(subscriptionId: string): Promise<BillingBinding | null>;
  bind(binding: BillingBinding): Promise<BillingBinding>;
  close(subscriptionId: string, access: Access): Promise<void>;
}
const collection = 's2sBillingSubscriptions';
function invalid(): never { throw new Fault(503, 'BILLING_BINDING_UNAVAILABLE', 'Subscription ownership is unavailable.'); }
function conflict(): never { throw new Fault(409, 'BILLING_BINDING_CONFLICT', 'This subscription belongs to a different billing record.'); }
function id(value: unknown, prefix: 'sub' | 'plan'): value is string {
  return typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]{1,64}$`).test(value);
}
function path(subscriptionId: string): string {
  if (!id(subscriptionId, 'sub')) invalid();
  return `${collection}/${subscriptionId}`;
}
function parsed(value: Input, subscriptionId: string): BillingBinding {
  if (value.schema !== 1 || value.subscription_id !== subscriptionId || !id(value.subscription_id, 'sub') ||
      !id(value.plan_id, 'plan') || typeof value.uid !== 'string' || !value.uid || value.uid.length > 128 ||
      typeof value.generation !== 'string' || !value.generation || value.generation.length > 128 ||
      !Number.isSafeInteger(value.amount) || Number(value.amount) < 1 || value.currency !== 'INR' || typeof value.closed !== 'boolean') invalid();
  return { subscription_id: value.subscription_id, uid: value.uid, generation: value.generation,
    plan_id: value.plan_id, amount: Number(value.amount), currency: 'INR', closed: value.closed };
}
function same(first: BillingBinding, second: BillingBinding): boolean {
  return first.uid === second.uid && first.generation === second.generation && first.plan_id === second.plan_id &&
    first.amount === second.amount && first.currency === second.currency && first.subscription_id === second.subscription_id;
}
/** CAS is mandatory even when creation is retried after a lost commit response. */
export class FirestoreBillingBindings implements BillingBindings {
  private readonly firestore: FirestorePort;
  constructor(env: FirestoreEnv, firestore?: FirestorePort) { this.firestore = firestore ?? new FirestoreClient(env); }
  async get(subscriptionId: string): Promise<BillingBinding | null> {
    const document = await this.firestore.read(path(subscriptionId));
    return document ? parsed(document.data, subscriptionId) : null;
  }
  async bind(binding: BillingBinding): Promise<BillingBinding> {
    const proposed = parsed({ schema: 1, ...binding }, binding.subscription_id);
    if (proposed.closed) invalid();
    const location = path(proposed.subscription_id), existing = await this.get(proposed.subscription_id);
    if (existing) { if (!same(existing, proposed)) conflict(); return existing; }
    try {
      await this.firestore.commit([{ path: location, data: { schema: 1, ...proposed }, currentDocument: { exists: false } }]);
      return proposed;
    } catch (error) {
      if (!isFirestoreConflict(error) && !isFirestoreCommitUncertain(error)) throw error;
      const confirmed = await this.get(proposed.subscription_id);
      if (confirmed) { if (!same(confirmed, proposed)) conflict(); return confirmed; }
      throw error;
    }
  }
  async close(subscriptionId: string, access: Access): Promise<void> {
    const location = path(subscriptionId);
    for (let attempt = 0; attempt < 3; attempt++) {
      const document = await this.firestore.read(location);
      if (!document) invalid();
      const current = parsed(document.data, subscriptionId);
      if (current.uid !== access.uid || current.generation !== access.generation) conflict();
      if (current.closed) return;
      try {
        await this.firestore.commit([{ path: location, data: { schema: 1, ...current, closed: true }, currentDocument: { updateTime: document.updateTime } }]);
        return;
      } catch (error) {
        if (!isFirestoreConflict(error) && !isFirestoreCommitUncertain(error)) throw error;
        // Re-read a lost response; never overwrite a newer tombstone blindly.
        if (attempt === 2) throw error;
      }
    }
  }
}
