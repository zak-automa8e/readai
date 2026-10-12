// Builds readai/bakeoff-output/index.html from data/bakeoff.json. No network, no spend.
// Run from readai/backend:  node scripts/bakeoff/build-html.js
const path = require('path');
const fs = require('fs');

const OUT = path.resolve(process.cwd(), '..', 'bakeoff-output');
const data = JSON.parse(fs.readFileSync(path.join(OUT, 'data', 'bakeoff.json'), 'utf8'));
const calls = JSON.parse(fs.readFileSync(path.join(OUT, 'data', 'calls.json'), 'utf8'));
const obsFile = path.join(__dirname, 'observations.json');
const observations = fs.existsSync(obsFile) ? JSON.parse(fs.readFileSync(obsFile, 'utf8')) : [];

const payload = JSON.stringify({ ...data, calls, observations }).replace(/</g, '\\u003c');

const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ReadAI Bake-off</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#F7F4EE; --ink:#1C1A17; --ink-2:#5B554C; --ink-3:#8C857A; --line:#E4DED3; --card:#FCFAF6;
  --accent:#8A3B12; --accent-soft:#F1E4DA; --skip:#A39C90; --mark:#F3E2C4;
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:24px; --sp-6:32px; --sp-7:48px;
  --sans:"IBM Plex Sans Arabic", system-ui, sans-serif; --serif:"Amiri", "IBM Plex Sans Arabic", serif;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 var(--sans)}
