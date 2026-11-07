import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { selectedCSV, parseSavedCSV, parseArchive, parseBackup, restoreChunks, CSV_LIMIT, BACKUP_LIMIT, exportZIP } from '../client/archive.mjs';
import { HostedTransport } from '../client/transport.mjs';

const csv = 'Date Saved,URL\n2026-11-01,https://www.linkedin.com/feed/update/urn:li:activity:900000000000000001\n';
test('browser import selects exactly one Saved Items file and preserves quoted CSV semantics', async () => {
  const archive = zipSync({ 'nested/Saved_Items.csv': strToU8(csv), 'Connections.csv': strToU8('private unrelated data') });
  const parsed = await parseArchive(archive, 'archive.zip');
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].saved_at, '2026-11-01');
  assert.equal(parsed.import_id, (await parseArchive(strToU8(csv), 'Saved_Items.csv')).import_id);
  assert.deepEqual(parseSavedCSV('URL,Date Saved,Description\r\n"https://linkedin.com/posts/example?x=a,b",2026-11-01,"line one\nline ""two"""\r\n'), [
    { url: 'https://linkedin.com/posts/example?x=a,b', saved_at: '2026-11-01', platform: 'linkedin' },
  ]);
  assert.throws(() => selectedCSV(zipSync({ 'Saved Items.csv': strToU8(csv), 'nested/Saved_Items_2.csv': strToU8(csv) }), 'archive.zip'), /multiple/);
  assert.throws(() => selectedCSV(zipSync({ 'Connections.csv': strToU8(csv) }), 'archive.zip'), /No complete/);
});

test('browser import rejects oversized output, invalid quoting, excess columns and foreign URLs', () => {
  assert.throws(() => selectedCSV(new Uint8Array(CSV_LIMIT + 1), 'Saved_Items.csv'), /8 MiB/);
  const bomb = zipSync({ 'Saved_Items.csv': new Uint8Array(CSV_LIMIT + 1) });
  assert.throws(() => selectedCSV(bomb, 'archive.zip'), /8 MiB/);
  // Spoof the local uncompressed length; actual decompression remains bounded.
  new DataView(bomb.buffer).setUint32(22, 1, true);
  assert.throws(() => selectedCSV(bomb, 'archive.zip'), /8 MiB|could not|invalid/i);
  assert.throws(() => parseSavedCSV('URL\n"unfinished'), /unfinished/);
  assert.throws(() => parseSavedCSV('URL\nhttps://linkedin.com/posts/test,extra'), /more values/);
  assert.throws(() => parseSavedCSV('URL\nhttps://evil.example/posts/test'), /outside LinkedIn/);
});

