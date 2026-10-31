#!/usr/bin/env node
// Rebuild a settled extraction's segments with the current segment builder (after a merge-rule fix,
// or to move older extractions to page-anchored seqs). Dry run by default; --apply writes.
// Unchanged paragraphs keep their audio (clips are keyed by text hash). A running extraction is skipped.
//   node scripts/resegment-extraction.js <extractionId> [<extractionId> ...] [--apply]
//   node scripts/resegment-extraction.js --all [--apply]      every extraction that is not failed
const supabaseService = require('../src/services/supabaseService');
const { resegment } = require('../src/services/extraction/extractionService');

async function allExtractionIds() {
  const { data, error } = await supabaseService.adminClient
    .from('book_extractions')
    .select('id')
    .neq('status', 'failed')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data.map((row) => row.id);
}

(async () => {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const ids = args.includes('--all') ? await allExtractionIds() : args.filter((a) => !a.startsWith('--'));
  if (!ids.length) {
    console.error('usage: node scripts/resegment-extraction.js (<extractionId> [...] | --all) [--apply]');
    process.exit(1);
  }
  for (const id of ids) {
    try {
      const result = await resegment(id, { apply });
      console.log(`${apply ? 'applied' : 'dry run'} ${id}: ${result.before} -> ${result.after} segments, ${result.changed} new or changed, runs ${JSON.stringify(result.runs)}`);
    } catch (error) {
      console.log(`skipped ${id}: ${error.message}`);
    }
  }
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
