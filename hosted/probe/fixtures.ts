import type { PrototypeSave } from '../src/workspace';

// Fixed synthetic input only. No request, archive or provider content is used.
export function fixture(index: number, revision = 0): PrototypeSave {
  if (!Number.isInteger(index) || index < 0 || index >= 50) throw new Error('Fixture index out of range');
  const words = Array.from({ length: 180 }, (_, word) => `term${index}r${revision}v${word}`);
  return {
    id: `probe-save-${index.toString().padStart(2, '0')}`,
    platform: 'linkedin', url: `https://www.linkedin.com/feed/update/urn:li:activity:synthetic-probe-${index}`,
    title: `Synthetic probe ${index}, revision ${revision}`, author: `Synthetic author ${index % 5}`,
    saved_at: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
    kind: (['project', 'learning', 'experience'] as const)[index % 3]!,
    status: 'backlog', group_id: '', tags: ['synthetic', 'capacity-probe'],
    reading_progress: 0, next_action: 'Inspect the synthetic measurements.',
    why: 'This fixture measures storage without a personal archive.',
    content: words.join(' ') + ' प्रयोग 整理 café 🚀',
    note: `Synthetic note revision ${revision}. `.repeat(12),
  };
}

export function fixtureBatch(start: 0 | 25): PrototypeSave[] {
  return Array.from({ length: 25 }, (_, index) => fixture(start + index));
}
