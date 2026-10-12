# Reading Room Revamp — implementation plan

Date: 2026-10-12 · Branch: `feat/reading-room-revamp` · Scope: `frontend/` only (backend untouched)
Status of gates at plan time: `npx tsc --noEmit -p tsconfig.app.json` exits 0 on this branch.

Vocabulary used below: **pane** = one column of the reading room; **rail** = left pane; **canvas** = middle pane
(the PDF page); **AI pane** = right pane; **RRP** = `react-resizable-panels` 2.1.5 (installed, unused today);
**DPR** = device pixel ratio; **OCR** = optical character recognition (backend Gemini image→text);
**TTS** = text-to-speech; **RTL** = right-to-left; **CSR** = client-side rendering (this app has no server rendering).

---

## 1. Target shape

### 1.1 Component tree — `/read` route (diff against today)

```diff
 AppRouter  (frontend/src/components/AppRouter.tsx:24)
   ProtectedRoute › ReadingLayout › Index  (frontend/src/pages/Index.tsx)
-    BackToLibrary                 absolute top-left button
-    ReadingArea  (1016 lines)     <main> whose width is a vw calc keyed on isAICollapsed (ReadingArea.tsx:787-792)
-      Card.glass › ScrollArea › containerRef › Document › Page(+hidden prefetch Page)
-      Card.glass absolute-bottom control bar (play · auto-play · voice Select · prev/next · seek)
-    AIAssistant                   position:fixed Card, sm:w-[calc(35vw-6rem)]  (AIAssistant.tsx:21-30)
-      Tabs: Chat › ChatWindow | Notes › NotesWindow
+    ReadingRoomProvider           room state: pdf proxy, pageNumber, fit/zoom, selection, pane handles
+      ReadingRoom                 desktop (≥768px)
+        RoomHeader                44px strip spanning all panes: back · title/author · fullscreen · theme
+        ResizablePanelGroup       direction=horizontal  autoSaveId=`readai:room:<bookId>`  key=bookId
+          ResizablePanel#rail     collapsible collapsedSize=4 minSize=14 defaultSize=18
+            LeftRail              collapsed → RailStrip (icon column) | open → Tabs: Pages | Outline | Notes
+          ResizableHandle
+          ResizablePanel#canvas   minSize=30
+            PageCanvas            ResizeObserver → renderWidth; Document › Page(textLayer ON) + hidden prefetch Page
+              SelectionPopover    appears on text selection: Explain · Save as note
+            ControlBar            prev · n/N · next │ play/pause · auto-play · voice Select │ fit · zoom │ fullscreen
+          ResizableHandle
+          ResizablePanel#ai       collapsible collapsedSize=4 minSize=22 defaultSize=28
+            AIPane                collapsed → AIStrip | open → Tabs: Chat | Notes | Explain
+      MobileReadingRoom           <768px: PageCanvas + ControlBar; rail and AI pane as vaul Drawer bottom sheets
```

Everything is in normal flow inside one `PanelGroup`; nothing is `fixed`/`absolute` except the selection popover,
so edges align by construction, not by coincidence.

### 1.2 File tree — what moves where

```diff
 frontend/src/
   components/
-    ReadingArea.tsx               1016 lines: state + audio + prefetch + layout + control bar in one component
-    AIAssistant.tsx               deleted (story 2)
-    BackToLibrary.tsx             deleted (story 2) — folded into RoomHeader
     ChatWindow.tsx                stays; conversation state lifted out into a hook (story 5)
     NotesWindow.tsx               stays; reused by AI pane Notes tab
+    reading-room/
+      ReadingRoom.tsx             shell: header + PanelGroup + mobile switch
+      ReadingRoomContext.tsx      provider + useReadingRoom()
+      RoomHeader.tsx
+      LeftRail.tsx  RailStrip.tsx  ThumbnailList.tsx  OutlineList.tsx  RailNotes.tsx
+      PageCanvas.tsx  SelectionPopover.tsx  ControlBar.tsx  VoiceSelect.tsx
+      AIPane.tsx  AIStrip.tsx  ExplainTab.tsx
+      MobileReadingRoom.tsx
+      hooks/
+        usePdfDocument.ts         pdfUrl from Book (ReadingArea.tsx:78-103) + Document load → { pdf, numPages }
+        usePageFit.ts             ResizeObserver on the canvas pane + page aspect → renderWidth (replaces :105-192)
+        usePageAudio.ts           play/pause/seek/prefetch/auto-advance moved verbatim (ReadingArea.tsx:25-61,114-130,139-145,194-709)
+        useVoiceChoice.ts         personas query + voiceChoice + activePersonaIdRef (ReadingArea.tsx:62-76, 374-387)
+        usePaneLayout.ts          ImperativePanelHandle refs, collapse/expand/toggle, per-book autoSaveId
+        useTextSelection.ts       selection inside .react-pdf__Page__textContent → { text, pageNumber, rect }
+        useBookConversation.ts    lifted from ChatWindow.tsx:21-37, 75-283 (conversation id, cache, send)
   contexts/
-    UIContext.tsx                 isAICollapsed/setIsAICollapsed removed (only AIAssistant + ReadingArea use them)
+    UIContext.tsx                 keeps isMobile; adds dir/lang (story 7)
   index.css                       tokens rewritten (story 1); .glass/.card-gradient shimmed then deleted (story 6)
   tailwind.config.ts              fontFamily + radius + colour tokens (story 1)
 frontend/index.html               Google Fonts link: Inter/Outfit → serif + sans + Arabic (story 1)
```

