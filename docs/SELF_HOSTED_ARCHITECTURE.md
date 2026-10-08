# OpenSynapse Self-Hosted Architecture

This document describes the self-hosted architecture of OpenSynapse after migrating from Firebase to a fully self-hosted solution.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Browser)                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  React + Vite Frontend                                      │ │
│  │  - better-auth client (JWT-based auth)                     │ │
│  │  - dataApi service (REST API calls)                        │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP / REST API
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Express Server                            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  better-auth handler (/api/auth/*)                         │ │
│  │  Data API routes (/api/*)                                  │ │
│  │  AI API routes (/api/ai/*)                                 │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌────────────────────┐ ┌──────────────┐ ┌─────────────────────┐
│   PostgreSQL       │ │   ChromaDB   │ │   External AI APIs  │
│  (User data,       │ │  (Vector     │ │  (Gemini, OpenAI,   │
│   sessions, notes, │ │   search)    │ │   MiniMax, etc.)    │
│   flashcards)      │ │              │ │                     │
└────────────────────┘ └──────────────┘ └─────────────────────┘
```

## Components

### 1. Authentication (better-auth)

- **Location**: `src/auth/server.ts`, `src/auth/client.ts`
- **Technology**: better-auth with Drizzle ORM adapter
- **Storage**: PostgreSQL (sessions and users tables)
- **Features**:
  - JWT-based session management
  - Email/password authentication
  - Social login (Google, GitHub, Discord)
  - Bearer token support for API access

### 2. Database (PostgreSQL)

- **Technology**: PostgreSQL 14+
- **ORM**: Drizzle ORM
- **Schema**: `src/db/schema.ts`
- **Tables**:
  - `user` - User accounts (managed by better-auth)
  - `session` - Session tokens (managed by better-auth)
  - `notes` - Knowledge notes
  - `flashcards` - FSRS-based flashcards
  - `chat_sessions` - Chat conversation metadata
  - `chat_messages` - Chat message content
  - `api_keys` - User-level API keys for AI providers
  - `custom_personas` - User-defined AI personas

### 3. Vector Database (ChromaDB)

- **Location**: `src/vector/chroma.ts`
- **Technology**: ChromaDB (local embedding storage)
- **Purpose**: Semantic search for notes
- **Storage**: Docker named volume `chroma_data` mounted at `/data` (default); project `./data/chroma` only for the manual local CLI alternative.

### 4. API Layer

- **Data API**: `src/api/data.ts` - CRUD operations for user data
- **AI API**: `src/api/ai.ts` - AI provider routing
- **Auth Handler**: `src/auth/server.ts` - better-auth endpoints

### 5. Frontend

- **Main App**: `src/App.tsx` - Updated to use better-auth
- **Auth Hook**: `src/hooks/useAuth.ts` - React hook for auth state
- **Data Service**: `src/services/dataApi.ts` - API client

## Environment Variables

Create a `.env.local` file:

```bash
# Required
DATABASE_URL=postgresql://user:password@localhost:5432/opensynapse
JWT_SECRET=your-super-secret-jwt-key-min-32-characters-long
CHROMA_URL=http://127.0.0.1:8000

# Optional - AI Provider API Keys (global fallbacks)
GEMINI_API_KEY=your_gemini_key
OPENAI_API_KEY=your_openai_key
MINIMAX_API_KEY=your_minimax_key
ZHIPU_API_KEY=your_zhipu_key
MOONSHOT_API_KEY=your_moonshot_key

# Optional - OAuth Providers (for social login)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
```

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup PostgreSQL

```bash
# Using Homebrew (macOS)
brew install postgresql@14
brew services start postgresql@14

# Create database
createdb opensynapse
```

### 3. Run Database Migrations

```bash
# Generate and apply migrations
npx drizzle-kit generate
npx drizzle-kit migrate
```

### 4. Setup ChromaDB

Chroma runs as a separate HTTP service. The application uses `ChromaClient` and may create collections on demand, but does not start a Chroma server. From the project root, after configuring `.env.local`:

```bash
# Inspect and back up existing Chroma data before changing an old mount.
docker compose up -d chroma
docker compose ps chroma
node --env-file=.env.local --import tsx --input-type=module -e 'import { vectorStore } from "./src/vector/chroma.ts"; const result = await vectorStore.healthCheck(); console.log(result); if (!result.healthy) process.exitCode = 1;'
```

Docker uses `chromadb/chroma:1.5.5`, persisting to the `chroma_data` named volume at `/data`. This command only starts Chroma; an existing PostgreSQL installation is unaffected. The port is bound to `127.0.0.1:8000` for the host application managed by PM2.

For the manual alternative, install `chromadb==1.5.5` in a Python 3.12 virtual environment, activate it, and run `npm run chroma` from the project root. This stores data in `./data/chroma`. Both modes use `CHROMA_URL=http://127.0.0.1:8000`; stop one before starting the other. Their data is independent, with no automatic switching or synchronization. `CHROMA_PATH`, if used as a legacy alias, must also be an HTTP URL, never a filesystem path.

The server explicitly loads `.env.local` in both development and production. See the [deployment guide](DEPLOYMENT_GUIDE.md#chroma-运维与本机备用) for installation, old-volume inspection, backup, and restore.

### 5. Start the Server

```bash
npm run dev
```

The application will be available at `http://localhost:3000`.

## Data Migration from Firebase

Firebase migration is complete. The former migration tool is retained in [scripts/archive](../scripts/archive/README.md) for historical reference and is excluded from daily type checking. It is not part of the current setup or deployment process.

## API Endpoints

### Authentication (better-auth)

All auth endpoints are handled by better-auth at `/api/auth/*`:

- `POST /api/auth/sign-in/email` - Email/password login
- `POST /api/auth/sign-in/social` - Social login
- `POST /api/auth/sign-out` - Logout
- `GET /api/auth/session` - Get current session

### Data API

All endpoints require authentication (via cookie or bearer token):

**Notes**:
- `GET /api/notes` - List all notes
- `POST /api/notes` - Create a note
- `PUT /api/notes/:id` - Update a note
- `DELETE /api/notes/:id` - Delete a note
- `GET /api/notes/search?q=query` - Search notes

**Flashcards**:
- `GET /api/flashcards` - List all flashcards
- `GET /api/flashcards/due` - List due flashcards
- `POST /api/flashcards` - Create a flashcard
- `PUT /api/flashcards/:id` - Update a flashcard
- `POST /api/flashcards/:id/review` - Review a flashcard
- `DELETE /api/flashcards/note/:noteId` - Delete flashcards by note

**Chat Sessions**:
- `GET /api/chat-sessions` - List all sessions
- `POST /api/chat-sessions` - Create a session
- `PUT /api/chat-sessions/:id` - Update a session
- `DELETE /api/chat-sessions/:id` - Delete a session

**API Keys**:
- `GET /api/api-keys` - Get user's API keys
- `PUT /api/api-keys` - Update API keys

## Directory Structure

```
OpenSynapse/
├── src/
│   ├── auth/                    # better-auth configuration
│   │   ├── server.ts            # Server-side auth config
│   │   └── client.ts            # Client-side auth client
│   ├── db/                      # Database layer
│   │   ├── index.ts             # PostgreSQL connection
│   │   └── schema.ts            # Drizzle ORM schema
│   ├── repositories/            # Data access layer
│   │   ├── note.repo.ts
│   │   ├── flashcard.repo.ts
│   │   ├── chat.repo.ts
│   │   └── apiKey.repo.ts
│   ├── vector/                  # ChromaDB vector store
│   │   └── chroma.ts
│   ├── api/                     # API routes
│   │   ├── ai.ts
│   │   └── data.ts
│   ├── services/                # Business logic
│   │   ├── dataApi.ts           # Frontend data API client
│   │   └── gemini.ts
│   └── components/
│       └── auth/
│           ├── LoginSelection.tsx
│           └── AuthCallback.tsx
├── scripts/
│   └── archive/                 # Historical tools, excluded from daily type checking
│       └── migrate-firestore-to-postgres.ts
├── data/                        # Local data storage
│   └── chroma/                  # Manual local CLI data only (Docker uses a named volume)
└── .env.local                   # Environment variables
```

## Security Considerations

1. **JWT Secret**: Use a strong, randomly generated secret (32+ characters)
2. **Database**: Use SSL connections in production
3. **API Keys**: Stored per-user, encrypted at rest
4. **Session**: Configured with 7-day expiration, 1-day update interval
5. **CORS**: Configure appropriately for your deployment

## Production Deployment

For production deployment:

1. Use a managed PostgreSQL service (AWS RDS, Google Cloud SQL, etc.)
2. Set up proper SSL/TLS certificates
3. Configure environment variables securely
4. Set up a reverse proxy (nginx, Caddy)
5. Use a process manager (PM2, systemd)
6. Enable backups for PostgreSQL and ChromaDB

## Troubleshooting

### Database Connection Issues

```bash
# Check PostgreSQL is running
pg_isready -h localhost -p 5432

# Test connection
psql $DATABASE_URL -c "SELECT 1"
```

### ChromaDB Issues

```bash
# Inspect the default Docker service without deleting data
docker compose ps chroma
docker compose logs --tail=100 chroma
```

Chroma unavailability retains the existing keyword-only RAG fallback. PostgreSQL must still be available. Do not delete data as a troubleshooting step; see the deployment guide for backups.

### Authentication Issues

- Check `JWT_SECRET` is set and at least 32 characters
- Verify database migrations are applied
- Check browser console for auth errors

## Migration from Firebase

See the [archive notes](../scripts/archive/README.md) for the historical migration tool and requirements for any future reuse.

## License

Apache-2.0
