// Synthetic transactional store shared by the Firestore contract checks.
import { FirestoreConflict, FirestoreCommitUncertain } from '../.local/build/src/firestore/client.js';

export class MemoryFirestore {
  documents = new Map();
  clock = 0;
  writes = 0;
  loseNextCommitResponse = false;
  failNextCommitBeforeApply = false;
  beforeCommit;
  async read(path) { return structuredClone(this.documents.get(path) ?? null); }
  async list(collection, { pageSize = 25, pageToken = '' } = {}) {
    const all = [...this.documents.values()].filter(doc => doc.path.slice(0, doc.path.lastIndexOf('/')) === collection)
      .sort((left, right) => left.path.localeCompare(right.path));
    const offset = Number(pageToken || 0);
    const documents = structuredClone(all.slice(offset, offset + pageSize));
    return { documents, ...(offset + documents.length < all.length ? { nextPageToken: String(offset + documents.length) } : {}) };
  }
  async query(collection, { field, op, value, orderBy, limit = 50 }) {
    return structuredClone([...this.documents.values()].filter(doc => doc.path.slice(0, doc.path.lastIndexOf('/')) === collection &&
      (op === 'LESS_THAN' ? doc.data[field] < value : doc.data[field] === value))
      .sort((left, right) => orderBy ? String(left.data[orderBy]).localeCompare(String(right.data[orderBy])) : left.path.localeCompare(right.path))
      .slice(0, limit));
  }
  async commit(writes) {
    if (this.beforeCommit) { const hook = this.beforeCommit; this.beforeCommit = undefined; await hook(writes); }
    if (this.failNextCommitBeforeApply) { this.failNextCommitBeforeApply = false; throw new FirestoreCommitUncertain(); }
    for (const write of writes) {
      const document = this.documents.get(write.path), condition = write.currentDocument;
      if (condition && ((condition.exists === false && document) || (condition.exists === true && !document) ||
        (condition.updateTime !== undefined && document?.updateTime !== condition.updateTime))) throw new FirestoreConflict();
    }
    const time = `2026-11-07T00:00:00.${String(++this.clock).padStart(9, '0')}Z`;
    for (const write of writes) {
      if (write.delete) this.documents.delete(write.path);
      else if (!write.verify) this.documents.set(write.path, { path: write.path, data: structuredClone(write.data), updateTime: time });
    }
    this.writes += writes.length;
    if (this.loseNextCommitResponse) { this.loseNextCommitResponse = false; throw new FirestoreCommitUncertain(); }
    return { commitTime: time, writeResults: writes.map(write => write.delete || write.verify ? {} : { updateTime: time }) };
  }
}