The `reading-room/` folder deviates from the flat `src/components` convention on purpose: stories 2–5 each own
different files in it instead of fighting over one 1000-line component.

---

## 2. Load-bearing unknowns — resolved by reading the code

| # | Question | Finding (file:line) | Consequence for the plan |
|---|---|---|---|
| U1 | How is page size computed today? | `updateContainerDimensions` (ReadingArea.tsx:161-187) reads `containerRef.clientWidth`; fit-page subtracts hard-coded 100+64+48+70 px from `window.innerHeight`; both `width` and `height` are passed to `<Page>` (:877-883). react-pdf 7.7.0 `Page.js` computes scale as `if (width) … else if (height)` — **height is ignored whenever width is set**, so "fit page" today is really fit-width at 90 %. The resize listener is registered once with `[]` deps (:105-112) so it closes over the initial `fitMode`/`zoomScale` (stale closure). | Replace with `usePageFit`: ResizeObserver on the canvas pane element (panes resize via flex-grow — no `window.resize` fires); page aspect from `pdf.getPage(n).getViewport({scale:1})`; pass **only `width`**: fit-width → `availW·zoom`, fit-page → `min(availW, availH·aspect)·zoom`. |
| U2 | Can thumbnails/outline live outside `<Document>`? | `Page`, `Outline` accept a `pdf: PDFDocumentProxy` prop (react-pdf `Outline.d.ts:40`, `Page.d.ts:196`), obtained from `Document.onLoadSuccess`. | One `<Document>` in PageCanvas; rail components take `pdf` from context. No second fetch of the PDF. |
| U3 | Is the PDF outline available in the installed version? | `react-pdf@7.7.0` ships `Outline` with `onItemClick({ pageNumber })` (`shared/types.d.ts:18-22`). pdfjs-dist pinned by react-pdf is **3.11.174**, and `public/pdf.worker.min.js` is 3.11.174 — they match. Root `pdfjs-dist@4.8.69` is only imported by dead `lib/pdf-utils*.ts` (used by `/pdf-test` only). `memory-bank/activeContext.md` records a past outage from this exact mismatch. | Use `<Outline pdf={pdf}>`; styled via `.react-pdf__Outline` CSS. **Do not upgrade react-pdf/pdfjs-dist or touch the worker in this epic.** |
| U4 | Where is text selection available? | `renderTextLayer={false}` today (ReadingArea.tsx:882). Turning it on yields `.react-pdf__Page__textContent` spans (TextLayer.css already imported :10). Selection = `document.getSelection()` on `mouseup`/`selectionchange`, filtered to ranges whose common ancestor is inside the page container. | `useTextSelection` + `SelectionPopover`. Side effect: `html2canvas(pageRef)` (:547) would now capture the text layer too → capture from the PDF canvas directly via `Page.canvasRef` (prefetch already does exactly this, :250-266; `capturePageContent` has the same path, :732-737). Parity, not regression. |
| U5 | How does explain-selection reach Gemini? | `POST /api/chat/message` accepts only `{ conversationId, message }`, max 10 000 chars (`backend/src/controllers/chatController.js:127-135`). Messages are stored server-side per conversation. ChatWindow owns `conversationId`/cache state locally (ChatWindow.tsx:33-37). | No backend change. Lift conversation state into `useBookConversation(bookId)` shared by Chat and Explain tabs; Explain composes the prompt client-side (`Explain this passage from page N:\n> …`). `CreateNotePayload` already has `textSelection` + `pageNumber` (NotesContext.tsx:22-31) so "save selection as note" is free. |
| U6 | Pane-size persistence and flash | RRP `PanelGroup` has `autoSaveId` + optional `storage` (`PanelGroup.d.ts`); default storage = localStorage key `react-resizable-panels:<autoSaveId>`; saves layout **and** `expandToSizes` (collapsed state survives). Stored layout is applied in a `useLayoutEffect` when panels register (`react-resizable-panels.development.esm.js:1987-2030`) → before first paint. `autoSaveId` is only re-read when the panel set changes. | `autoSaveId={`readai:room:${bookId}`}` and `key={bookId}` on the group so switching books remounts. No flash in CSR. Fit mode + zoom per book stored under `readai:room:<bookId>:view` (small JSON) by `usePageFit`. |
| U7 | RTL in RRP | Drag delta is inverted when `document.dir === "rtl"` (esm.js:2064-2068) — it reads the **document** attribute, not an ancestor's. | Story 7 must set `document.documentElement.dir`, never `dir` on a wrapper div. |
| U8 | Who depends on `isAICollapsed` / `AIAssistant` / `.glass`? | `isAICollapsed`: only AIAssistant.tsx:13-65 and ReadingArea.tsx:55,788,791. `AIAssistant`: only Index.tsx. `.glass`: 10 files / 55 uses (Dashboard 12, Library 10, Analytics 8, VoiceStudio 7, Home 6, Settings 5, Discover 3, ReadingArea 2, AIAssistant 1, Sidebar 1). `card-gradient`: ChatWindow, NotesWindow. Gradients: Sidebar, Auth, Dashboard, Discover, Home, VoiceStudio. `font-display`: index.css:80 only. | Story 2 can delete AIAssistant/BackToLibrary and strip UIContext safely. Story 1 must **shim** `.glass`/`.card-gradient` as flat paper surfaces so pages stay coherent until story 6 removes the classes and the shim. |
| U9 | Mobile primitives available? | `useIsMobile` (768px) in `hooks/use-mobile.tsx`; `ui/drawer.tsx` (vaul 0.9.9) and `ui/sheet.tsx` exist, unused. | Bottom sheets = vaul `Drawer`. |
| U10 | Theme plumbing | `next-themes` `attribute="class"` in App.tsx:35; Settings.tsx:24-61 already has the theme select. | Dark mode = remap `.dark` variables in index.css; no new plumbing. |
| U11 | Dev server port | `vite.config.ts:11` sets **8080** (CLAUDE.md says 5173). | Verification URLs below use `http://localhost:8080/read`. |

