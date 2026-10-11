# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

### Prerequisites
- Node.js v18.0.0 or higher
- Google Gemini API key
- Supabase account and credentials (for auth, books, and voice personas)

### Development Server
```bash
# Terminal 1: Backend (runs on :3001)
cd backend
npm install
cp .env.example .env  # Edit .env to add credentials
npm run dev

# Terminal 2: Frontend (runs on :5173)
cd frontend
npm install
cp .env.example .env  # Edit .env to add credentials
npm run dev
```

### Common Commands

**Backend:**
- `npm run dev` — Start dev server with hot reload
- `npm run start` — Start production server
- `npm run lint` — Check for linting errors
- `npm run lint:fix` — Auto-fix linting errors
- `npm test` — Run tests (Jest)
- `npm test -- --watch` — Run tests in watch mode

**Frontend:**
- `npm run dev` — Start Vite dev server
- `npm run build` — Build for production
- `npm run build:dev` — Build in dev mode (useful for debugging builds)
- `npm run lint` — Run ESLint
- `npm run preview` — Preview production build locally

## Architecture Overview

### Technology Stack
- **Backend**: Node.js + Express, Supabase auth/database, Winston logging, Express rate limiting
- **Frontend**: React 18 + TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router, React Query
- **AI**: Google Gemini API (image-to-text, text-to-speech, document Q&A)
- **Database**: Supabase (PostgreSQL with RLS policies)

### Core Feature Areas

#### 1. PDF & Reading (`/api/pdf-proxy`, `/api/pages`)
- **Backend**: PDF proxy endpoint (CORS), page caching, OCR via Gemini
- **Frontend**: PDF viewer (react-pdf + PDFTron), reading layout with adjustable panels
- **Key Files**: `pageController.js`, `pageCacheService.js`, `ReadingArea.tsx`, `SimpleReadingArea.tsx`

#### 2. Books Management (`/api/books`)
- CRUD for books, storage of metadata (title, author, cover art)
- Supabase Tables: `books`, `book_pages`, `page_cache`
- **Frontend Context**: `BooksContext.tsx` — global state for user's library
- **Key Patterns**: Books load from DB on app init, stored in React context

#### 3. AI Chat (`/api/chat`)
- Document Q&A: Users ask questions about PDF content
- Conversation history maintained server-side (Gemini Files API for caching)
- **Backend**: `conversationService.js`, `geminiDocumentService.js`
- **Frontend**: `ChatWindow.tsx`, `AIAssistant.tsx` (separate panels in reading layout)

#### 4. Voice Personas (NEW)
- Users create custom voice profiles with style controls (pace, tone)
- Marketplace for sharing persona templates
- **Database Tables**: `voice_personas`, `voice_persona_templates`, `persona_ratings`, `persona_usage`
- **Backend**: `voicePersonaService.js`, `voicePersonaController.js`, `/api/voice-personas`
- **Frontend**: `VoiceStudio.tsx`, `VoiceCreationModal.tsx`, `voicePersonaService.ts`
- **Config**: `voicePersonaConfig.js` — defines Google Voices, rate limits (10 previews/day), prompt constants
- **Key Logic**: Converts slider values (Slow/Fast, Sad/Happy) into Gemini system instructions via `buildPrompt()`

#### 5. Authentication (`/api/auth`)
- JWT via Supabase (frontend sends token in Authorization header)
- **Backend Middleware**: `authMiddleware.js` — decodes JWT, extracts user_id
- **Backend Pattern**: Supabase Service Key for trusted backend queries (bypasses RLS, requires explicit ownership checks in code)
- **Frontend**: `AuthContext.tsx` — manages token and user state, wraps app with `<AuthProvider>`

### Database & Supabase
- **Service Key Pattern**: Backend uses `SUPABASE_SERVICE_KEY` (server-side only) for data operations
- **RLS Policies**: All tables have row-level security enabled (but backend bypasses via service key)
- **Critical**: Backend controllers MUST check `persona.user_id !== userId` manually since RLS doesn't block the service key
- **Migrations**: Applied directly to Supabase console (see `backend/supabase/migrations/`)

### Frontend State Management
- **React Context**: UI state (`UIContext`), books (`BooksContext`), notes (`NotesContext`), auth (`AuthContext`)
- **React Query**: Server state caching and synchronization (TanStack React Query)
- **Patterns**: Providers wrap the app at `App.tsx`, accessed via `useContext()` or custom hooks

### API Design
- **Base URL**: `http://localhost:3001/api` (dev), configured via `VITE_API_URL`
- **Auth Header**: `Authorization: Bearer <token>`
- **Error Handling**: Consistent JSON error responses with `error` and `message` fields
- **Rate Limiting**: Global 100 requests per 15 min, higher on specific endpoints
- **CORS**: Configured via `corsMiddleware.js`, allowed origins from `.env`

