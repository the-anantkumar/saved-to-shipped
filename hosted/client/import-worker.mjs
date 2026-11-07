import { parseArchive, parseBackup } from './archive.mjs';
self.onmessage = async event => {
  try {
    const { bytes, filename, mode } = event.data;
    const result = await (mode === 'restore' ? parseBackup : parseArchive)(new Uint8Array(bytes), filename);
    self.postMessage({ ok: true, ...result });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'The archive could not be read.' });
  }
};
