const READ_LIMIT = 50;
const MAX_ITEMS = 1000;
const ERROR_MESSAGES = {
  BETA_FULL: 'The beta is full. Existing members can still return. Please try again later.',
  MEMBERSHIP_REQUIRED: 'Your workspace session ended. Sign in again to continue.',
  MEMBERSHIP_SUSPENDED: 'This workspace is paused. Contact the beta operator.',
  ACCOUNT_DELETED: 'This workspace has been deleted.',
  QUOTA_EXCEEDED: 'Your workspace limit has been reached. Export your saves or free some space before adding more.',
  DAILY_BUDGET: 'Processing is paused for today. Your saved work is safe; try again after the daily limit resets.',
  REVISION_CONFLICT: 'This save changed in another tab. Your edits are still here. Reopen the save before applying them.',
  HOSTED_NOT_READY: 'The hosted beta is being prepared. Please return when admission opens.',
};

export class ClientError extends Error {
  constructor(message, code = 'REQUEST_FAILED', status = 0) { super(message); this.code = code; this.status = status; }
}

/** Browser-only identity and data cache. Credentials/capabilities never use localStorage. */
export class HostedTransport {
  constructor({ fetcher = (...args) => fetch(...args), getUser, uuid = () => crypto.randomUUID(), onReset = () => {} }) {
    this.fetcher = fetcher; this.getUser = getUser; this.uuid = uuid; this.onReset = onReset;
    this.controllers = new Set(); this.items = new Map(); this.details = new Set(); this.serial = new Map();
    this.epoch = 0; this.uid = null; this.capability = ''; this.expiresAt = 0; this.summary = null;
    this.loaded = false; this.listDirty = false; this.sessionPromise = null;
    this.libraryRevision = null; this.statePromise = null; this.mutations = 0;
  }

  reset(uid = null) {
    this.epoch++; this.uid = uid; this.capability = ''; this.expiresAt = 0;
    this.sessionPromise = null; this.summary = null; this.loaded = false; this.listDirty = false;
    this.libraryRevision = null; this.statePromise = null; this.mutations = 0;
    this.items.clear(); this.details.clear(); this.serial.clear();
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear(); this.onReset();
  }

  async user() {
    const user = this.getUser();
    if (!user) throw new ClientError('Sign in to open your workspace.', 'SIGN_IN_REQUIRED', 401);
    if (this.uid !== user.uid) this.reset(user.uid);
    return user;
  }

