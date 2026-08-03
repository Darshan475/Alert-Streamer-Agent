# Alert Streamer Agent — Agentic AI Project

Real-time alert ingestion pipeline with multi-provider LLM investigation, human-in-the-loop review (P1/P2), and a **FastAPI-served dashboard**.

## Architecture

```
Monitoring Systems → FastAPI /ingest → Pipeline → LangGraph Agent → LLM
                                           ↓
                              Dashboard at / (same FastAPI app)
                                           ↓
                                    Chatbot Enquiry API
```

### Pipeline Stages

1. **Ingest** — Receive JSON alert payload
2. **Validate** — Required fields check
3. **Deduplicate** — Fingerprint-based suppression (1h TTL)
4. **Prioritize** — P1–P5 based on severity + category
5. **Assign Team** — Platform, SRE, Database, Security, Payments, etc.
6. **Investigate** — LangGraph LLM root cause analysis
7. **Human Review** — P1/P2 only; P3+ auto-resolve
8. **Resolve** — Closed with recommendations

## Project Structure

```
Agentic_AI_Project/
├── backend/
│   ├── app/
│   │   ├── api/             # REST endpoints
│   │   ├── static/          # Built-in dashboard (HTML/CSS/JS)
│   │   ├── models/
│   │   └── services/
│   └── scripts/
├── frontend/                # Optional Next.js dashboard (kept)
└── data/                    # Dummy alerts JSON
```

## Quick Start

### 1. Setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Edit `backend/.env` with your LLM token (see `.env.example`).

### 2. Run

```powershell
uvicorn app.main:app --reload --port 8000
```

Open **http://localhost:8000** — dashboard and API on one port.

Health check: http://localhost:8000/health

### 3. Ingest test alerts

```powershell
python scripts/trigger_alerts.py
```

## LLM Providers

Configure in `.env` or switch in the dashboard dropdown:

| Provider | Env |
|----------|-----|
| OpenRouter (free default) | `LLM_API_KEY` |
| Groq | `LLM_API_KEY` |
| Hugging Face | `HF_TOKEN` |
| Offline | No key needed |

## Optional — Next.js frontend

The `frontend/` folder is kept for the React/Next.js dashboard. To use it locally:

```powershell
# Terminal 1 — backend (required)
cd backend
uvicorn app.main:app --reload --port 8000

# Terminal 2 — Next.js UI (optional)
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000** (Next.js) or **http://localhost:8000** (built-in FastAPI dashboard).

Set in `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Deploy

See [DEPLOY.md](DEPLOY.md) for Render one-click deploy.

## License

MIT — Agentic AI Project
