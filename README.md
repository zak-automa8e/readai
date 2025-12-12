# ReadAI

ReadAI is an application that combines the power of PDFs and AI to provide an enhanced reading experience. The application allows users to load PDFs, extract text using OCR, and convert text to speech.

This is an opensource project to help making reading books easily available to anyone with the help of AI

- PDF library management
- Text extraction from PDF pages using AI
- Text-to-speech functionality
- AI-powered assistant

## Project Structure

The project is split into two main parts:

### Frontend (React + TypeScript + Vite)

- Modern UI with responsive design
- PDF viewer with text extraction
- Audio playback controls
- Book library management

### Backend (Node.js + Express)

- PDF proxy endpoint to handle CORS
- Image-to-text API using Gemini AI
- Text-to-speech conversion using Gemini AI
- RESTful API structure

## Getting Started

### Prerequisites

- Node.js (v18.0.0 or higher)
- npm or yarn
- Google Gemini API key

### Installation

1. Clone the repository
```bash
git clone <repository-url>
cd readai
```

2. Set up the backend
```bash
cd backend
npm install
cp .env.example .env  # Then edit .env to add your Gemini API key
```

3. Set up the frontend
```bash
cd frontend
npm install
```

### Running the Application

1. Start the backend server
```bash
cd backend
npm run dev
```

2. Start the frontend development server
```bash
cd frontend
npm run dev
```

3. Open your browser and navigate to `http://localhost:5173`

## API Endpoints

### Backend

- `GET /api/pdf-proxy?url=<url>` - Proxy a PDF from an external URL
- `POST /api/image-to-text` - Extract text from an image
- `POST /api/text-to-audio` - Convert text to audio

## Environment Variables

### Backend

See `.env.example` for a list of required environment variables.

### Frontend

- `VITE_API_URL` - URL of the backend API (default: http://localhost:3001/api)

## Development

The project follows a modular architecture with clear separation of concerns:

- **Frontend**: React components, contexts, and services
- **Backend**: Controllers, services, routes, and utilities

## Production Deployment

For production deployment:

1. Build the frontend
```bash
cd frontend
npm run build
```

2. Set the backend environment to production
```bash
# In backend/.env
NODE_ENV=production
```

3. Configure proper CORS settings for your production domain

## License

[MIT](LICENSE)