  async raw(path, { data, session = true, refreshToken = false, current = () => true } = {}) {
    if (!/^\/api\/[a-z0-9/-]+(?:\?[^#]*)?$/.test(path)) throw new ClientError('Invalid request path.');
    const user = await this.user(), epoch = this.epoch;
    const token = await user.getIdToken(refreshToken);
    if (epoch !== this.epoch || this.getUser()?.uid !== user.uid || !current()) throw new ClientError('Account changed. Please try again.', 'ACCOUNT_CHANGED');
    const controller = new AbortController(); this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await this.fetcher(path, {
        method: data === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error',
        keepalive: path === '/api/reading' && data !== undefined,
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, ...(session ? { 'X-Workspace-Session': this.capability } : {}),
          ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      if (epoch !== this.epoch || this.getUser()?.uid !== user.uid || !current()) throw new ClientError('Account changed. Please try again.', 'ACCOUNT_CHANGED');
      let result;
      try { result = await response.json(); }
      catch { throw new ClientError(data === undefined ? 'The server response could not be read.' : 'The response was lost. Check the current state before trying again.', 'UNCERTAIN_RESPONSE'); }
      if (epoch !== this.epoch || this.getUser()?.uid !== user.uid || !current()) throw new ClientError('Account changed. Please try again.', 'ACCOUNT_CHANGED');
      if (!response.ok || result?.ok === false) {
        const code = result.code || (typeof result.error === 'string' ? result.error : 'REQUEST_FAILED');
        throw new ClientError(ERROR_MESSAGES[code] || result.message || (result.code && typeof result.error === 'string' ? result.error : '') || 'This request could not be completed. Please try again.', code, response.status);
      }
      return result?.ok === true && Object.hasOwn(result, 'data') ? result.data : result;
    } catch (error) {
      if (error instanceof ClientError) throw error;
      throw new ClientError(data === undefined ? 'Could not connect. Please try again.' : 'The response was lost. Check your workspace before trying again. We have not repeated the request.', 'NETWORK_UNCERTAIN');
    } finally { clearTimeout(timer); this.controllers.delete(controller); }
  }

  async session(force = false) {
    await this.user();
    if (!force && this.capability && this.expiresAt > Date.now() + 15_000) return;
    if (this.sessionPromise) return this.sessionPromise;
    const epoch = this.epoch;
    const promise = (async () => {
      const result = await this.raw('/api/session', { session: false, refreshToken: force });
      if (epoch !== this.epoch) throw new ClientError('Account changed.', 'ACCOUNT_CHANGED');
      if (typeof result.workspace_session !== 'string' || result.membership?.uid !== this.uid) throw new ClientError('Could not verify the workspace session.');
      this.capability = result.workspace_session;
      this.expiresAt = typeof result.expires_at === 'number' ? (result.expires_at < 1e12 ? result.expires_at * 1000 : result.expires_at) : Date.parse(result.expires_at);
      if (!Number.isFinite(this.expiresAt)) this.expiresAt = Date.now() + 60_000;
      return result;
    })();
    this.sessionPromise = promise;
    try { return await promise; } finally { if (this.sessionPromise === promise) this.sessionPromise = null; }
  }

  async request(path, data) {
    await this.session();
    try { return await this.raw(path, { data }); }
    catch (error) {
      // Reads can renew once. Never automatically repeat a mutation or paid submission.
      if (data === undefined && (error.status === 401 || ['MEMBERSHIP_REQUIRED', 'SESSION_EXPIRED'].includes(error.code))) {
        await this.session(true); return this.raw(path);
      }
      throw error;
    }
  }

  remember(item, detail = false) {
    if (!item || typeof item.id !== 'string') return;
    const previous = this.items.get(item.id);
    const sameRevision = previous?.revision === item.revision && previous?.cache_revision === item.cache_revision;
    if (!sameRevision) this.details.delete(item.id);
    this.items.set(item.id, sameRevision ? { ...previous, ...item } : { ...item });
    if (detail || Object.hasOwn(item, 'content')) this.details.add(item.id);
  }
  hasDetail(id) { return this.details.has(id); }
  async detail(id, force = false) {
    await this.user();
    if (!force && this.hasDetail(id)) return this.items.get(id);
    const epoch = this.epoch;
    for (let attempt = 0; attempt < 2; attempt++) {
      const previous = this.items.get(id), revision = this.libraryRevision, mutations = this.mutations;
      const result = await this.request(`/api/item?id=${encodeURIComponent(id)}`);
      if (epoch !== this.epoch) throw new ClientError('Account changed.', 'ACCOUNT_CHANGED');
      if (previous && !this.items.has(id)) throw new ClientError('This save was removed. Return to your library.', 'NOT_FOUND', 404);
      if (previous !== this.items.get(id) || revision !== this.libraryRevision || mutations !== this.mutations) {
        if (!attempt) continue;
        throw new ClientError('This save changed while opening it. Please open it again.', 'REVISION_CONFLICT', 409);
      }
      const item = result.item || result;
      if (!previous || previous.revision !== item.revision || previous.cache_revision !== item.cache_revision) {
        // A detail can discover a remote edit ahead of metadata. Invalidate any
        // list read already in flight so it cannot install an older snapshot.
        this.mutations++; this.listDirty = true;
      }
      this.remember(item, true); return this.items.get(id);
    }
  }

  async loadState() {
    await this.user();
    if (this.statePromise) return this.statePromise;
    const epoch = this.epoch;
    const promise = (async () => {
      // Stage every page before touching the visible cache. Retry only reads when
      // a concurrent edit invalidates a cursor or overlaps this snapshot.
      for (let attempt = 0; attempt < 2; attempt++) {
        const mutations = this.mutations;
        try {
          const summary = await this.request('/api/state');
          if (epoch !== this.epoch) throw new ClientError('Account changed.', 'ACCOUNT_CHANGED');
          const revision = summary.library_revision ?? summary.revision;
          let staged = null;
          if (!this.loaded || this.listDirty || revision !== this.libraryRevision) {
            staged = new Map();
            const cursors = new Set(); let cursor = null;
            do {
              const page = await this.request(`/api/items?limit=${READ_LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
              if (epoch !== this.epoch) throw new ClientError('Account changed.', 'ACCOUNT_CHANGED');
              if (page.library_revision !== undefined && page.library_revision !== revision) throw new ClientError('The library changed while loading. Try again.', 'REVISION_CONFLICT');
              if (!Array.isArray(page.items) || page.items.length > READ_LIMIT) throw new ClientError('The library page was invalid.');
              for (const item of page.items) {
                if (typeof item.id !== 'string' || staged.has(item.id)) throw new ClientError('The library page was invalid.');
                staged.set(item.id, item);
              }
              if (staged.size > MAX_ITEMS) throw new ClientError('The library exceeds this beta’s limit.');
              cursor = page.next_cursor || null;
              if (cursor && cursors.has(cursor)) throw new ClientError('The library cursor did not advance.');
              cursors.add(cursor);
            } while (cursor);
          }
          if (mutations !== this.mutations) throw new ClientError('The library changed while loading. Try again.', 'REVISION_CONFLICT');
          if (staged) {
            for (const item of staged.values()) this.remember(item);
            for (const id of this.items.keys()) if (!staged.has(id)) { this.items.delete(id); this.details.delete(id); }
            this.loaded = true; this.listDirty = false; this.libraryRevision = revision;
          }
          this.summary = summary;
          return { version: 1, projects: [], imports: [], ...summary, items: [...this.items.values()] };
        } catch (error) {
          if (epoch !== this.epoch || error.code !== 'REVISION_CONFLICT' || attempt) throw error;
        }
      }
    })();
    this.statePromise = promise;
    try { return await promise; } finally { if (this.statePromise === promise) this.statePromise = null; }
  }

  async api(route, input, query = '') {
    await this.user();
    if (route === '/api/state') return this.loadState();
    if (input === undefined) return this.request(`${route}${query ? `?${query}` : ''}`);
    const epoch = this.epoch, uid = this.getUser()?.uid;
    const mutate = async () => {
      if (epoch !== this.epoch || uid !== this.getUser()?.uid) throw new ClientError('Account changed. Your request was not sent.', 'ACCOUNT_CHANGED');
      const data = { ...input, request_id: input.request_id || this.uuid() };
      if (['/api/item', '/api/move', '/api/reading', '/api/delete'].includes(route)) {
        const item = this.items.get(data.id) || await this.detail(data.id);
        data.expected_revision ??= item.revision;
      }
      const previousItem = this.items.get(data.id), previousLibrary = this.libraryRevision, previousMutations = this.mutations;
      let result;
      try { result = await this.request(route, data); }
      catch (error) {
        if (error.status === 409 && data.id) { this.details.delete(data.id); this.listDirty = true; }
        throw error;
      }
      if (epoch !== this.epoch || uid !== this.getUser()?.uid) throw new ClientError('Account changed.', 'ACCOUNT_CHANGED');
      const superseded = previousItem !== this.items.get(data.id) || previousLibrary !== this.libraryRevision || previousMutations !== this.mutations ||
        (this.libraryRevision !== null && result.library_revision < this.libraryRevision) ||
        (this.summary && result.workspace_revision < this.summary.revision);
      this.mutations++;
      if (superseded) {
        // The write succeeded, but another snapshot arrived while its response
        // was in flight. Keep that cache and reconcile with a read, never replay.
        this.listDirty = true; return { ...result, superseded: true };
      }
      if (result.item) this.remember(result.item, true);
      if (result.reading && data.id && this.items.has(data.id)) this.remember({ ...this.items.get(data.id), reading: result.reading, revision: result.revision ?? this.items.get(data.id).revision }, this.hasDetail(data.id));
      if (result.project && this.summary) this.summary.projects = [...(this.summary.projects || []).filter(p => p.id !== result.project.id), result.project];
      if (this.summary && result.workspace_revision !== undefined) this.summary.revision = result.workspace_revision;
      if (route === '/api/delete' && result.deleted) {
        // A replay can refer to a URL that has since been imported again. The
        // server returns that current item; the old receipt must not hide it.
        if (!result.item) { this.items.delete(data.id); this.details.delete(data.id); }
        if (result.replayed) this.listDirty = true;
      }
      // Advance only a complete, contiguous local edit. A revision gap includes
      // another browser's changes and requires a fresh metadata snapshot.
      if (this.loaded && !this.listDirty && !result.replayed && result.library_revision === this.libraryRevision + 1 &&
          (result.item || result.reading || (route === '/api/delete' && result.deleted))) this.libraryRevision = result.library_revision;
      if (['/api/import', '/api/restore', '/api/classify', '/api/triage'].includes(route)) this.listDirty = true;
      if (['/api/retrieve/poll', '/api/jobs/poll'].includes(route)) {
        const job = result.job || result;
        const previous = this.summary?.retrieval_jobs?.find(value => value.id === job.id);
        if (job.changed_ids?.length || Number(job.applied_count || 0) !== Number(previous?.applied_count || 0) || (job.status === 'COMPLETED' && previous?.status !== 'COMPLETED')) this.listDirty = true;
      }
      if (data.id && !result.item && !result.reading && ['/api/item', '/api/move'].includes(route)) await this.detail(data.id, true);
      return result;
    };
    // Serialize local edits to one item. Cross-tab conflicts still require a user decision.
    const key = typeof input.id === 'string' ? input.id : route;
    const previous = this.serial.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(mutate); this.serial.set(key, run);
    try { return await run; } finally { if (this.serial.get(key) === run) this.serial.delete(key); }
  }

  async exportWorkspace() {
    await this.user(); const epoch = this.epoch;
    const items = [], cursors = new Set(); let workspace = null, cursor = null, revision;
    do {
      const page = await this.request(`/api/export?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (epoch !== this.epoch) throw new ClientError('Account changed.', 'ACCOUNT_CHANGED');
      if (workspace === null) { workspace = page.workspace; revision = page.revision; }
      if (!workspace || page.revision !== revision) throw new ClientError('Your workspace changed during export. Start the export again.', 'REVISION_CONFLICT');
      if (!Array.isArray(page.items) || page.items.length > 25) throw new ClientError('Invalid export page.');
      items.push(...page.items); if (items.length > MAX_ITEMS) throw new ClientError('Export exceeds the beta limit.');
      cursor = page.next_cursor || null;
      if (cursor && cursors.has(cursor)) throw new ClientError('The export cursor did not advance.');
      cursors.add(cursor);
    } while (cursor);
    return { ...workspace, version: 1, items };
  }
}
