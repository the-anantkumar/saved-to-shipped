import { Unzip, UnzipInflate, zipSync, strToU8 } from 'fflate';

export const ARCHIVE_LIMIT = 128 * 1024 * 1024;
export const CSV_LIMIT = 8 * 1024 * 1024;
export const BACKUP_LIMIT = 16 * 1024 * 1024;
export const ROW_LIMIT = 10_000;
const savedName = /^saved[\s_-]*items?(?:[\s_-]+\d+)?\.csv$/i;

export function selectedCSV(bytes, filename) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > ARCHIVE_LIMIT) throw new Error('Choose an archive smaller than 128 MiB.');
  if (/\.csv$/i.test(filename)) {
    if (bytes.byteLength > CSV_LIMIT) throw new Error('Saved Items CSV must be smaller than 8 MiB.');
    return bytes;
  }
  if (!/\.zip$/i.test(filename)) throw new Error('Choose a LinkedIn ZIP or Saved Items CSV.');
  return selectedMember(bytes, savedName, CSV_LIMIT, 'Saved Items CSV');
}

function selectedMember(bytes, pattern, limit, label) {
  let matches = 0, size = 0, complete = false, entries = 0;
  const chunks = [];
  const unzip = new Unzip(file => {
    if (++entries > 10_000) throw new Error('The archive contains too many files. Choose the data file directly.');
    const name = file.name.replaceAll('\\', '/').split('/').at(-1);
    if (!pattern.test(name)) return; // Unrelated entries are never decompressed.
    if (++matches !== 1) throw new Error(`The archive contains multiple ${label} files. Choose the data file directly.`);
    if (file.originalSize !== undefined && file.originalSize > limit) throw new Error(`${label} expands beyond ${limit / 1024 / 1024} MiB.`);
    file.ondata = (error, chunk, final) => {
      if (error) throw new Error(`The ${label} could not be read.`);
      size += chunk.byteLength;
      if (size > limit) throw new Error(`${label} expands beyond ${limit / 1024 / 1024} MiB.`);
      chunks.push(chunk); complete = final;
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // A small compressed chunk bounds each inflation burst in the dedicated worker.
  for (let offset = 0; offset < bytes.length; offset += 1024) unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  if (matches !== 1 || !complete) throw new Error(`No complete ${label} was found. Choose the data file directly.`);
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export function decodeCSV(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1252', { fatal: true }).decode(bytes); }
}

export function parseSavedCSV(text) {
  const matrix = []; let row = [], field = '', quoted = false, endedQuote = false;
  const cell = () => { row.push(field); field = ''; endedQuote = false; if (row.length > 128) throw new Error('The CSV has too many columns.'); };
  const line = () => { cell(); if (row.some(value => value.trim())) matrix.push(row); row = []; if (matrix.length > ROW_LIMIT + 1) throw new Error('The archive has more than 10,000 rows. Split the Saved Items CSV before importing.'); };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') { quoted = false; endedQuote = true; }
      else field += char;
    } else if (char === '"' && !field && !endedQuote) quoted = true;
    else if (char === '"') throw new Error('The CSV contains an invalid quoted field.');
    else if (char === ',') cell();
    else if (char === '\r' || char === '\n') { if (char === '\r' && text[index + 1] === '\n') index++; line(); }
    else { if (endedQuote && !/\s/.test(char)) throw new Error('The CSV contains an invalid quoted field.'); field += char; }
    if (field.length > 20_000) throw new Error('A CSV field is too long.');
  }
  if (quoted) throw new Error('The CSV has an unfinished quoted field.');
  if (field || row.length || endedQuote) line();
  if (!matrix.length) throw new Error('The Saved Items CSV is empty.');
  const headers = matrix.shift().map(value => value.replace(/^\uFEFF/, '').trim().toLowerCase().replaceAll(' ', '_'));
  const column = aliases => headers.findIndex(value => aliases.includes(value));
  const urlIndex = column(['url', 'saved_item_url', 'link', 'content_url', 'saveditem']);
  const dateIndex = column(['date_saved', 'saved_date', 'date', 'saved_at', 'createdtime']);
  if (urlIndex < 0) throw new Error('No saved-post URL column was found. Choose LinkedIn Saved Items CSV.');
  const rows = [];
  for (const values of matrix) {
    if (values.length > headers.length) throw new Error('A CSV row has more values than its header.');
    const url = values[urlIndex]?.trim(); if (!url) continue;
    if (url.length > 4000 || !/^https?:\/\//i.test(url)) throw new Error('A saved URL is invalid.');
    const host = new URL(url).hostname.toLowerCase();
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) throw new Error('This CSV contains a URL outside LinkedIn.');
    rows.push({ url, saved_at: dateIndex < 0 ? '' : (values[dateIndex] || '').trim().slice(0, 100), platform: 'linkedin' });
  }
  return rows;
}

export async function parseArchive(bytes, filename) {
  const csv = selectedCSV(bytes, filename);
  const hash = await crypto.subtle.digest('SHA-256', csv);
  const importId = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('').slice(0, 32);
  return { import_id: importId, rows: parseSavedCSV(decodeCSV(csv)) };
}

export async function parseBackup(bytes, filename) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > ARCHIVE_LIMIT) throw new Error('Choose a backup smaller than 128 MiB.');
  let json;
  if (/\.json$/i.test(filename)) json = bytes;
  else if (/\.zip$/i.test(filename)) json = selectedMember(bytes, /^backlog\.json$/i, BACKUP_LIMIT, 'backlog.json');
  else throw new Error('Choose a Save2Ship ZIP backup or backlog.json.');
  if (json.byteLength > BACKUP_LIMIT) throw new Error('The backup JSON must be smaller than 16 MiB.');
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json)); }
  catch { throw new Error('The backup is not valid UTF-8 JSON.'); }
  if (data?.version !== 1 || !Array.isArray(data.items) || data.items.length > 1000 || data.items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('Choose a version-1 Save2Ship backup with at most 1,000 saves.');
  if (data.projects !== undefined && (!Array.isArray(data.projects) || data.projects.length > 100)) throw new Error('The backup has too many sections.');
  const hash = await crypto.subtle.digest('SHA-256', json);
  const importId = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('').slice(0, 32);
  // Credentials, operational jobs and arbitrary backup settings never enter a restore request.
  const workspace = { version: 1, projects: data.projects || [], goals: data.goals || '', board_order: data.board_order || [] };
  return { import_id: `backup-${importId}`, rows: data.items, workspace };
}

