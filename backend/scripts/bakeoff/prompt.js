// Extraction prompt + response schema for the NEW pipeline (gemini-3.8-flash, block output).
const { Type } = require(require.resolve('@google/genai', { paths: [process.cwd()] }));

const ROLES = ['body', 'heading', 'running_header', 'footer', 'page_number', 'footnote', 'caption', 'other'];

const EXTRACTION_PROMPT = `You transcribe ONE scanned book page for a text-to-speech reading app. The app will read aloud only the body and heading blocks, so your job is to (1) copy the page text exactly and (2) label every piece of text with its role, so that running headers, page numbers, footnotes and footnote markers are never read aloud.

Return every piece of text on the page as an ordered list of blocks, in natural reading order: Arabic pages right-to-left and top-to-bottom; on a two-column page finish the right column before the left one.

TRANSCRIPTION RULES
- Copy the text exactly as printed. Do not correct, modernise, paraphrase, summarise, translate or complete anything. Keep the printed spelling, hamza forms, punctuation and numerals (Arabic-Indic digits stay Arabic-Indic, Latin digits stay Latin).
- Diacritics (tashkeel): keep every printed mark where it is printed. Never add a mark that is not on the page. Never drop a printed one.
- One block per paragraph. Join the printed lines of one paragraph into one string separated by single spaces; printed line breaks inside a paragraph mean nothing. A new paragraph starts at an indented first line or after vertical space.
- A quoted verse of poetry or a Quranic quotation inside the running text belongs to the body. Keep the ornamental brackets ﴿ ﴾ and the verse-number ornaments that are printed inside them.
- If a word is truly unreadable write [؟] in its place. Never guess whole phrases.

ROLES
- body: the main running text (prose paragraphs, quoted verses, list items of the main text).
- heading: a title that is part of this page's content flow (chapter or section title, «تمهيد», «الفصل الأول», «مقدمة», a centred sub-title before a paragraph). It is NOT repeated on every page.
- running_header: text in the top margin that repeats from page to page: the book title, the current chapter name, the author name, often above a horizontal rule. If that line also contains the page number, put the number in its own page_number block.
- footer: recurring bottom-margin text that is neither a footnote nor the page number (publisher, website, series name, watermark).
- page_number: the printed page number wherever it sits, including decorated forms such as «- ٧ -» or «(٧)» alone in a margin.
- footnote: a note in the lower area of the page, usually below a short rule, usually starting with a marker such as (١). One block per footnote; keep its leading marker in its text. A footnote that continues from the previous page is still a footnote.
- caption: a label for a figure, table or image.
- other: anything else (stamps, marginal notes, table cells, library seals).

FOOTNOTE REFERENCE MARKERS INSIDE BODY OR HEADING TEXT
- A reference marker is a small number or symbol in the running text that points to a footnote: (١) (٢) (1) ¹ ² [٣] * — often superscript or smaller than the text.
- Remove every reference marker from the block's text (do not leave a double space behind) and list it, exactly as printed, in that block's footnote_markers array, in order of appearance.
- Do NOT remove numbers that belong to the sentence: years, counts, dates, ordinals, chapter or verse references written as part of the sentence such as [البقرة: ٢٥٥]. If you are not sure a number is a reference marker, keep it in the text.

SENTENCE CONTINUITY FLAGS (body blocks only; always false for every other role)
- starts_mid_sentence: true only when the block begins in the middle of a sentence that began on the previous page. Signs: it is the first body block on the page, there is no heading above it, its first line is not indented, and its first words read as the continuation of a clause (for example the second half of a construct phrase, the object of a verb, a word right after a preposition, or a clause that cannot stand alone). A paragraph that begins a fresh sentence is false, even if it starts with و or ف.
- ends_mid_sentence: true only when the block stops before its sentence is finished: the last words are grammatically incomplete and there is no final punctuation (. ؟ ! : …). Typically only the last body block on the page, when the sentence continues on the next page.

Return only JSON that matches the schema.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    blocks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          role: { type: Type.STRING, enum: ROLES },
          text: { type: Type.STRING },
          footnote_markers: { type: Type.ARRAY, items: { type: Type.STRING } },
          starts_mid_sentence: { type: Type.BOOLEAN },
          ends_mid_sentence: { type: Type.BOOLEAN },
        },
        required: ['role', 'text', 'footnote_markers', 'starts_mid_sentence', 'ends_mid_sentence'],
        propertyOrdering: ['role', 'text', 'footnote_markers', 'starts_mid_sentence', 'ends_mid_sentence'],
      },
    },
  },
  required: ['blocks'],
};

module.exports = { ROLES, EXTRACTION_PROMPT, RESPONSE_SCHEMA };