test('exports remain version-1 JSON and escape spreadsheet formulas', () => {
  const workspace = { version: 1, projects: [], imports: [], items: [{ id: 'one', title: '=BAD()', url: 'https://linkedin.com/posts/example', note: 'my note' }] };
  const entries = unzipSync(exportZIP(workspace));
  assert.deepEqual(JSON.parse(strFromU8(entries['backlog.json'])), workspace);
  assert.match(strFromU8(entries['backlog.csv']), /'=BAD\(\)/);
  assert.deepEqual(Object.keys(entries).sort(), ['README.txt', 'backlog.csv', 'backlog.json']);
});

test('backup restore preserves annotations, selects only backlog JSON and bounds requests by bytes', async () => {
  const workspace = { version: 1, projects: [{ id: 'group', name: 'Reading' }], goals: 'Learn', board_order: ['one'], settings: { secret: 'never send' }, items: Array.from({ length: 30 }, (_, index) => ({ id: String(index), url: 'https://linkedin.com/posts/example', note: '🙂'.repeat(20_000), reading: { progress: 42, status: 'reading', queued: true } })) };
  const backup = await parseBackup(exportZIP(workspace), 'backup.zip');
  assert.deepEqual(backup.rows, workspace.items);
  assert.deepEqual(backup.workspace, { version: 1, projects: workspace.projects, goals: 'Learn', board_order: ['one'] });
  const chunks = restoreChunks(backup);
  assert.ok(chunks.length > 1); assert.equal(chunks.flatMap(chunk => chunk.rows).length, 30);
  assert.ok(chunks.every(chunk => new TextEncoder().encode(JSON.stringify(chunk)).length <= 240_000 && chunk.rows.length <= 25));
  assert.ok(chunks.slice(1).every(chunk => !Object.hasOwn(chunk, 'workspace')));
  await assert.rejects(parseBackup(zipSync({ 'backlog.json': strToU8('{"version":2,"items":[]}') }), 'backup.zip'), /version-1/);
  await assert.rejects(parseBackup(new Uint8Array(BACKUP_LIMIT + 1), 'backlog.json'), /16 MiB/);
});

function fixture(handler) {
  const calls = []; let current = { uid: 'alice', getIdToken: async force => force ? 'renewed-alice' : 'alice-token' };
  const client = new HostedTransport({ getUser: () => current, uuid: () => 'request-fixed', fetcher: async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/session') return Response.json({ membership: { uid: current.uid }, workspace_session: 'member-capability', expires_at: Date.now() + 60_000 });
    return handler(url, options, calls);
  } });
  return { client, calls, changeUser(user) { current = user; client.reset(user?.uid || null); } };
}

test('hosted transport loads metadata pages and hydrates a body only when opened', async () => {
  let detailCalls = 0;
  const { client, calls } = fixture(async url => {
    if (url === '/api/state') return Response.json({ revision: 1, projects: [], imports: [], usage: { items: 2 } });
    if (url === '/api/items?limit=50') return Response.json({ items: [{ id: 'one', revision: 1, title: 'One' }], next_cursor: 'next' });
    if (url === '/api/items?limit=50&cursor=next') return Response.json({ items: [{ id: 'two', revision: 1, title: 'Two' }], next_cursor: null });
    if (url === '/api/item?id=one') { detailCalls++; return Response.json({ id: 'one', revision: 1, title: 'One', content: 'source', note: 'private' }); }
    throw new Error(url);
  });
  assert.equal((await client.loadState()).items.length, 2); assert.equal(detailCalls, 0);
  assert.equal((await client.detail('one')).note, 'private'); await client.detail('one'); assert.equal(detailCalls, 1);
  await client.loadState(); assert.equal(calls.filter(call => call.url.startsWith('/api/items')).length, 2);
  assert.ok(calls.every(call => !call.url.includes('token') && !call.url.includes('workspace=')));
  assert.equal(calls.at(-1).options.headers['X-Workspace-Session'], 'member-capability');
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer alice-token');
});

test('mutations carry revisions and never retry an uncertain request', async () => {
  let attempts = 0;
  const { client, calls } = fixture(async (url, options) => {
    if (url === '/api/item') { attempts++; assert.equal(JSON.parse(options.body).expected_revision, 7); throw new Error('network'); }
    throw new Error(url);
  });
  client.remember({ id: 'one', revision: 7, content: 'source', note: 'before' }, true);
  // Establish identity before caching, mirroring the actual session bootstrap.
  await client.session(); client.remember({ id: 'one', revision: 7, content: 'source', note: 'before' }, true);
  await assert.rejects(client.api('/api/item', { id: 'one', note: 'after' }), /not repeated/);
  assert.equal(attempts, 1);
  assert.equal(JSON.parse(calls.at(-1).options.body).request_id, 'request-fixed');
});

test('account switch aborts pending reads and discards their private response', async () => {
  let finish;
  const { client, changeUser } = fixture(async () => new Promise(resolve => { finish = resolve; }));
  await client.session();
  const pending = client.detail('private-item');
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  changeUser({ uid: 'bob', getIdToken: async () => 'bob-token' });
  finish(Response.json({ id: 'private-item', revision: 1, content: 'alice private content' }));
  await assert.rejects(pending, /Account changed/);
  assert.equal(client.items.size, 0); assert.equal(client.capability, '');
});