export function restoreChunks(backup) {
  const byteSize = value => new TextEncoder().encode(JSON.stringify(value)).length;
  // Leave room for request_id, sequence and filename beneath the 256 KiB server limit.
  const max = 240_000, chunks = [{ rows: [], workspace: backup.workspace }];
  if (byteSize(chunks[0]) > max) throw new Error('The backup section metadata is too large.');
  for (const item of backup.rows) {
    let current = chunks.at(-1);
    if (current.rows.length >= 25 || byteSize({ ...current, rows: [...current.rows, item] }) > max) {
      current = { rows: [] }; chunks.push(current);
    }
    if (byteSize({ rows: [item] }) > max) throw new Error('One saved item exceeds the request limit.');
    current.rows.push(item);
  }
  return chunks;
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportZIP(workspace) {
  const fields = ['id', 'title', 'url', 'saved_at', 'kind', 'status', 'project_id', 'effort_hours', 'next_action', 'definition_of_done', 'outcome_url'];
  const csv = [fields.join(','), ...workspace.items.map(item => fields.map(field => csvCell(item[field])).join(','))].join('\r\n');
  return zipSync({
    'backlog.json': strToU8(JSON.stringify(workspace, null, 2)),
    'backlog.csv': strToU8(csv),
    'README.txt': strToU8('Your private Save2Ship backup. backlog.json uses the version-1 workspace format. Provider credentials are excluded. Keep this archive somewhere safe.\n'),
  }, { level: 1 });
}

export function syntheticZIP() {
  return zipSync({ 'Saved_Items.csv': strToU8('Date Saved,URL\n2026-11-01,https://www.linkedin.com/feed/update/urn:li:activity:900000000000000001\n2026-11-02,https://www.linkedin.com/feed/update/urn:li:activity:900000000000000002\n') });
}