Dead code found (not touched by this epic unless the owner says so): `SimpleReadingArea.tsx`, `SimplePdfThumbnail.tsx`,
`PDFJSExpressViewer.tsx` (0 bytes), `SimplePDFViewer.tsx` (0 bytes), `lib/pdf-utils.ts`, `lib/pdf-utils-react.ts`,
`@pdftron/pdfjs-express-viewer` dependency (never imported). `Book.last_read_page` is read (BooksContext.tsx:85) but never written by the reader — out of scope, noted.

---

## 3. Design locks (story 1 output, applied by every later story)

Lock these before any layout work. Values keep shadcn's `hsl(var(--x))` contract so every `ui/*` component keeps working.

| Token | Light (owner) | HSL triplet for `--var` | Dark (proposed) | Role |
|---|---|---|---|---|
| `--background` | `#F7F4EE` | `40 36% 95%` | `#16140F` | app/paper background |
| `--card` / `--popover` | `#FFFFFF` | `0 0% 100%` | `#1E1B16` | surfaces (panes, cards) |
| `--foreground` | `#1C1A17` | `36 10% 10%` | `#ECE7DC` | ink |
| `--muted-foreground` | `#6B655C` | `36 8% 39%` | `#A39B8E` | secondary text |
| `--muted` / `--secondary` / `--accent` | `#EFEAE0` | `40 33% 91%` | `#26221B` | hover/selected fills |
| `--border` / `--input` | `#E4DED3` | `39 24% 86%` | `#2E2A23` | 1px hairlines |
| `--primary` / `--ring` | `#8A3B12` | `20 77% 31%` | `#D08457` | the single accent (buttons, active tab underline, selection) |
| `--destructive` | `#9B2C1F` | `5 66% 36%` | `#E07A6E` | errors |
| `--radius` | `0.375rem` (6px) | | same | editorial: low radius, no pills |

