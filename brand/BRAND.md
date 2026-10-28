# Narwi · نروي — brand rules for agents

Read this before you design, write or build anything for Narwi (formerly ReadAI).
Full reference with examples: `brand/book/index.html`. Everything here is approved (brand book v1, 28 Oct 2026).

## Name

- Arabic **نروي** (نَرْوِي when teaching pronunciation). English **Narwi**: capital N, rest lower case. Say *NAR-wee*.
- Together: `Narwi · نروي`. Means "we narrate" and "we quench".
- Never: Narwee, Narwy, NarWi, NARWI, "Narwi AI", "Narwi.ai" as the name, نروى, النروي. Don't confuse with يروي (yarwy.com, another audiobook platform).
- Tagline: **نروي، فتتلقّى كما تلقَّوا** — *We narrate, you receive, as they did.*
- Big idea: **Learn the way they learned.** Arabic: تعلَّمْ كما تعلَّموا.

## Logo — `brand/logo/`

- Reference the SVG files; never redraw, retype, copy into another folder, or embed the name in a live font.
- Arabic UI → `narwi-lockup-ar.svg`; English UI → `narwi-lockup-en.svg`; square or bilingual → `narwi-lockup-stacked.svg`;
  tight space → `narwi-mark.svg`; dark backgrounds → `*-dark.svg`; on lapis or one-colour → `*-white.svg` / `*-black.svg`.
- Clear space = height of the red dot on every side. Minimum heights: mark 16px, EN lockup 24px, AR lockup 28px, stacked 64px.
- No stretching, rotating, recolouring, shadows, gradients, glows or outlines.

## Colour — `brand/tokens/`

Import `tokens.css`; Tailwind projects add `tailwind.preset.js` as a preset. Never hard-code a hex that isn't in the tokens.

| Role | Light | Dark | Use |
|---|---|---|---|
| bg | `#F7F5EF` | `#0D1124` | page |
| surface | `#FFFFFF` | `#151A30` | cards, panels, the book page |
| text | `#161A2B` | `#ECE9E1` | body text |
| muted | `#565B6E` | `#A0A4B5` | secondary text |
| line | `#E2E0D8` | `#262B44` | hairline borders |
| primary (lapis) | `#1E3A8A` | `#8DA6F2` | buttons, links, play, the mark |
| on-primary | `#FFFFFF` | `#0D1124` | text on lapis |
| accent (red ink) | `#B4322A` | `#EE7B66` | what is being read: progress, current-passage underline |
| accent-soft | `#F7E3DF` | `#3A2230` | highlight behind the passage being read, selected item |
| deco (gold) | `#B8892B` | `#D9AE4F` | ornament only — **never text, never a button** (fails contrast) |

- shadcn variables in `tokens.css` are RGB channels (`--primary: 30 58 138`), read as `rgb(var(--primary) / <alpha-value>)`.
  The app keeps a copy in `frontend/src/brand/` and `frontend/public/brand/` (its Docker build sees only `frontend/`):
  after any change here, run `npm run brand:sync` in `frontend/`; `npm run brand:check` fails if the copy is stale.
- `destructive` reuses red ink.

## Type

- **Amiri** — Arabic display (700) and all book text (400, 17px / line-height 2).
- **Fraunces** — Latin display (600). The wordmark is Fraunces 600 at optical size 72.
- **Readex Pro** — the whole interface, both scripts (300–600).
- Arabic display runs ~15% larger than Latin for the same role. Load the real weights; no faux bold.
- No other fonts. Never Inter, never a system default as a design choice.

## Voice

Rooted · Curious · Confident · Generous. Short, clear, sure — like a teacher who knows the text.
No exclamation marks, no "revolutionary", no "powered by AI", no guilt or paywall pressure.
Name the practice by its real name (samāʿ, sharḥ, ḥāshiya, isnād). **Nothing is said without its source** — every AI answer cites its page.
Arabic copy: write it yourself for this brand (owner's instruction); have the owner review new Arabic lines.

## Claims about the tradition

Free to use: samāʿ and hearing certificates; ijāza chains; sharḥ / ḥāshiya / mukhtaṣar on a matn; illustrated scientific manuscripts (al-Jazarī, al-Ṣūfī, al-Zahrāwī).
Never: *taʿlīqa*; Bayt al-Ḥikma as a "university" or "academy"; "the oldest" or exact dates without a fresh source; "education was free for everyone" (say waqf paid for madrasas, teachers and students' keep).

## Visual don'ts

Sepia, fake parchment, "ancient" kitsch · crescents, domes, mosque silhouettes · arabesque as wallpaper ·
green with gold/yellow (Tarteel), tan/bronze (Shamela), orange (Abjjad, Storytel), black-and-white "AI minimal" as the lead ·
emoji in UI (use Lucide or Phosphor) · blue-to-purple gradients · coloured accent bars on card edges.
