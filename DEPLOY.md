# Deploy Alert Streamer

**Primary:** Vercel — FastAPI backend + Next.js frontend (auto-deploy on push to `main`).

Repository: [github.com/Darshan475/Alert-Streamer-Agent](https://github.com/Darshan475/Alert-Streamer-Agent)

---

## Vercel — Backend + Frontend (Recommended)

Deploy as **two Vercel projects** from the same GitHub repo.

### 1. Backend (FastAPI)

1. [Import repo](https://vercel.com/new) → set **Root Directory** to `backend`
2. Framework preset: **FastAPI** (auto-detected from `requirements.txt`)
3. Environment variables:

   ```
   GEMINI_API_KEY=your_key_from_aistudio.google.com/apikey
   LLM_PROVIDER=gemini
   SEED_DEMO_ALERTS=true
   CORS_ORIGINS=https://your-frontend.vercel.app,http://localhost:3000
   ```

4. Deploy — config lives in `backend/vercel.json` and `backend/pyproject.toml`

| URL | Purpose |
|-----|---------|
| `https://<backend-project>.vercel.app` | API + built-in dashboard |
| `https://<backend-project>.vercel.app/health` | Health check |

### 2. Frontend (Next.js)

1. [Import repo](https://vercel.com/new) → set **Root Directory** to `frontend`
2. Environment variable:

   ```
   NEXT_PUBLIC_API_URL=https://<backend-project>.vercel.app
   ```

3. Deploy — config lives in `frontend/vercel.json`

| URL | Purpose |
|-----|---------|
| `https://<frontend-project>.vercel.app` | React dashboard |

### 3. Wire CORS

After both deploys, copy the frontend URL into the backend `CORS_ORIGINS` env var and redeploy the backend.

**Auto-deploy:** connect both projects to GitHub — every push to `main` redeploys both.

### CLI deploy

```powershell
# Backend
cd backend
vercel link
vercel env pull   # optional — sync env vars
vercel deploy --prod

# Frontend (set NEXT_PUBLIC_API_URL to backend URL first)
cd frontend
vercel link
vercel deploy --prod
```

---

## Render — alternative backend

1. Go to **[Render Blueprint](https://dashboard.render.com/select-repo?type=blueprint)**
2. Connect GitHub → **`Darshan475/Alert-Streamer-Agent`**
3. Creates **`alert-streamer`** — Python FastAPI (API + dashboard)
4. Add environment variables:

   ```
   GEMINI_API_KEY=your_key_from_aistudio.google.com/apikey
   LLM_PROVIDER=gemini
   CORS_ORIGINS=https://your-frontend.vercel.app
   ```

Auto-deploy: every push to `main` redeploys (see `render.yaml`).

---

## Railway — alternative backend

1. Go to **[Railway](https://railway.app/new)** → Deploy from GitHub → **`Darshan475/Alert-Streamer-Agent`**
2. Set **Root Directory** to `backend`
3. Uses `backend/railway.toml` for start command and health check.

---

## Docker (local)

```powershell
docker compose up --build
```

Open **http://localhost:8000**

---

## Environment variables

| Variable | Required | Example |
|----------|----------|---------|
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | For live LLM (default) | from [AI Studio](https://aistudio.google.com/apikey) |
| `LLM_PROVIDER` | Optional | `gemini` (default) |
| `LLM_API_KEY` / `HF_TOKEN` | Other providers | `sk-or-v1-...` or `hf_...` |
| `ALERT_STREAMER_API_KEY` | Yes | set in Vercel/Render dashboard |
| `CORS_ORIGINS` | Yes for split deploy | `https://your-frontend.vercel.app,http://localhost:3000` |
| `NEXT_PUBLIC_API_URL` | Frontend only | `https://your-backend.vercel.app` |
| `SEED_DEMO_ALERTS` | Optional | `true` — auto-load demo alerts when store is empty |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Empty dashboard / no alerts | In-memory store clears on cold start | `SEED_DEMO_ALERTS=true` (default) or run `python scripts/trigger_alerts.py` |
| Chat shows HTTP 429 | Gemini free-tier quota exceeded | Switch to **Offline** or **OpenRouter/Groq** in the LLM dropdown; add a new API key |
| Frontend can't reach API | Wrong `NEXT_PUBLIC_API_URL` or CORS | Match frontend env to backend URL; add Vercel frontend URL to backend `CORS_ORIGINS` |
| Vercel backend timeout | LLM investigation slow | `maxDuration: 60` is set in `backend/vercel.json` |

---

## Test

```powershell
curl https://<backend-project>.vercel.app/health
python scripts/trigger_alerts.py
```

Open the dashboard URL in your browser.