test('queued edits from an old account never run under the next account', async () => {
  let finish, writes = 0;
  const { client, changeUser } = fixture(async url => {
    assert.equal(url, '/api/item'); writes++;
    return new Promise(resolve => { finish = resolve; });
  });
  await client.session(); client.remember({ id: 'shared-url-id', revision: 1, content: 'source', note: '' }, true);
  const first = client.api('/api/item', { id: 'shared-url-id', note: 'first' });
  const second = client.api('/api/item', { id: 'shared-url-id', note: 'old account queued note' });
  const results = Promise.allSettled([first, second]);
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  changeUser({ uid: 'bob', getIdToken: async () => 'bob-token' });
  finish(Response.json({ item: { id: 'shared-url-id', revision: 2, note: 'first' } }));
  assert.ok((await results).every(result => result.status === 'rejected'));
  assert.equal(writes, 1); assert.equal(client.items.size, 0);
});

test('a rejected authenticated read renews once without repeating a mutation', async () => {
  let reads = 0;
  const { client, calls } = fixture(async url => {
    assert.equal(url, '/api/state'); reads++;
    return reads === 1 ? Response.json({ code: 'TOKEN_EXPIRED' }, { status: 401 }) : Response.json({ revision: 1 });
  });
  assert.deepEqual(await client.request('/api/state'), { revision: 1 });
  assert.equal(reads, 2);
  assert.equal(calls.filter(call => call.url === '/api/session').length, 2);
});

test('conflicts preserve edits, invalidate stale details and normal polling does not reload item pages', async () => {
  const { client, calls } = fixture(async url => {
    if (url === '/api/state') return Response.json({ revision: 1, retrieval_jobs: [{ id: 'job', status: 'RUNNING', applied_count: 0 }] });
    if (url.startsWith('/api/items')) return Response.json({ items: [{ id: 'one', revision: 1 }], next_cursor: null });
    if (url === '/api/jobs/poll') return Response.json({ id: 'job', status: 'RUNNING', applied_count: 0 });
    if (url === '/api/item') return Response.json({ code: 'REVISION_CONFLICT' }, { status: 409 });
    throw new Error(url);
  });
  await client.loadState(); client.remember({ id: 'one', revision: 1, content: 'source', note: 'original' }, true);
  await client.api('/api/jobs/poll', {}); await client.loadState();
  assert.equal(calls.filter(call => call.url.startsWith('/api/items')).length, 1);
  const input = { id: 'one', expected_revision: 1, note: 'unsaved user draft' };
  await assert.rejects(client.api('/api/item', input), /edits are still here/);
  assert.equal(input.note, 'unsaved user draft'); assert.equal(client.hasDetail('one'), false);
});

test('metadata refresh discovers remote changes but job-only revisions retain the cache', async () => {
  let library = 1, revision = 1, rows = [{ id: 'one', revision: 1, title: 'Original' }];
  const { client, calls } = fixture(async url => {
    if (url === '/api/state') return Response.json({ revision, library_revision: library });
    if (url.startsWith('/api/items')) return Response.json({ items: rows, library_revision: library });
    throw new Error(url);
  });
  await client.loadState();
  client.remember({ ...rows[0], note: 'private detail' }, true);
  revision++;
  await client.loadState();
  assert.equal(calls.filter(c => c.url.startsWith('/api/items')).length, 1);
  library++; revision++; rows = [{ id: 'two', revision: 1, title: 'Remote addition' }];
  const updated = await client.loadState();
  assert.deepEqual(updated.items.map(i => i.id), ['two']);
  assert.equal(client.hasDetail('one'), false);
});