.wrap{max-width:1360px;margin:0 auto;padding:var(--sp-6) var(--sp-4) var(--sp-7)}
h1{font:600 28px/1.25 var(--sans);margin:0 0 var(--sp-2)}
h2{font:600 21px/1.3 var(--sans);margin:var(--sp-7) 0 var(--sp-3);padding-bottom:var(--sp-2);border-bottom:1px solid var(--line)}
h3{font:600 16px/1.4 var(--sans);margin:var(--sp-5) 0 var(--sp-3)}
.en{direction:ltr;unicode-bidi:isolate}
.muted{color:var(--ink-2)} .small{font-size:13px}
.bar{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line)}
.bar .wrap{padding:var(--sp-3) var(--sp-4);display:flex;gap:var(--sp-3);align-items:center;flex-wrap:wrap}
.bar nav{display:flex;gap:var(--sp-4);flex-wrap:wrap;flex:1}
.bar a{color:var(--ink);text-decoration:none;border-bottom:1px solid transparent}
.bar a:hover{border-color:var(--accent)}
button{font:500 14px var(--sans);background:var(--card);color:var(--ink);border:1px solid var(--ink);padding:6px 14px;border-radius:4px;cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);margin:var(--sp-4) 0}
.stat{background:var(--card);padding:var(--sp-4)}
.stat b{display:block;font:600 24px/1.2 var(--sans)}
.stat span{color:var(--ink-2);font-size:13px}
table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line);font-size:14px}
th,td{padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--line);text-align:start;vertical-align:top}
th{font-weight:600;color:var(--ink-2);font-size:13px}
td.num{font-variant-numeric:tabular-nums;direction:ltr;text-align:end;white-space:nowrap}
.scroll{overflow-x:auto}
.ar{font-family:var(--serif);font-size:19px;line-height:1.9}
.page{display:grid;grid-template-columns:minmax(200px,260px) 1fr 1fr;gap:var(--sp-4);background:var(--card);border:1px solid var(--line);padding:var(--sp-4);margin-bottom:var(--sp-4)}
@media (max-width:980px){.page{grid-template-columns:1fr}}
.col h4{margin:0 0 var(--sp-2);font:600 13px var(--sans);color:var(--ink-2);letter-spacing:.02em}
.thumb{width:100%;border:1px solid var(--line);cursor:zoom-in;display:block;background:#fff}
.zone{margin-bottom:var(--sp-3)}
.zone .lbl{font:500 12px var(--sans);color:var(--ink-3)}
.blk{border-top:1px solid var(--line);padding:var(--sp-2) 0}
.blk:first-of-type{border-top:0}
.role{display:inline-block;font:500 12px var(--sans);padding:1px 8px;border:1px solid var(--ink-3);border-radius:10px;margin-inline-end:var(--sp-2);direction:ltr}
.role.spoken{border-color:var(--accent);color:var(--accent)}
.blk.skip .txt{color:var(--skip);text-decoration:line-through;text-decoration-color:var(--skip)}
.blk.skip .role{color:var(--skip);border-color:var(--line)}
.chip{display:inline-block;font:12px var(--sans);padding:0 6px;border:1px dashed var(--skip);color:var(--skip);text-decoration:line-through;margin-inline-start:4px;border-radius:3px}
.flag{font:12px var(--sans);color:var(--accent);margin-inline-start:var(--sp-2)}
audio{width:100%;margin:var(--sp-2) 0;height:36px}
.badge{display:inline-block;font:500 12px var(--sans);padding:1px 8px;border-radius:10px;background:var(--line);color:var(--ink);margin-inline-end:4px;direction:ltr}
.badge.merge{background:var(--accent);color:#fff}
.seg{background:var(--card);border:1px solid var(--line);padding:var(--sp-4);margin-bottom:var(--sp-3)}
.seg.playing{border-color:var(--accent)}
.sent{border-radius:3px;transition:background .15s}
.sent.on{background:var(--mark)}
.sent + .sent{margin-inline-start:.25em}
.score{border-top:1px solid var(--line);margin-top:var(--sp-3);padding-top:var(--sp-3);display:grid;gap:var(--sp-2);font-size:13px}
.score .row{display:flex;gap:var(--sp-3);align-items:center;flex-wrap:wrap}
.score .row > span:first-child{min-width:130px;color:var(--ink-2)}
.score label{display:inline-flex;gap:3px;align-items:center;cursor:pointer}
.score textarea{width:100%;min-height:44px;font:14px var(--sans);border:1px solid var(--line);background:#fff;padding:var(--sp-2);border-radius:3px}
.note{background:var(--accent-soft);padding:var(--sp-3) var(--sp-4);border-radius:4px;margin:var(--sp-3) 0}
ul.obs{padding-inline-start:20px} ul.obs li{margin-bottom:var(--sp-2)}
pre{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);padding:var(--sp-4);font:13px/1.5 ui-monospace,Consolas,monospace;direction:ltr;text-align:left;max-height:480px;overflow:auto}
details summary{cursor:pointer;font-weight:500;margin:var(--sp-3) 0}
dialog{border:0;padding:0;background:transparent;max-width:96vw;max-height:96vh}
dialog::backdrop{background:rgba(28,26,23,.82)}
dialog img{max-width:94vw;max-height:92vh;display:block;background:#fff}
.tail{color:var(--ink-2)} .sep{color:var(--accent);font-weight:600;padding:0 6px}
.yes{color:var(--accent);font-weight:600} .no{color:var(--ink-3)}
</style>
</head>
<body>
<div class="bar"><div class="wrap">
  <nav id="nav" class="en"></nav>
  <button class="primary en" id="export">Export scores (JSON)</button>
  <span class="small muted en" id="savedState"></span>
</div></div>
<main class="wrap" id="app"></main>
<dialog id="lightbox"><img alt="Page image"></dialog>
<script id="payload" type="application/json">${payload}</script>
<script>
(function(){
const D = JSON.parse(document.getElementById('payload').textContent);
const S = D.summary;
const SPOKEN = new Set(['body','heading']);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const usd = (n, d=4) => n == null ? '–' : '$' + Number(n).toFixed(d);
const sec = n => n == null ? '–' : Number(n).toFixed(1) + ' s';
const ms = n => n == null ? '–' : (n/1000).toFixed(1) + ' s';
const STORE = 'readai-bakeoff-scores-v1';
let scores = {};
try { scores = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { scores = {}; }
function save(){ try { localStorage.setItem(STORE, JSON.stringify(scores)); setSaved('Saved in this browser'); } catch (e) { setSaved('Browser storage unavailable: export before closing'); } }
function setSaved(t){ document.getElementById('savedState').textContent = t; }

function scoreForm(id, scope){
  const crit = [['text','Text accuracy'],['audio','Audio naturalness'],['structure', scope==='segment' ? 'Structure / merge correct' : 'Structure correct']];
  const cur = scores[id] || {};
  return '<div class="score en" data-score="'+esc(id)+'">' + crit.map(([k,l]) =>
    '<div class="row"><span>'+l+'</span>' + [1,2,3,4,5].map(v =>
      '<label><input type="radio" name="'+esc(id)+'-'+k+'" value="'+v+'" data-k="'+k+'"'+(cur[k]==v?' checked':'')+'>'+v+'</label>').join('') + '</div>').join('') +
    '<textarea placeholder="Notes" data-k="notes">'+esc(cur.notes||'')+'</textarea></div>';
}

function summary(){
  const p = S.per1kPages, h = S.perAudioHour, t = S.tokens, l = S.latency;
  const delta = (o,n) => o ? ((n-o)/o*100).toFixed(0) + '%' : '–';
  return '<section id="summary" class="en"><h1>ReadAI extraction + TTS bake-off</h1>' +
  '<p class="muted">Generated '+esc(S.generatedAt.replace('T',' ').slice(0,16))+' UTC. New pipeline: <b>'+esc(S.models.extract)+'</b> (thinking '+esc(S.models.thinkingLevel)+', temperature 0, block schema) + <b>'+esc(S.models.tts)+'</b> per paragraph segment. Old pipeline: cached Supabase text and audio (gemini-2.5-flash-preview-09-2025 + gemini-2.5-flash-preview-tts).</p>' +
  '<div class="stats">' +
    stat(S.pages,'pages (3 books x 4 consecutive)') + stat(S.segments,'new paragraph segments') +
    stat(S.merges,'cross-page merges (new)') + stat(S.oldBreaks,'sentences broken at a page edge (old)') +
    stat(usd(S.spendUsd,3),'list-price value of all calls (key is free tier: billed $0)') + stat(S.ttsDone+' / '+S.segments,'segments with new audio') +
  '</div>' +
  (S.ttsPending.length ? '<div class="note"><b>New audio is incomplete.</b> The Gemini key is on the free tier, and '+esc(S.models.tts)+' allows 10 requests per day per model ('+esc(S.ttsDailyCap)+'). '+S.ttsPending.length+' segments are pending. Re-run <code>node scripts/bakeoff/run.js</code> from readai/backend after the quota resets (or on a paid tier). Finished calls are cached, so nothing is paid twice.</div>' : '') +
  '<h3>Cost estimate (USD)</h3><div class="scroll"><table><thead><tr><th>Line</th><th>Old</th><th>New</th><th>Change</th><th>Basis</th></tr></thead><tbody>' +
    row('Extraction per 1k pages', p.oldExtractEstimate, p.newExtract, 'New: measured usageMetadata. Old: estimate (model retired; image + thinking tokens assumed, output counted from cached text)') +
    row('TTS per 1k pages', p.oldTtsEstimate, p.newTts, 'Old: real WAV seconds x 25 tok/s x $10/M. New: ' + (p.newTtsBasis || 'measured audio tokens x $9/M')) +
    row('Extraction + TTS per 1k pages', p.oldExtractEstimate + p.oldTtsEstimate, p.newExtract + p.newTts, '') +
    row('TTS per audio hour', h.oldTtsEstimate, h.newTts, 'Doc list prices: old $0.90/h, new $0.81/h (both double/expire after 2026-12-31)') +
  '</tbody></table></div>' +
  '<h3>Tokens, audio and timings</h3><div class="scroll"><table><tbody>' +
    '<tr><th>Extraction tokens (all pages)</th><td class="num">in '+t.extractIn+' / out '+t.extractOut+' / thinking '+t.extractThink+'</td></tr>' +
    '<tr><th>TTS tokens (all segments)</th><td class="num">text in '+t.ttsIn+' / audio out '+t.ttsOut+' ('+(S.audio.newAudioTokensPerSec||0).toFixed(1)+' tok/s)</td></tr>' +
    '<tr><th>Audio length</th><td class="num">old '+sec(S.audio.oldSeconds)+' / new '+sec(S.audio.newSeconds)+'</td></tr>' +
    '<tr><th>Extraction latency per page</th><td class="num">p50 '+ms(l.extractP50)+' / max '+ms(l.extractMax)+' (old stored p50 '+ms(l.oldExtractStoredP50)+')</td></tr>' +
    '<tr><th>TTS latency per segment</th><td class="num">p50 '+ms(l.ttsP50)+' / max '+ms(l.ttsMax)+'</td></tr>' +
    '<tr><th>Run stages</th><td class="num">source '+ms(S.timings.sourceMs)+', render+download '+ms(S.timings.renderAndDownloadMs)+', extract '+ms(S.timings.extractMs)+', TTS '+ms(S.timings.ttsMs)+', total '+ms(S.timings.totalMs)+'</td></tr>' +
    '<tr><th>Model versions reported</th><td>'+esc(S.models.modelVersions.join(', ')||'–')+'</td></tr>' +
  '</tbody></table></div>' +
  (S.failures.length ? '<div class="note"><b>Failures:</b> '+S.failures.map(f=>esc(f.target+': '+f.error)).join('<br>')+'</div>' : '') +
  (D.observations.length ? '<h3>Observations</h3><ul class="obs">'+D.observations.map(o=>'<li>'+esc(o)+'</li>').join('')+'</ul>' : '') +
  '<div class="note small">Sample windows and voices: '+D.books.map(b=>esc(b.title.slice(0,40))+' pages '+b.pages[0].page+'–'+b.pages[b.pages.length-1].page+' (old voice key "'+esc(b.oldVoiceKey)+'", new voice '+esc(b.newVoice)+')').join('; ')+'. Old audio for the third book is the "Islamic Book Reader" persona (base voice Algieba with a dramatic/enthusiastic style); new audio uses plain Algieba with no style, so that comparison is not voice-for-voice equal.</div>' +
  '</section>';
  function stat(v,l){ return '<div class="stat"><b>'+esc(v)+'</b><span>'+esc(l)+'</span></div>'; }
  function row(l,o,n,b){ return '<tr><th>'+l+'</th><td class="num">'+usd(o,3)+'</td><td class="num">'+usd(n,3)+'</td><td class="num">'+delta(o,n)+'</td><td class="small muted">'+esc(b)+'</td></tr>'; }
}

function oldBreaksTable(b){
  if (!b.oldBreaks.length) return '';
  return '<h3 class="en">Old pipeline: what is spoken across each page edge</h3><div class="scroll"><table><thead><tr class="en"><th>Pages</th><th>Sentence crosses the edge?</th><th>Header read first on next page?</th><th>End of page n (spoken) → start of page n+1 (spoken)</th></tr></thead><tbody>' +
  b.oldBreaks.map(x => '<tr><td class="num">'+x.from+' → '+x.to+'</td><td class="en '+(x.sentenceCrossesBreak?'yes':'no')+'">'+(x.sentenceCrossesBreak?'yes, cut':'no')+'</td><td class="en '+(x.nextStartsWithHeader?'yes':'no')+'">'+(x.nextStartsWithHeader?'yes':'no')+'</td><td class="ar"><span class="tail">… '+esc(x.tail)+'</span><span class="sep">|</span>'+esc(x.head)+' …</td></tr>').join('') +
  '</tbody></table></div>';
}

function boundariesTable(b){
  if (!b.boundaries.length) return '';
  const yn = v => v == null ? '–' : (v ? '<span class="yes">yes</span>' : '<span class="no">no</span>');
  return '<h3 class="en">New pipeline: page-edge decisions</h3><div class="scroll"><table><thead><tr class="en"><th>Pages</th><th>Model: page n ends mid-sentence</th><th>Heuristic: no terminal punctuation</th><th>Model: page n+1 starts mid-sentence</th><th>Merged</th><th>Edge text</th></tr></thead><tbody>' +
  b.boundaries.map(x => '<tr><td class="num">'+x.from+' → '+x.to+'</td><td class="en">'+yn(x.prevEndsModel)+'</td><td class="en">'+yn(x.prevOpenHeuristic)+'</td><td class="en">'+yn(x.nextStartsModel)+'</td><td class="en">'+(x.merged?'<span class="badge merge">merged '+esc(x.segmentId)+'</span>':(x.disagreement?'<span class="yes">signals disagree</span>':'no'))+(x.note?' '+esc(x.note):'')+'</td><td class="ar"><span class="tail">… '+esc(x.tail||'')+'</span><span class="sep">|</span>'+esc(x.head||'')+' …</td></tr>').join('') +
  '</tbody></table></div>';
}

function pageRow(b,p){
  const o = p.oldText || {header:'',body:'',footer:''};
  const ai = p.oldAudioInfo, row = p.oldAudioRow;
  const rawJson = (o.body || '').trim().startsWith('{');
  const old = '<div class="col"><h4 class="en">OLD text + audio</h4>' +
    (rawJson ? '<div class="note small en">The cached old body is a raw JSON string, so the old TTS was sent the JSON keys, quotes and the footer text too.</div>' : '') +
    zone('header (spoken)', o.header) + zone('body (spoken)', o.body) + zone('footer (not spoken)', o.footer) +
    (p.oldAudio ? '<audio controls preload="none" src="'+esc(p.oldAudio)+'"></audio><div class="small muted en">voice key "'+esc(row.voice_persona)+'", real length '+sec(ai&&ai.seconds)+' (database says '+esc(row.db_duration_seconds)+' s)'+(p.oldSpoken&&p.oldSpoken.truncated?', text truncated before TTS':'')+'</div>' : '<div class="small en">No old audio</div>') +
    '</div>';
  const blocks = p.newBlocks;
  const nu = '<div class="col"><h4 class="en">NEW blocks ('+esc(D.summary.models.extract)+')</h4>' + (blocks ? blocks.map(bl => {
    const spoken = SPOKEN.has(bl.role);
    const flags = (bl.role==='body' ? (bl.starts_mid_sentence?'<span class="flag en">starts mid-sentence</span>':'') + (bl.ends_mid_sentence?'<span class="flag en">ends mid-sentence</span>':'') : '');
    const marks = (bl.footnote_markers||[]).map(m=>'<span class="chip" title="footnote marker removed from spoken text">'+esc(m)+'</span>').join('');
    return '<div class="blk'+(spoken?'':' skip')+'"><span class="role'+(spoken?' spoken':'')+'">'+esc(bl.role)+'</span>'+flags+(marks?'<span class="small muted en"> markers:</span>'+marks:'')+'<div class="txt ar">'+esc(bl.text)+'</div></div>';
  }).join('') : '<div class="note en">Extraction failed for this page.</div>') +
    (p.extractCall ? '<div class="small muted en">in '+p.extractCall.promptTokenCount+' / out '+p.extractCall.candidatesTokenCount+' / thinking '+p.extractCall.thoughtsTokenCount+' tokens, '+usd(p.extractCall.costUsd,5)+', '+ms(p.extractCall.latencyMs)+'</div>' : '') +
    '</div>';
  const img = '<div class="col"><h4 class="en">Page '+p.page+'</h4><img class="thumb" loading="lazy" src="'+esc(p.image)+'" alt="Page '+p.page+' scan">' + scoreForm(b.key+'-p'+p.page, 'page') + '</div>';
  return '<article class="page" id="'+esc(b.key)+'-p'+p.page+'">'+img+old+nu+'</article>';
  function zone(l,t){ return t && t.trim() ? '<div class="zone"><div class="lbl en">'+l+'</div><div class="ar">'+esc(t).replace(/\\n/g,'<br>')+'</div></div>' : ''; }
}

function segList(b){
  return '<h3 class="en">NEW continuous listening</h3><p class="small muted en">One TTS call per paragraph segment, voice '+esc(b.newVoice)+'. Sentence highlight uses <b>approximate timing</b>: each sentence gets a share of the clip proportional to its character count. <button class="en" data-playall="'+esc(b.key)+'">Play all in order</button></p>' +
  b.segments.map(s => '<div class="seg" id="'+esc(s.id)+'" data-seg="'+esc(s.id)+'">' +
    '<div class="en">'+s.pages.map(n=>'<span class="badge">p'+n+'</span>').join('')+(s.merged?'<span class="badge merge">cross-page merge</span>':'')+'<span class="badge">'+esc(s.role)+'</span><span class="small muted">'+esc(s.id)+(s.duration?' · '+sec(s.duration):'')+(s.ttsCall?' · '+usd(s.ttsCall.costUsd,5):'')+'</span>'+((s.footnote_markers||[]).length?' <span class="small muted">markers removed:</span>'+s.footnote_markers.map(m=>'<span class="chip">'+esc(m)+'</span>').join(''):'')+'</div>' +
    (s.audio ? '<audio controls preload="none" src="'+esc(s.audio)+'" data-audio="'+esc(s.id)+'"></audio>' : '<div class="note en">'+(s.ttsPending ? 'TTS pending: daily free-tier cap reached.' : 'TTS failed for this segment.')+'</div>') +
    '<div class="ar">'+s.sentences.map((t,i)=>'<span class="sent" data-i="'+i+'">'+esc(t)+'</span>').join(' ')+'</div>' +
    scoreForm(s.id, 'segment') + '</div>').join('');
}

function appendix(){
  return '<section id="appendix" class="en"><h2>Appendix</h2>' +
  '<details><summary>Extraction prompt (system instruction)</summary><pre>'+esc(D.prompt)+'</pre></details>' +
  '<details><summary>Response schema</summary><pre>'+esc(JSON.stringify(D.schema,null,2))+'</pre></details>' +
  '<details><summary>Every model call ('+D.calls.length+')</summary><div class="scroll"><table><thead><tr><th>Kind</th><th>Target</th><th>Prompt tok</th><th>Output tok</th><th>Thinking tok</th><th>Cost</th><th>Latency</th></tr></thead><tbody>' +
    D.calls.map(c=>'<tr><td>'+esc(c.kind)+'</td><td>'+esc(c.target)+'</td><td class="num">'+c.promptTokenCount+'</td><td class="num">'+c.candidatesTokenCount+'</td><td class="num">'+c.thoughtsTokenCount+'</td><td class="num">'+usd(c.costUsd,5)+'</td><td class="num">'+ms(c.latencyMs)+'</td></tr>').join('') +
  '</tbody></table></div></details>' +
  '<details><summary>Prices used</summary><pre>'+esc(JSON.stringify(S.prices,null,2))+'\\n\\nOld-pipeline assumptions: '+esc(JSON.stringify(S.oldAssumptions,null,2))+'</pre></details></section>';
}

const app = document.getElementById('app');
app.innerHTML = summary() + D.books.map(b =>
  '<section id="'+esc(b.key)+'"><h2><span class="ar">'+esc(b.title)+'</span> <span class="small muted en">pages '+b.pages.map(p=>p.page).join(', ')+'</span></h2>' +
  (b.notes.length ? '<div class="note en">'+esc(b.notes.join('; '))+'</div>' : '') +
  oldBreaksTable(b) + boundariesTable(b) +
  '<h3 class="en">Page by page</h3>' + b.pages.map(p => pageRow(b,p)).join('') +
  segList(b) + '</section>').join('') + appendix();

document.getElementById('nav').innerHTML = '<a href="#summary">Summary</a>' + D.books.map(b=>'<a href="#'+esc(b.key)+'">'+esc(b.key.toUpperCase())+'</a>').join('') + '<a href="#appendix">Appendix</a>';

// Lightbox
const lb = document.getElementById('lightbox');
app.addEventListener('click', e => {
  const t = e.target;
  if (t.classList.contains('thumb')) { lb.querySelector('img').src = t.src; lb.showModal(); }
  if (t.dataset.playall) playAll(t.dataset.playall);
});
lb.addEventListener('click', () => lb.close());

// Scores
app.addEventListener('change', e => {
  const box = e.target.closest('[data-score]'); if (!box) return;
  const id = box.dataset.score; scores[id] = scores[id] || {};
  scores[id][e.target.dataset.k] = e.target.dataset.k === 'notes' ? e.target.value : Number(e.target.value);
  scores[id].updatedAt = new Date().toISOString(); save();
});
app.addEventListener('input', e => { if (e.target.tagName === 'TEXTAREA') e.target.dispatchEvent(new Event('change', {bubbles:true})); });
document.getElementById('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), generatedAt: S.generatedAt, scores }, null, 2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'readai-bakeoff-scores.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

// Approximate sentence highlight: proportional-by-character timing.
document.querySelectorAll('audio[data-audio]').forEach(au => {
  const seg = au.closest('.seg');
  const spans = [...seg.querySelectorAll('.sent')];
  const lens = spans.map(s => s.textContent.length); const total = lens.reduce((a,b)=>a+b,0) || 1;
  const ends = []; lens.reduce((acc,l) => { acc += l; ends.push(acc/total); return acc; }, 0);
  const paint = () => {
    const f = au.duration ? au.currentTime / au.duration : 0;
    let idx = ends.findIndex(x => f < x); if (idx < 0) idx = spans.length - 1;
    spans.forEach((s,i) => s.classList.toggle('on', !au.paused && i === idx));
  };
  au.addEventListener('timeupdate', paint);
  au.addEventListener('play', () => { document.querySelectorAll('audio').forEach(o => { if (o !== au) o.pause(); }); seg.classList.add('playing'); paint(); });
  au.addEventListener('pause', () => { seg.classList.remove('playing'); paint(); });
  au.addEventListener('ended', () => { seg.classList.remove('playing'); spans.forEach(s => s.classList.remove('on')); if (au.dataset.chain) { const next = document.querySelector('audio[data-audio="'+au.dataset.chain+'"]'); if (next) { next.dataset.chainActive = '1'; next.currentTime = 0; next.play(); next.closest('.seg').scrollIntoView({behavior:'smooth', block:'center'}); } } });
});
function playAll(key){
  const list = [...document.querySelectorAll('#'+key+' audio[data-audio]')];
  list.forEach((a,i) => { a.dataset.chain = list[i+1] ? list[i+1].dataset.audio : ''; });
  if (list[0]) { list[0].currentTime = 0; list[0].play(); list[0].closest('.seg').scrollIntoView({behavior:'smooth', block:'center'}); }
}
})();
</script>
</body>
</html>`;

fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log('Wrote', path.join(OUT, 'index.html'), (html.length / 1024).toFixed(0) + ' KB');