Typography (Google Fonts link replaces Inter/Outfit in `index.html:11`; `font-feature-settings "ss01"…` in index.css:77 is Inter-specific — remove):

| Tailwind family | Fonts | Used for |
|---|---|---|
| `font-serif` | Newsreader, Amiri (Arabic), Georgia | book title, headings, reading UI (page n/N, outline) |
| `font-sans` | IBM Plex Sans, IBM Plex Sans Arabic, system-ui | all other UI |
| `font-mono` | IBM Plex Mono | timestamps, zoom % |

Recommendation: IBM Plex over Geist because Plex has a matching Arabic cut; Geist has none. Newsreader over Source Serif for the warmer paper feel. Both are one-line swaps in `tailwind.config.ts`.

Spacing scale: 4px base — use only `1 2 3 4 6 8 12` (4/8/12/16/24/32/48px). Hairlines: `border border-border`, never `shadow-lg`. Icons: Lucide only, `h-4 w-4` in bars, `h-5 w-5` in strips. Direction: from story 1 on, **new code uses logical Tailwind utilities only** (`ps- pe- ms- me- start- end- text-start border-s rounded-s`) so story 7 is a flip, not a rewrite.

---

## 4. Stories

Order kept as approved (1→7). One addition inside story 2: its first steps are a behaviour-preserving extraction of
ReadingArea into hooks, because stories 3, 4 and 5 all need those hooks and would otherwise edit the same file.

Automated gates for every story: `cd frontend && npx tsc --noEmit -p tsconfig.app.json && npm run build`.
Backend `cd backend && npm test` once at the end (nothing here touches it). Running-app checks: `cd backend && npm run dev`, `cd frontend && npm run dev`, open `http://localhost:8080`.

### Story 1 — Design tokens (M) · delegate: Sonnet with §3 as the brief

| Step | Change | Files |
|---|---|---|
| 1.1 | Replace `:root` and `.dark` variables with §3 values; set `--radius: 0.375rem` | `src/index.css:5-62` |
| 1.2 | `fontFamily`: `serif`, `sans`, `mono` per §3; delete `display` | `tailwind.config.ts:60-63` |
| 1.3 | Swap Google Fonts `<link>`; set `<html lang="en">` to be driven later by story 7 | `index.html:11` |
| 1.4 | `h1-h6` → `font-serif`; remove `font-feature-settings` line | `src/index.css:77-81` |
| 1.5 | Shim: `.glass` → `@apply bg-card border border-border rounded-md` (no blur, no translucency, no shadow); `.card-gradient` → `@apply bg-card border border-border` | `src/index.css:112-118` |
| 1.6 | Delete `animate-fade-in`/`animate-slide-in` keyframes only if unused after story 2 (defer) | — |

Acceptance (running app, light + dark via Settings → Theme):
- [ ] No page shows blur/translucency; backgrounds are `#F7F4EE` / `#16140F`; borders are 1px hairlines.
- [ ] Headings render in Newsreader, body in IBM Plex Sans (DevTools computed `font-family`).
- [ ] Buttons/links use the brown accent; no blue anywhere (`--primary` has no 220° hue left in index.css).
- [ ] `tsc` + `build` pass.

### Story 2 — Reading shell (L) · careful work (Opus); step 2.1 can go to Sonnet with the line ranges above

