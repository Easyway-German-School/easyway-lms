# Easyway LMS Prototype

This repository contains the Easyway LMS prototype app inside the `prototype/` folder.

## Status

- ✅ The LMS code in `prototype/` is ready to upload to GitHub.
- ✅ It includes Next.js 16 + React 19, Prisma/SQLite, NextAuth, and local AI support.
- ✅ Ollama integration is supported with both HTTP and CLI fallback in `prototype/src/lib/ai.ts`.

## Getting started

Open a terminal in `prototype/`:

```bash
cd prototype
npm install
```

Create a local environment file by copying `.env` to `.env.local` and updating the real values.

### Required `.env.local` values

```env
DATABASE_URL="file:./prisma/dev.db"
NEXTAUTH_SECRET="your-secret-key-change-in-production"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_URL_INTERNAL="http://127.0.0.1:3000"
OLLAMA_BASE_URL="http://localhost:11434"
OLLAMA_MODEL="mistral:small"
OPENAI_API_KEY="sk-placeholder-add-your-key"
DEEPSEEK_API_KEY="sk-placeholder-add-your-key"
STRIPE_SECRET_KEY="sk_test_placeholder-add-your-key"
STRIPE_PUBLISHABLE_KEY="pk_test_placeholder-add-your-key"
AZURE_SPEECH_KEY="placeholder-add-your-key"
AZURE_SPEECH_REGION="eastus"
```

## Local database setup

```bash
cd prototype
npx prisma db push
```

This will create the SQLite file at `prototype/prisma/dev.db`.

## Run locally

```bash
cd prototype
npm run dev
```

Then open `http://localhost:3000`.

## Build and production run (Windows)

On Windows, use `NEXT_DISABLE_TURBOPACK=1` if you hit Turbopack issues:

```powershell
cd prototype
set "NEXT_DISABLE_TURBOPACK=1" && npm run build
set "NEXT_DISABLE_TURBOPACK=1" && npm start
```

## Ollama local AI setup

1. Install Ollama from https://ollama.ai/install
2. Ensure the `ollama` binary is available on your PATH.
3. Confirm a model is available, for example:

```bash
ollama run mistral:latest
```

### Recommended Ollama environment variables

```env
OLLAMA_BASE_URL="http://localhost:11434"
OLLAMA_MODEL="mistral:small"
```

## How the app uses Ollama

- `prototype/src/lib/ai.ts` prefers local Ollama by environment variable.
- If the standard HTTP endpoint shape is unavailable, the code falls back to the Ollama CLI using `ollama run <model> ...`.
- This makes local Ollama support more robust.

## Notes before uploading

- Do not commit `.env.local` or `.env` with real secrets.
- `.gitignore` already excludes `.env*`, `.next/`, and build artifacts.
- If you want a clean repo upload, keep the app folder contents in `prototype/` and omit local database files and secrets.
