// Copy the Narwi brand files the app uses from ../brand into the frontend.
// The Docker build only sees frontend/, so the app keeps its own copy; brand/ stays the source of truth.
//   node scripts/sync-brand.mjs          copy
//   node scripts/sync-brand.mjs --check  fail if any copy differs from brand/
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = join(frontend, '..', 'brand');

const logos = [
  'favicon.svg',
  'narwi-app-icon.svg',
  'narwi-mark.svg',
  'narwi-mark-dark.svg',
  'narwi-lockup-en.svg',
  'narwi-lockup-en-dark.svg',
  'narwi-lockup-ar.svg',
  'narwi-lockup-ar-dark.svg',
];

const files = [
  ['tokens/tokens.css', 'src/brand/tokens.css'],
  // .cjs: frontend is "type": "module" and the preset is CommonJS
  ['tokens/tailwind.preset.js', 'src/brand/tailwind.preset.cjs'],
  ...logos.map((name) => [`logo/${name}`, `public/brand/${name}`]),
];

const check = process.argv.includes('--check');
let stale = 0;

for (const [from, to] of files) {
  const src = join(brand, from);
  const dest = join(frontend, to);
  if (!existsSync(src)) {
    console.error(`missing source: brand/${from}`);
    process.exit(1);
  }
  if (check) {
    const same = existsSync(dest) && readFileSync(src).equals(readFileSync(dest));
    if (!same) {
      stale++;
      console.error(`out of date: ${to} (run npm run brand:sync)`);
    }
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`brand/${from} -> ${to}`);
}

if (check) {
  if (stale) process.exit(1);
  console.log(`brand files up to date (${files.length})`);
}