| Step | Change | Files |
|---|---|---|
| 2.1 | **Extract, no visual change**: `useVoiceChoice` (ReadingArea.tsx:62-76 + 374-387), `usePageAudio` (:25-61, 114-130, 139-145, 194-709 — move verbatim; it takes `{ bookId, pageNumber, numPages, activePersonaIdRef, capturePage }` and returns playback state + `prefetchPageNumber`/`prefetchPageRef`), `usePdfDocument` (:78-103, 147-158). ReadingArea becomes a thin view over the hooks. Verify: TTS play/pause, auto-advance, prefetch toast, voice switch cancels prefetch — all behave as before. | new `hooks/*`, `ReadingArea.tsx` |
| 2.2 | `ReadingRoomContext`: `{ pdf, numPages, pageNumber, goToPage, fit, zoom, selection, setSelection, panes }`. | `ReadingRoomContext.tsx` |
| 2.3 | `ReadingRoom.tsx`: `RoomHeader` + `ResizablePanelGroup` from `ui/resizable.tsx` with the three panels of §1.1; `usePaneLayout` holds `ImperativePanelHandle` refs (`collapse/expand/isCollapsed`) for the strip toggles; `autoSaveId` + `key={bookId}`. Rail and AI pane render `RailStrip`/`AIStrip` when `onCollapse` fires. | `ReadingRoom.tsx`, `usePaneLayout.ts`, `RailStrip.tsx`, `AIStrip.tsx`, `RoomHeader.tsx` |
| 2.4 | Move today's canvas markup into `PageCanvas.tsx` (still width-only fit from 2.1 — story 3 upgrades it) and the control bar into `ControlBar.tsx` + `VoiceSelect.tsx` (Select from ReadingArea.tsx:941-957, unchanged behaviour). Control bar sits at the bottom of the canvas pane, hairline above. | `PageCanvas.tsx`, `ControlBar.tsx`, `VoiceSelect.tsx` |
| 2.5 | AI pane: temporary content = existing `Tabs` with `ChatWindow`/`NotesWindow` (story 5 replaces). Rail: placeholder tabs (story 4 fills). | `AIPane.tsx`, `LeftRail.tsx` |
| 2.6 | `Index.tsx` renders `<ReadingRoomProvider><ReadingRoom/></ReadingRoomProvider>`; delete `AIAssistant.tsx`, `BackToLibrary.tsx`, `ReadingArea.tsx`; strip `isAICollapsed/setIsAICollapsed` from `UIContext.tsx`. Keep `ReadingLayout`. | `Index.tsx`, `UIContext.tsx` |
| 2.7 | Handle style: `ResizableHandle` 1px `bg-border`, 8px hit area (`after:` already there), hover → `bg-primary`. No grip icon. | `ui/resizable.tsx` |

Acceptance (running app, open a book from Library):
- [ ] Three panes share one baseline and one top edge; dragging either divider resizes neighbours; no element overlaps the page.
- [ ] Rail and AI pane collapse to a 40px icon strip via their chevron and re-expand from the strip; keyboard arrows on a focused handle resize.
- [ ] Resize, reload: sizes and collapsed state restored. Open a second book: its own sizes (localStorage key `react-resizable-panels:readai:room:<id>`).
- [ ] Play, pause, auto-play to next page, change voice mid-prefetch (prefetch toast stops, audio resets) — identical to before.
- [ ] Back arrow in header returns to `/library`; `tsc` + `build` pass; `grep -rn "isAICollapsed\|AIAssistant\|BackToLibrary" frontend/src` → 0 hits.

### Story 3 — Page canvas (M) · careful (fit math); spike first (R1), then Sonnet

| Step | Change | Files |
|---|---|---|
| 3.1 | **Spike (throwaway, ≤1h)**: PanelGroup + `<Page>` + ResizeObserver; drag the divider and confirm re-fit; measure canvas re-render cost; decide throttle (rAF during drag, exact re-render on `PanelResizeHandle.onDragging(false)`). | scratch file, deleted after |
| 3.2 | `usePageFit(paneRef, pdf, pageNumber, fit, zoom)` → `renderWidth`: ResizeObserver on the pane's scroll container; aspect via `pdf.getPage(n).getViewport({ scale: 1 })`; fit-width `availW·z`, fit-page `min(availW, availH·aspect)·z`; pass `width` only. Persist `{ fit, zoom }` under `readai:room:<bookId>:view`. | `usePageFit.ts`, `PageCanvas.tsx` |
| 3.3 | Centre the page: pane is `overflow-auto`, page wrapper `mx-auto` with `p-6`, paper = `bg-card` + hairline; `renderTextLayer` ON (needed by story 5), `renderAnnotationLayer` off. Hidden prefetch `<Page>` gets a **fixed** `width={1200}` so OCR input quality no longer depends on pane width (today it uses `pageWidth`, ReadingArea.tsx:894). | `PageCanvas.tsx` |
| 3.4 | `capturePage()` for TTS: `Page.canvasRef` → `canvas.toDataURL('image/png')`; html2canvas kept as fallback only. | `PageCanvas.tsx`, `usePageAudio.ts` |
| 3.5 | ControlBar: prev · `n / N` (serif, click → input to jump) · next │ play/pause · auto-play toggle · VoiceSelect │ fit-width/fit-page toggle · zoom −/+ with % (50–200, step 10) · fullscreen (`requestFullscreen` on the room root). Remove the floating zoom slider (ReadingArea.tsx:799-827). | `ControlBar.tsx` |

