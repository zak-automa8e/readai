// Gate: every image/audio path referenced by bakeoff-output/index.html exists on disk and is non-empty.
// Run from readai/backend:  node scripts/bakeoff/verify.js
const path = require('path');
const fs = require('fs');

const OUT = path.resolve(process.cwd(), '..', 'bakeoff-output');
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const json = html.match(/<script id="payload" type="application\/json">([\s\S]*?)<\/script>/);
if (!json) { console.error('FAIL: payload not found'); process.exit(1); }
const d = JSON.parse(json[1]);
const refs = [];
for (const b of d.books) {
  for (const p of b.pages) { refs.push(p.image); if (p.oldAudio) refs.push(p.oldAudio); }
  for (const s of b.segments) if (s.audio) refs.push(s.audio);
}
const missing = refs.filter(r => !fs.existsSync(path.join(OUT, r)) || fs.statSync(path.join(OUT, r)).size === 0);
const absolute = refs.filter(r => /^([a-z]+:|\/)/i.test(r));
const segsWithoutAudio = d.books.flatMap(b => b.segments.filter(s => !s.audio).map(s => s.id));
console.log(`refs ${refs.length}, missing ${missing.length}, absolute ${absolute.length}, segments without audio ${segsWithoutAudio.length}`);
if (missing.length) console.log('missing:', missing.join(', '));
if (segsWithoutAudio.length) console.log('no audio:', segsWithoutAudio.join(', '));
process.exit(missing.length || absolute.length ? 1 : 0);
