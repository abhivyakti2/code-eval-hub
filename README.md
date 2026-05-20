# Code Eval Hub

A comprehensive AI-powered platform for evaluating and analyzing GitHub repositories using advanced RAG (Retrieval-Augmented Generation) technology. Analyze code quality, generate insights, and conduct interactive discussions with repository data.

## 🎯 Overview

Code Eval Hub combines a modern Next.js frontend with a powerful FastAPI RAG backend to provide intelligent code analysis and evaluation. Users can:

- **Authenticate** securely with NextAuth
- **Explore repositories** and manage shared access
- **Generate summaries** of repository purpose and structure
- **Analyze contributors** with detailed contribution summaries
- **Generate evaluation questions** for code review
- **Chat interactively** with repository context using RAG

## 🏗️ Architecture

### Frontend (Next.js)
Located in `app/` directory with TypeScript and TailwindCSS styling.

**Key Features:**
- **Authentication**: NextAuth integration with secure login/signup
- **Dashboard**: Main hub for repository management and analysis
- **Chat Interface**: Real-time RAG-powered Q&A
- **Repository Management**: Browse, evaluate, and share repositories
- **Responsive UI**: TailwindCSS with HeroIcons

**Routes:**
- `/(auth)` - Login/Signup pages
- `/dashboard` - Main dashboard with chat and repo management
- `/api/auth` - NextAuth endpoints

### Backend (FastAPI + RAG)
Located in `rag-service/` directory with Python.

**Endpoints:**
- `POST /ingest` - Ingest and index a GitHub repository
- `POST /summarize` - Generate comprehensive repository summary
- `POST /contributor-summary` - Generate per-contributor analysis
- `POST /generate-questions` - Create evaluation questions for code review
- `POST /chat` - RAG-powered Q&A with repository context

## 📦 Tech Stack

### Frontend
- **Next.js** - React framework with App Router
- **TypeScript** - Type-safe development
- **TailwindCSS** - Utility-first CSS framework
- **NextAuth** - Authentication library
- **Prisma** - Database ORM
- **React Query** - Data fetching (via Zod validation)
- **HeroIcons** - Icon library

### Backend
- **FastAPI** - Modern Python web framework
- **LangChain** - LLM orchestration and RAG
- **FAISS** - Vector store for embeddings
- **Groq** - LLM API integration
- **PyGithub** - GitHub API client
- **HuggingFace** - Embedding models
- **Boto3** - AWS S3 integration for storage

### Database
- **PostgreSQL** - Primary database
- **Prisma** - Schema management and migrations

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm/pnpm
- Python 3.10+
- PostgreSQL database
- GitHub API token
- Groq API key

### Installation

#### Frontend Setup
```bash
# Install dependencies
pnpm install

# Set up environment variables
# Create .env.local with:
# - DATABASE_URL
# - NEXTAUTH_URL
# - NEXTAUTH_SECRET
# - GITHUB_ID
# - GITHUB_SECRET
# - RAG_SERVICE_URL

# Initialize database
npx prisma migrate deploy

# Run development server
pnpm dev
```

The frontend will be available at `http://localhost:3000`

#### Backend Setup
```bash
# Navigate to RAG service
cd rag-service

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set up environment variables
# Create .env with:
# - GROQ_API_KEY
# - GITHUB_TOKEN
# - VECTOR_STORE_PREFIX

# Run FastAPI server
uvicorn main:app --reload
```

The backend will be available at `http://localhost:8000`

## 📁 Project Structure