Acceptance:
- [ ] Fit-page: whole page visible with no scrollbar in the canvas pane at any pane width; fit-width: page spans the pane minus 24px gutters; dragging a divider re-fits within one frame of release.
- [ ] Zoom 50→200 % works in both modes; page stays horizontally centred; values restored per book after reload.
- [ ] Fullscreen hides browser chrome, the room fills the screen, Esc exits.
- [ ] TTS still works (capture path changed): play a page that has no cached text and confirm OCR text + audio arrive.
- [ ] `tsc` + `build` pass.

### Story 4 — Left rail (M) · delegate: Sonnet

| Step | Change | Files |
|---|---|---|
| 4.1 | `ThumbnailList`: one `<Page pdf={pdf} pageNumber={i} width={railWidth-24} renderTextLayer={false} renderAnnotationLayer={false}>` per page, each wrapped in an IntersectionObserver gate so only visible ±2 render; current page outlined with `border-primary`; click → `goToPage`. Auto-scroll current thumbnail into view. | `ThumbnailList.tsx` |
| 4.2 | `OutlineList`: `<Outline pdf={pdf} onItemClick={({ pageNumber }) => goToPage(pageNumber)} />`; style `.react-pdf__Outline ul/li/a` with tokens; empty state "No outline in this document". | `OutlineList.tsx`, `index.css` |
| 4.3 | `RailNotes`: list from `useNotes().getNotesForBook(bookId)` sorted by `page_number`; click → `goToPage(note.page_number)` and open AI pane Notes tab. | `RailNotes.tsx` |
| 4.4 | `LeftRail` tabs (Lucide `LayoutGrid`, `ListTree`, `StickyNote`); `RailStrip` shows the same three icons and expands the pane onto that tab. | `LeftRail.tsx`, `RailStrip.tsx` |

Acceptance:
- [ ] A 300+-page PDF opens without jank; DevTools shows ≤ ~10 thumbnail canvases in the DOM at once.
- [ ] Clicking a thumbnail or outline entry changes the page and the thumbnail highlight follows prev/next.
- [ ] A PDF with no outline shows the empty state; a PDF with a nested outline shows indentation.
- [ ] Rail collapsed → icon strip; clicking an icon expands to that tab. `tsc` + `build` pass.

### Story 5 — AI pane (M) · careful for 5.1 (Opus or reviewed Sonnet); 5.2–5.4 Sonnet

| Step | Change | Files |
|---|---|---|
| 5.1 | Lift conversation state out of ChatWindow into `useBookConversation(bookId)` (init, upload-to-Gemini, cache extension, `send(message)`, `messages`, `status`), provided once by `ReadingRoomProvider`. ChatWindow becomes a view over it. Behaviour unchanged. | `useBookConversation.ts`, `ChatWindow.tsx` |
| 5.2 | `useTextSelection(pageContainerRef)`: on `mouseup`/`keyup`, if `getSelection()` is non-collapsed and inside `.react-pdf__Page__textContent`, set `{ text, pageNumber, rect }`; clear on click elsewhere. `SelectionPopover` (Radix Popover anchored to `rect`): **Explain** → `setSelection` + AI pane tab = Explain (expands the pane if collapsed); **Save as note** → `createNote(bookId, { content, textSelection, pageNumber })`. | `useTextSelection.ts`, `SelectionPopover.tsx`, `PageCanvas.tsx` |
| 5.3 | `ExplainTab`: shows the quoted selection (serif, page n), action row Explain · Summarise · Define · Translate (ar↔en); sends through `useBookConversation.send()` with a composed prompt; renders the reply (react-markdown, as ChatWindow does) and a "Save as note" button. Empty state: "Select text on the page to explain it." | `ExplainTab.tsx` |
| 5.4 | `AIPane` tabs Chat · Notes · Explain (Lucide `MessageSquare`, `StickyNote`, `Sparkles`); `AIStrip` mirrors them. Restyle ChatWindow/NotesWindow cards: `bg-card border border-border`, no `card-gradient`. | `AIPane.tsx`, `AIStrip.tsx`, `ChatWindow.tsx`, `NotesWindow.tsx` |