test('failed pagination never exposes a partial library and snapshot conflicts retry reads once', async () => {
  let library = 1, stage = 'initial', pages = 0;
  const { client } = fixture(async url => {
    if (url === '/api/state') return Response.json({ revision: library, library_revision: library });
    if (url === '/api/items?limit=50') {
      pages++;
      return Response.json({ items: [{ id: stage === 'initial' ? 'old' : 'new', revision: 1 }], library_revision: library, next_cursor: stage === 'initial' ? null : 'next' });
    }
    if (url.includes('cursor=next')) {
      if (stage === 'fail') throw new Error('offline');
      if (stage === 'conflict') { stage = 'fixed'; library++; return Response.json({ code: 'REVISION_CONFLICT' }, { status: 409 }); }
      return Response.json({ items: [{ id: 'last', revision: 1 }], library_revision: library });
    }
    throw new Error(url);
  });
  await client.loadState();
  library++; stage = 'fail';
  await assert.rejects(client.loadState(), /connect/);
  assert.deepEqual([...client.items.keys()], ['old']);
  assert.equal(client.libraryRevision, 1);
  stage = 'conflict'; pages = 0;
  const state = await client.loadState();
  assert.deepEqual(state.items.map(i => i.id), ['new', 'last']);
  assert.equal(pages, 2);
});

test('local mutation revision gaps do not conceal another browser edit', async () => {
  let library = 1;
  const { client, calls } = fixture(async url => {
    if (url === '/api/state') return Response.json({ revision: library, library_revision: library });
    if (url.startsWith('/api/items')) return Response.json({ library_revision: library, items: [{ id: 'one', revision: library }, ...(library === 3 ? [{ id: 'remote', revision: 1 }] : [])] });
    if (url === '/api/reading') { library = 3; return Response.json({ item: { id: 'one', revision: 3, reading: { progress: 42 } }, library_revision: 3 }); }
    throw new Error(url);
  });
  await client.loadState();
  await client.api('/api/reading', { id: 'one', progress: 42 });
  assert.equal(calls.find(c => c.url === '/api/reading').options.keepalive, true);
  assert.equal(client.libraryRevision, 1);
  assert.deepEqual((await client.loadState()).items.map(i => i.id), ['one', 'remote']);
});

test('a local mutation overlapping pagination cannot be overwritten by the stale snapshot', async () => {
  let library = 1, resolvePage, held = false;
  const { client } = fixture(async url => {
    if (url === '/api/state') return Response.json({ library_revision: library });
    if (url.startsWith('/api/items')) {
      if (!held) { held = true; return new Promise(resolve => { resolvePage = resolve; }); }
      return Response.json({ library_revision: library, items: [{ id: 'one', revision: 2, title: 'Saved edit' }] });
    }
    if (url === '/api/item') { library = 2; return Response.json({ library_revision: library, item: { id: 'one', revision: 2, title: 'Saved edit' } }); }
    throw new Error(url);
  });
  await client.session(); client.remember({ id: 'one', revision: 1, title: 'Original' });
  const loading = client.loadState();
  while (!resolvePage) await new Promise(resolve => setTimeout(resolve, 0));
  await client.api('/api/item', { id: 'one', title: 'Saved edit' });
  resolvePage(Response.json({ library_revision: 1, items: [{ id: 'one', revision: 1, title: 'Stale' }] }));
  assert.equal((await loading).items[0].title, 'Saved edit');
});

test('an idempotent receipt replay does not hide a remote addition behind its current revision', async () => {
  let library = 1;
  const { client } = fixture(async url => {
    if (url === '/api/state') return Response.json({ library_revision: library });
    if (url.startsWith('/api/items')) return Response.json({ library_revision: library, items: [{ id: 'one', revision: 1 }, ...(library === 2 ? [{ id: 'remote', revision: 1 }] : [])] });
    if (url === '/api/item') { library = 2; return Response.json({ replayed: true, library_revision: 2, item: { id: 'one', revision: 1, note: 'Earlier saved note' } }); }
    throw new Error(url);
  });
  await client.loadState();
  await client.api('/api/item', { id: 'one', note: 'Earlier saved note', request_id: 'already-applied' });
  assert.equal(client.libraryRevision, 1);
  assert.deepEqual((await client.loadState()).items.map(i => i.id), ['one', 'remote']);
});

