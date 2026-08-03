# Alert Streamer Agent — Agentic AI Project

Real-time alert ingestion pipeline with **NVIDIA Nemotron** LLM investigation, validation, deduplication, priority assignment, team routing, and a **Next.js** dashboard with enquiry chatbot.

## Architecture

```
Monitoring Systems → FastAPI /ingest → Pipeline → LangGraph Agent → Nemotron LLM
                                           ↓
                                    Next.js Dashboard (SWR cache)
                                           ↓
                                    Chatbot Enquiry API
```

### Pipeline Stages

1. **Ingest** — Receive JSON alert payload
2. **Validate** — Required fields check
3. **Deduplicate** — Fingerprint-based suppression (1h TTL)
4. **Prioritize** — P1–P5 based on severity + category
5. **Assign Team** — Platform, SRE, Database, Security, Payments, etc.
6. **Investigate** — LangGraph → Nemotron root cause analysis
7. **Resolve** — Recommendations available in dashboard

## Project Structure

```
Agentic_AI_Project/
├── backend/                 # Python FastAPI + LangGraph
│   ├── app/
│   │   ├── api/             # REST endpoints
│   │   ├── models/          # Pydantic schemas
│   │   └── services/        # Pipeline, LLM, investigation, chat
│   └── scripts/             # Dummy data + trigger utilities
├── frontend/                # Next.js 16 + TypeScript + Tailwind
│   └── src/
│       ├── components/      # Dashboard UI
│       ├── hooks/           # SWR data fetching (cached)
│       └── lib/             # API client + types
└── data/                    # Generated dummy alerts JSON
```

## Prerequisites

- Python 3.11+
- Node.js 20+
- NVIDIA API key from [build.nvidia.com](https://build.nvidia.com)

## Quick Start

### 1. Backend Setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Edit `backend/.env`:

```env
NVIDIA_API_KEY=your_key_from_build_nvidia_com
NVIDIA_MODEL=nvidia/nemotron-3-super-120b-a12b
# Or your 175B Coder model ID:
# NVIDIA_MODEL=nvidia/nemotron-3-super-175b-a13b-coder-nvfp4

ALERT_STREAMER_API_KEY=dev-secret-change-in-production
```

Start the API:

```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Verify: http://localhost:8000/health

### 2. Generate Dummy Alerts

```powershell
cd backend
python scripts/generate_dummy_alerts.py
```

This creates `data/dummy_alerts.json` with 10 realistic alert types:

| Alert Type | Example |
|---|---|
| CPU > 95% | api-gateway CPU critical |
| Memory Leak | order-processor heap growth |
| Disk Full | log-aggregator 98% |
| Pod Crash | payment-worker CrashLoopBackOff |
| Database Timeout | PostgreSQL pool exhausted |
| API Latency | checkout P99 > SLA |
| SSL Certificate Expiring | api.example.com cert |
| Kubernetes Node Down | gke-prod-pool NotReady |
| High Error Rate | user-service 18% 5xx |
| Payment Service Unavailable | Stripe webhook 503 |

Includes **1 duplicate** alert to test deduplication.

### 3. Trigger Dummy Alerts (Local Test)

```powershell
cd backend
python scripts/trigger_alerts.py
```

Options:

```powershell
python scripts/trigger_alerts.py --delay 1000          # 1s between alerts
python scripts/trigger_alerts.py --url http://localhost:8000
python scripts/trigger_alerts.py -f ../data/dummy_alerts.json
```

### 4. Frontend Dashboard

```powershell
cd frontend
copy .env.local.example .env.local
npm install
npm run dev
```

Open: http://localhost:3000

## API Reference

### Ingest Alert (requires API key)

```http
POST /api/v1/alerts/ingest
X-API-Key: dev-secret-change-in-production
Content-Type: application/json

{
  "source": "prometheus",
  "alert_type": "cpu_high",
  "title": "CPU usage exceeds 95%",
  "description": "Sustained high CPU on api-gateway",
  "severity": "critical",
  "service": "api-gateway",
  "environment": "production",
  "metric_value": 97.3,
  "threshold": 95.0
}
```

### List Alerts

```http
GET /api/v1/alerts?status=investigating&team=sre&limit=50
```

### Chat Enquiry

```http
POST /api/v1/chat
{"message": "What is the root cause?", "alert_id": "uuid-here"}
```

### Manual cURL Test

```powershell
curl -X POST http://localhost:8000/api/v1/alerts/ingest `
  -H "X-API-Key: dev-secret-change-in-production" `
  -H "Content-Type: application/json" `
  -d "{\"source\":\"prometheus\",\"alert_type\":\"cpu_high\",\"title\":\"CPU > 95%\",\"description\":\"High CPU\",\"severity\":\"critical\",\"service\":\"api-gateway\",\"environment\":\"production\"}"
```

## Security Features

- **API key auth** on alert ingestion (`X-API-Key` header)
- **Pydantic validation** on all inputs
- **CORS** restricted to configured origins
- **Rate limiting** ready (SlowAPI integrated)
- **No secrets in code** — all via `.env`

## LLM Configuration

Uses NVIDIA NIM OpenAI-compatible API:

| Setting | Default |
|---|---|
| Base URL | `https://integrate.api.nvidia.com/v1` |
| Model | Configurable via `NVIDIA_MODEL` |
| Framework | LangGraph (linear investigate graph) |

**Offline mode**: Without `NVIDIA_API_KEY`, the system runs with rule-based fallback responses so you can test the full pipeline locally.

## Dashboard Features

- Real-time alert stream (SWR polling + cache)
- Pipeline flow visualization per alert
- Investigation results from Nemotron
- Stats cards (total, investigating, resolved, teams)
- **Chatbot** for alert enquiry with context when an alert is selected

## Troubleshooting

| Issue | Fix |
|---|---|
| `401 Unauthorized` on ingest | Set `X-API-Key` header matching `ALERT_STREAMER_API_KEY` |
| Dashboard shows connection error | Ensure backend is running on port 8000 |
| LLM shows "Offline mode" | Add valid `NVIDIA_API_KEY` to `backend/.env` |
| Duplicate alerts rejected | Expected — dedup window is 1 hour |
| CORS errors | Add frontend URL to `CORS_ORIGINS` in backend `.env` |

## License

MIT — Agentic AI Project