Acceptance:
- [ ] Select a sentence on the page → popover appears at the selection; Explain opens the Explain tab with the quote and a Gemini answer; the same exchange is visible in the Chat tab history.
- [ ] Save as note creates a note carrying `page_number` and `text_selection` (visible in Notes tab and rail Notes with "Page n").
- [ ] Chat still initialises, uploads the book once, and answers; switching books resets the conversation.
- [ ] Arabic PDF: selection and explain work (text layer handles bidi). `tsc` + `build` pass.

### Story 6 — App shell restyle (L) · 6.1 Haiku sweep with grep verification; 6.2–6.4 Sonnet

| Step | Change | Files |
|---|---|---|
| 6.1 | **Mechanical sweep**: replace `glass` → `bg-card border border-border rounded-md`; delete `card-gradient`, `bg-gradient-*`, `from-*`, `to-*`, `backdrop-blur*`, `shadow-lg/md`, `hover:scale-*`; map hard-coded Tailwind colours (`text-red-500`, `green-500`, `blue-*`, …) to tokens (`text-destructive`, `text-primary`, `text-muted-foreground`). Verify: `grep -rnE "glass|card-gradient|gradient|from-[a-z]|backdrop-blur|-(red|blue|purple|green|yellow|indigo|violet|gray|slate|zinc|amber|orange|emerald)-[0-9]" frontend/src --include=*.tsx | grep -v components/ui/` → 0 hits. Then delete the `.glass`/`.card-gradient` shim from index.css. | Dashboard, Library, Analytics, VoiceStudio, Home, Settings, Discover, Auth, Sidebar, AddBookModal, EditBookModal, BackendHealthCheck, VoiceCreationModal, index.css |
| 6.2 | `Sidebar`: flat `bg-background` column, `border-e`, serif wordmark, active item = `bg-muted` + accent text (no bar); collapsed width 56px. | `Sidebar.tsx` |
| 6.3 | Library + Dashboard: cards as paper tiles (hairline, 6px radius), serif titles, Lucide icons; progress bars `bg-muted` track / `bg-primary` fill (Dashboard.tsx:202,216 currently gradients). Remove hover scale transforms. | `Library.tsx`, `Dashboard.tsx` |
| 6.4 | Voice Studio + Settings + Home/Discover/Analytics/Auth: same treatment; `ContentLayout` title → serif. | pages, `layouts/ContentLayout.tsx` |

Acceptance:
- [ ] Every route in light and dark: flat surfaces, hairlines, one accent, no gradient/blur/shadow, no emoji, no coloured edge bars.
- [ ] Grep in 6.1 returns 0 hits; `.glass` no longer exists in index.css.
- [ ] `tsc` + `build` pass; `cd backend && npm test` passes (sanity, nothing changed).

### Story 7 — RTL + mobile (M) · 7.1 Haiku sweep; 7.2–7.4 Sonnet

| Step | Change | Files |
|---|---|---|
| 7.1 | **Mechanical sweep** of physical → logical utilities in all non-`ui/` components: `ml-/mr-` → `ms-/me-`, `pl-/pr-` → `ps-/pe-`, `left-/right-` → `start-/end-`, `text-left/right` → `text-start/end`, `border-l/r` → `border-s/e`, `rounded-l/r` → `rounded-s/e`; directional Lucide icons (`ChevronLeft/Right`, `ArrowLeft`) get `rtl:rotate-180`. Verify with the inverse grep → 0 hits outside `components/ui/`. | all components/pages |
| 7.2 | `UIContext`: `{ lang: 'en' \| 'ar', dir }` persisted in localStorage; effect sets `document.documentElement.lang` and `.dir` (required by RRP, see U7). Settings → "Interface language" select. CSS: `:lang(ar)` → Arabic font stacks first. | `UIContext.tsx`, `Settings.tsx`, `index.css` |
| 7.3 | Latin substrings inside Arabic UI (voice names, file names, URLs) wrapped in `<span dir="ltr">`; page counter uses `dir="ltr"` digits. | `ControlBar.tsx`, `VoiceSelect.tsx`, `RailNotes.tsx` |
| 7.4 | `MobileReadingRoom` (`useIsMobile`): header + PageCanvas (fit-width, pinch zoom via existing zoom) + ControlBar; two header buttons open vaul `Drawer`s containing `LeftRail` and `AIPane`; `SelectionPopover` → bottom-sheet actions. `PanelGroup` not rendered under 768px. | `MobileReadingRoom.tsx`, `ReadingRoom.tsx` |