```
code-eval-hub/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Authentication pages
│   │   ├── login/
│   │   └── signup/
│   ├── api/                      # API routes
│   │   └── auth/[...nextauth]/
│   ├── dashboard/                # Dashboard pages
│   │   ├── (home)/               # Repository overview
│   │   ├── chat/                 # Chat interface
│   │   └── repos/                # Repository details
│   └── layout.tsx                # Root layout
├── lib/                          # Utilities & helpers
│   ├── actions.ts                # Server actions
│   ├── data.ts                   # Data fetching
│   ├── db.ts                     # Database client
│   ├── github.ts                 # GitHub API integration
│   ├── rag-client.ts             # RAG service client
│   ├── validate.ts               # Validation schemas
│   └── utils.ts                  # Utility functions
├── ui/                           # React components
│   ├── dashboard/                # Dashboard-specific components
│   │   ├── chat-history.tsx
│   │   ├── chat-section.tsx
│   │   ├── repo-evaluator.tsx
│   │   └── sidenav.tsx
│   ├── login-form.tsx
│   ├── signup-form.tsx
│   └── global.css                # Global styles
├── prisma/                       # Database schema
│   ├── schema.prisma
│   └── migrations/               # Database migrations
├── rag-service/                  # Python RAG backend
│   ├── main.py                   # FastAPI application
│   ├── config.py                 # Configuration
│   ├── github_loader.py          # GitHub data loading
│   ├── vector_store.py           # Vector store management
│   ├── rag_pipeline.py           # RAG chain building
│   └── requirements.txt          # Python dependencies
├── next.config.ts                # Next.js configuration
├── tailwind.config.ts            # TailwindCSS configuration
├── tsconfig.json                 # TypeScript configuration
└── package.json                  # Node.js dependencies
```

## 🔧 Configuration

### Environment Variables

**Frontend (.env.local):**
```
DATABASE_URL=postgresql://...
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<generate with: openssl rand -base64 32>
GITHUB_ID=<GitHub OAuth App ID>
GITHUB_SECRET=<GitHub OAuth App Secret>
RAG_SERVICE_URL=http://localhost:8000
```

**Backend (.env):**
```
GROQ_API_KEY=<Your Groq API key>
GITHUB_TOKEN=<GitHub Personal Access Token>
VECTOR_STORE_PREFIX=./vector_stores
```

## 🔄 Workflow

1. **User Authentication**: Login/signup via GitHub OAuth through NextAuth
2. **Repository Selection**: Browse and select GitHub repositories to analyze
3. **Data Ingestion**: Repository code is fetched, processed, and embedded
4. **Analysis**: Generate summaries and contributor insights
5. **Evaluation**: Create custom evaluation questions
6. **Interactive Chat**: Ask questions about the repository using RAG

## 📊 Database Schema

The Prisma schema tracks:
- **Users**: Authentication and profile info
- **Repositories**: Ingested repos with metadata
- **Contributors**: Per-contributor analysis data
- **Chat History**: Conversation history
- **Shared Access**: Repository sharing between users

Run `npx prisma studio` to view the database visually.

## 🛠️ Development

### Running Both Services
```bash
# Terminal 1: Frontend
pnpm dev

# Terminal 2: Backend
cd rag-service && uvicorn main:app --reload
```

### Linting
```bash
pnpm lint
```

### Building for Production
```bash
# Frontend
pnpm build
pnpm start

# Backend
gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app
```

## 📝 API Integration

The frontend communicates with the RAG backend via HTTP. Key integration points in `lib/rag-client.ts`:

- `ingestRepository()` - Ingest a new repository
- `generateSummary()` - Get repository summary
- `generateContributorSummary()` - Get contributor analysis
- `generateQuestions()` - Generate evaluation questions
- `chatWithRag()` - Query with RAG context

## 🔐 Security

- **Authentication**: Secured with NextAuth
- **API Routes**: Protected with authentication middleware
- **Environment Variables**: Never commit sensitive keys
- **Database**: Connections use environment variables
- **CORS**: Configured for frontend/backend communication

## 📈 Performance Optimizations

- **Vector Store Caching**: FAISS vector stores cached locally
- **Database Indexing**: Optimized Prisma queries
- **Component Lazy Loading**: Dashboard components load on demand
- **Debounced Search**: Search input uses debouncing to reduce API calls

## 🤝 Contributing

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Commit changes: `git commit -am 'Add feature'`
3. Push to branch: `git push origin feature/your-feature`
4. Open a Pull Request

## 📄 License

This project is part of an educational initiative for code evaluation and analysis.

## 🙋 Support

For issues and questions, please open an issue in the repository.