## Common Patterns & Conventions

### Backend
**File Structure**: `src/controllers` → `src/routes` → `src/services` → external APIs/DB
- **Controllers**: Handle HTTP layer, validation, calling services
- **Services**: Business logic, Supabase queries, Gemini API calls
- **Routes**: Mount controllers, define HTTP method + path
- **Middleware**: Auth, CORS, error handling, rate limiting

**Error Handling**: Use middleware `errorHandler.js` which logs and returns consistent JSON error responses. Throw errors in controllers/services, they bubble to middleware.

**Logging**: Winston logger via `require('./utils/logger')`. Use `.info()`, `.warn()`, `.error()` at key points (service calls, auth failures, retries).

**Gemini Integration**: `geminiService.js` wraps the Google Genai SDK. Methods: `generateImageDescription()`, `generateAudio()`, `uploadDocumentFile()`. Each retries up to `MAX_RETRIES` times with exponential backoff.

### Frontend
**File Structure**: `src/pages` (routes) → `src/components` → `src/services` → `src/contexts`
- **Pages**: Top-level route components (Library, VoiceStudio, Dashboard, etc.)
- **Components**: Reusable UI (sidebars, modals, panels, shadcn widgets)
- **Services**: API calls (`apiService.ts` for general endpoints, `voicePersonaService.ts` for voice personas)
- **Contexts**: Global state providers, wrapped in App.tsx
- **Types**: TypeScript interfaces in `src/types/` (e.g., `voicePersona.ts`)

**Component State**: Use React hooks (`useState`, `useContext`, `useQuery` from React Query). Minimal local state in components, prefer context + React Query for server state.

**API Calls**: Abstract in service files, imported into components. Use React Query for server state (caching, refetching). Example: `useQuery(['voice-personas'], () => voicePersonaService.list())`.

**UI Components**: shadcn/ui (copy-pasted into `src/components/ui/`). Use `<Button>`, `<Dialog>`, `<Select>`, `<Slider>`, etc. Styled with Tailwind CSS.

### Configuration
- **Backend Config**: `src/config/index.js` — loads `.env` via dotenv, exports a frozen config object
- **Gemini Models**: Configured in `config.geminiModels` — `imageToText`, `textToAudio`, `documentChat` (updatable)
- **Feature Configs**: Separate files like `voicePersonaConfig.js` for feature-specific constants

## Important Notes

### Voice Personas Risks & Safeguards
1. **Prompt Injection**: User `custom_prompt` is limited to 150 chars and wrapped in system instructions to prevent override
2. **Model Availability**: The `gemini-2.5-flash-preview-tts` voice model must be available to your API key (test with `backend/scripts/verify-persona-logic.js`)
3. **Ownership Checks**: Every persona read/update/delete MUST verify `persona.user_id === userId` in the controller before returning data

### Environment Variables
**Backend** (`.env`):
- `GEMINI_API_KEY` — Google Gemini API key
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY` — Supabase project credentials
- `PORT` — Server port (default 3001)
- `NODE_ENV` — `development` or `production`
- `ALLOWED_ORIGINS` — CORS origins (comma-separated)
- `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS` — Rate limit config
- `LOG_LEVEL` — `debug`, `info`, `warn`, `error`

**Frontend** (`.env`):
- `VITE_API_URL` — Backend API URL
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — Supabase (public/anon access)
- `VITE_PDFJS_EXPRESS_LICENSE_KEY` — Optional, for advanced PDFTron features

### Production Notes
- Backend serves the built frontend from `frontend/dist/` when `NODE_ENV=production`
- Frontend build outputs to `frontend/dist/` via `npm run build`
- Docker-ready: Both services expose ports (3001 for backend, 5173 for frontend dev)

## Testing & Verification

### Verification Scripts
- `backend/scripts/verify-persona-logic.js` — Tests voice persona prompt generation without API calls (safe, no costs)
  - Run: `node backend/scripts/verify-persona-logic.js`
  - Verifies: Prompt building, config integrity, style combinations

### Running Tests
**Backend**: `npm test` (Jest + Supertest for API routes)
**Frontend**: Not yet configured; ESLint available via `npm run lint`

## File Locations Reference

| Purpose | Path |
|---------|------|
| Backend entry | `backend/server.js` |
| Frontend entry | `frontend/src/main.tsx` |
| Routes (Backend) | `backend/src/routes/` |
| Controllers (Backend) | `backend/src/controllers/` |
| Services (Backend) | `backend/src/services/` |
| Pages (Frontend) | `frontend/src/pages/` |
| Components (Frontend) | `frontend/src/components/` |
| Contexts (Frontend) | `frontend/src/contexts/` |
| Types (Frontend) | `frontend/src/types/` |
| Config | `backend/src/config/` |
| DB Migrations | `backend/supabase/migrations/` |