Acceptance:
- [ ] Settings → العربية: panes mirror (rail on the right, AI pane on the left), dividers drag correctly (not inverted), chevrons point the right way, Arabic UI font is IBM Plex Sans Arabic; English back → mirrored back.
- [ ] A voice name like "Zephyr" inside RTL UI reads left-to-right.
- [ ] DevTools 390×844: single page pane, control bar reachable, rail and AI open as bottom sheets, text selection → sheet with Explain/Save.
- [ ] `tsc` + `build` pass.

---

## 5. Risks and the cheapest de-risk

| # | Risk | Cheapest de-risk | Owner story |
|---|---|---|---|
| R1 | Re-rendering the PDF canvas on every ResizeObserver tick during a drag stutters | 3.1 spike: throttle to rAF, exact re-render on `onDragging(false)`; CSS-scale the existing canvas during the drag if still slow | 3 |
| R2 | react-pdf 7.7.0 / pdfjs 3.11.174 / worker 3.11.174 lock — any dependency bump reintroduces the mismatch outage recorded in `memory-bank/activeContext.md` | Rule: no `npm install`/upgrade of react-pdf, pdfjs-dist, or the worker in this epic; `grep pdfjs-dist frontend/package-lock.json` unchanged at the end | all |
| R3 | Text layer on → `html2canvas(pageRef)` sends text-layer artefacts to OCR | 3.4 captures from `Page.canvasRef` (same path prefetch already uses) | 3 |
| R4 | Thumbnail rail renders every page of a large PDF | 4.1 IntersectionObserver gate; test with a 300-page PDF before styling | 4 |
| R5 | RTL mirroring silently fails because `dir` is set on a wrapper | 7.2 sets `document.documentElement.dir`; acceptance drags a divider in RTL | 7 |
| R6 | Conditionally rendering panels (mobile/collapse) scrambles RRP layout/persistence | Always render all three `Panel`s on desktop with `order` props; collapse via the imperative handle; mobile uses a separate tree | 2, 7 |
| R7 | Story 2.1 extraction regresses audio (stale closures around `audioRef`, prefetch abort, `activePersonaIdRef`) | Move code verbatim first, refactor second; manual script: play → auto-advance → change voice mid-prefetch → play again | 2 |
| R8 | `.glass` deletion breaks pages before story 6 | Story 1 shim; shim removed only after the 6.1 grep is 0 | 1, 6 |
| R9 | Fit-page needs the page's aspect before first render → double render / flash | `usePageFit` reads `pdf.getPage(n).getViewport({scale:1})` before setting `renderWidth`; show the previous page scaled until ready | 3 |
| R10 | Per-book persistence keys accumulate in localStorage | Acceptable (tiny JSON); note for a later "clear reading preferences" setting | 2 |

## 6. Delegation summary

| Story | Who | Why |
|---|---|---|
| 1 | Sonnet | Values are locked in §3; application is mechanical, verified by grep + visual check |
| 2 | Opus (2.1 may go to Sonnet with the line ranges) | Shell is the load-bearing change; the extraction must be behaviour-preserving |
| 3 | Spike + Opus for `usePageFit`; Sonnet for ControlBar | Fit math and throttling are where the first idea may be wrong |
| 4 | Sonnet | Clear APIs (`pdf` prop, `Outline`), checkable acceptance |
| 5 | 5.1 Opus or reviewed Sonnet; rest Sonnet | Lifting conversation state touches upload/cache timing |
| 6 | 6.1 Haiku (grep-verified sweep); 6.2–6.4 Sonnet | Sweep is mechanical; restyle needs the §3 brief and taste |
| 7 | 7.1 Haiku (grep-verified sweep); 7.2–7.4 Sonnet | Same split |

## 7. Decisions for the owner (defaults applied if unanswered)

1. **Header strip.** Default: a 44px strip above the panes (back · title/author · fullscreen · theme). Alternative: no strip — back/title live in the rail header, fullscreen/theme in the control bar.
2. **Explain goes through the book's chat conversation.** Default: yes — one Gemini conversation per book (backend already stores all messages), so explanations also appear in Chat history. Alternative: a stateless one-shot endpoint (requires backend work, out of this epic).
3. **RTL scope.** Default: RTL-ready plumbing (language setting, `dir`/`lang`, Arabic fonts, logical properties, mirrored panes) **without** translating UI strings — there is no i18n library today and string translation is its own epic. Alternative: add react-i18next + Arabic strings inside story 7 (turns it from M into L).
