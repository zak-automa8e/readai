const config = require('../../config');
const supabaseService = require('../supabaseService');
const llm = require('../llm');
const { PROMPT_VERSION } = require('../../config/prompts/extraction');
const pdfSource = require('./pdfSource');

// Shared by the extraction modules: the recipe, page ranges, and the extraction + book a job works on

function recipe() {
  return { promptVersion: PROMPT_VERSION, model: llm.extractionModel(), dpi: config.extraction.dpi };
}

function chunk(pages, size) {
  const out = [];
  for (let i = 0; i < pages.length; i += size) out.push(pages.slice(i, i + size));
  return out;
}

function range(first, last) {
  const out = [];
  for (let n = first; n <= last; n++) out.push(n);
  return out;
}

async function loadContext(extractionId) {
  const extraction = await supabaseService.getExtractionById(extractionId);
  if (!extraction || extraction.status === 'failed') return null;
  const book = await supabaseService.getBookById(extraction.source_book_id);
  return { extraction, book };
}

async function pdfPathFor({ extraction, book }) {
  return pdfSource.getPdfFile({ pdfUrl: book.pdf_url, contentSha256: extraction.content_sha256 });
}

module.exports = { recipe, chunk, range, loadContext, pdfPathFor };
