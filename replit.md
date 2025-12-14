# ReadAI - AI-Powered Reading Application

## Overview
ReadAI is a full-stack web application for reading PDFs with AI-powered features including text-to-speech, image-to-text extraction, and chat functionality.

## Project Structure
```
├── frontend/          # React + Vite + TypeScript frontend
│   ├── src/
│   │   ├── components/   # UI components (shadcn/ui based)
│   │   ├── contexts/     # React contexts (Auth, Books, Notes, UI)
│   │   ├── hooks/        # Custom React hooks
│   │   ├── lib/          # Utilities and Supabase client
│   │   ├── pages/        # Route pages
│   │   └── services/     # API service for backend communication
│   └── vite.config.ts    # Vite configuration (port 5000)
│
├── backend/           # Node.js + Express backend
│   ├── src/
│   │   ├── config/       # Configuration (env vars)
│   │   ├── controllers/  # Request handlers
│   │   ├── middleware/   # Auth, CORS, error handling
│   │   ├── routes/       # API route definitions
│   │   ├── services/     # Business logic (Gemini AI, Supabase)
│   │   └── utils/        # Utilities (logging, audio)
│   └── server.js         # Server entry point (port 3001)
│
└── docs/              # Documentation
```

## Tech Stack
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend**: Node.js, Express
- **Database**: Supabase (PostgreSQL)
- **AI Services**: Google Gemini API (text-to-audio, image-to-text, document chat)
- **PDF Handling**: pdfjs-dist, react-pdf

## Environment Variables Required

### Backend (required for full functionality)
- `GEMINI_API_KEY` - Google Gemini API key for AI features
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` - Supabase service key (for backend)
- `SUPABASE_ANON_KEY` - Supabase anonymous key

### Frontend
- `VITE_API_URL` - Backend API URL (default: /api via Vite proxy)
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key

## Development
- Frontend runs on port 5000 (Vite dev server with API proxy)
- Backend runs on port 3001 (Express)
- Both workflows start automatically
- Vite proxies /api and /health requests to the backend

## Production Deployment
- Frontend is built and served statically by the backend
- Backend serves on port 5000 in production
- API available at /api endpoints

## Key Features
- PDF viewing and reading
- AI-powered text-to-speech
- Image-to-text extraction from PDF pages
- Chat with documents using Gemini AI
- Notes and annotations
- User authentication via Supabase

## Recent Changes
- 2024-12-14: Configured for Replit environment
  - Updated Vite to use port 5000 with allowedHosts and API proxy
  - Made Supabase/Gemini config optional for startup (warns instead of crash)
  - Fixed CORS for Replit domains
  - Backend serves frontend static files in production
  - Configured deployment for autoscale