test('slow detail reads cannot overwrite a newer metadata snapshot or resurrect a removed save', async () => {
  let library = 1, rows = [{ id: 'one', revision: 1 }], finish, detailReads = 0;
  const { client } = fixture(async url => {
    if (url === '/api/state') return Response.json({ library_revision: library });
    if (url.startsWith('/api/items')) return Response.json({ library_revision: library, items: rows });
    if (url === '/api/item?id=one') {
      detailReads++;
      if (detailReads === 1 || detailReads === 3) return new Promise(resolve => { finish = resolve; });
      return Response.json({ id: 'one', revision: 2, content: 'Current source' });
    }
    throw new Error(url);
  });
  await client.loadState();
  let pending = client.detail('one');
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  library = 2; rows = [{ id: 'one', revision: 2 }]; await client.loadState();
  finish(Response.json({ id: 'one', revision: 1, content: 'Stale source' }));
  assert.equal((await pending).content, 'Current source'); assert.equal(detailReads, 2);
  finish = null; pending = client.detail('one', true);
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  library = 3; rows = []; await client.loadState();
  finish(Response.json({ id: 'one', revision: 2, content: 'Deleted source' }));
  await assert.rejects(pending, error => error.code === 'NOT_FOUND');
  assert.deepEqual((await client.loadState()).items, []);
});

test('same URL reincarnation discards old hydrated notes even when numeric revisions match', async () => {
  let library = 1, incarnation = 'original';
  const { client } = fixture(async url => {
    if (url === '/api/state') return Response.json({ library_revision: library });
    if (url.startsWith('/api/items')) return Response.json({ library_revision: library, items: [{ id: 'one', revision: 1, cache_revision: incarnation }] });
    if (url === '/api/item?id=one') return Response.json({ id: 'one', revision: 1, cache_revision: incarnation, note: 'Old annotation' });
    throw new Error(url);
  });
  await client.loadState(); await client.detail('one');
  library = 3; incarnation = 'reimported';
  const current = await client.loadState();
  assert.equal(current.items[0].note, undefined); assert.equal(client.hasDetail('one'), false);
});

test('deletion receipt replay preserves a currently reimported item', async () => {
  const current = { id: 'one', revision: 1, cache_revision: 'new-instance', note: 'New note' };
  const { client } = fixture(async url => {
    if (url === '/api/state') return Response.json({ library_revision: 3 });
    if (url.startsWith('/api/items')) return Response.json({ library_revision: 3, items: [current] });
    if (url === '/api/delete') return Response.json({ deleted: true, replayed: true, library_revision: 3, item: current });
    throw new Error(url);
  });
  await client.loadState();
  await client.api('/api/delete', { id: 'one', request_id: 'old-delete' });
  assert.equal(client.items.get('one').note, 'New note');
  assert.deepEqual((await client.loadState()).items, [current]);
});

test('a late committed mutation response cannot replace a newer remote snapshot', async () => {
  let library = 1, finish;
  const { client } = fixture(async url => {
    if (url === '/api/state') return Response.json({ library_revision: library });
    if (url.startsWith('/api/items')) return Response.json({ library_revision: library, items: [{ id: 'one', revision: library, title: library === 3 ? 'Newer remote edit' : 'Original' }] });
    if (url === '/api/item') return new Promise(resolve => { finish = resolve; });
    throw new Error(url);
  });
  await client.loadState();
  const mutation = client.api('/api/item', { id: 'one', title: 'Earlier committed edit' });
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  library = 3; await client.loadState();
  finish(Response.json({ item: { id: 'one', revision: 2, title: 'Earlier committed edit' }, library_revision: 2 }));
  assert.equal((await mutation).superseded, true);
  assert.equal(client.items.get('one').title, 'Newer remote edit');
  assert.equal((await client.loadState()).items[0].title, 'Newer remote edit');
});
