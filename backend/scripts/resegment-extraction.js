#!/usr/bin/env node
// Rebuild a settled extraction's segments with the current segment builder (after a merge-rule fix).
// Dry run by default; --apply writes. Unchanged paragraphs keep their audio (clips are keyed by text hash).
//   node scripts/resegment-extraction.js <extractionId> [<extractionId> ...] [--apply]
const { resegment } = require('../src/services/extraction/extractionService');

(async () => {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const ids = args.filter((a) => a !== '--apply');
  if (!ids.length) {
    console.error('usage: node scripts/resegment-extraction.js <extractionId> [...] [--apply]');
    process.exit(1);
  }
  for (const id of ids) {
    const result = await resegment(id, { apply });
    console.log(`${apply ? 'applied' : 'dry run'} ${id}: ${result.before} -> ${result.after} segments, ${result.changed} new or changed, finalized through page ${result.finalized}`);
  }
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
