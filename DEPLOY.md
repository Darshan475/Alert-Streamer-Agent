# Deploy Alert Streamer — Full End-to-End

Deploy **backend (FastAPI)** + **frontend (Next.js)** to the cloud.

Repository: [github.com/Darshan475/Alert-Streamer-Agent](https://github.com/Darshan475/Alert-Streamer-Agent)

---

## Option A — Render (Recommended, Free Tier)

Deploy both services with one click from GitHub.

### Steps

1. Go to **[Render Blueprint](https://dashboard.render.com/select-repo?type=blueprint)**
2. Connect GitHub account → select **`Darshan475/Alert-Streamer-Agent`**
3. Render reads `render.yaml` and creates:
   - `alert-streamer-api` — Python FastAPI backend
   - `alert-streamer-web` — Next.js dashboard
4. In Render dashboard → **alert-streamer-api** → **Environment**, add:
   ```
   HF_TOKEN=hf_your_token_here
   LLM_PROVIDER=huggingface
   ```
5. Click **Apply** and wait ~5–10 min for both services to go live.

### Your live URLs

| Service | URL |
|---------|-----|
| Dashboard | `https://alert-streamer-web.onrender.com` |
| API | `https://alert-streamer-api.onrender.com` |
| Health | `https://alert-streamer-api.onrender.com/health` |

> Free tier sleeps after 15 min idle — first request may take ~30s to wake up.

### Access your deployed app

1. Open **[Render Dashboard](https://dashboard.render.com/)** → your services list
2. Click **alert-streamer-web** → copy the URL at the top (usually `https://alert-streamer-web.onrender.com`)
3. Click **alert-streamer-api** → check **Logs** if the dashboard cannot reach the API

### Automate deploy (push → live)

Render auto-deploys when you push to `main` (enabled via `autoDeploy: true` in `render.yaml`):

1. Render Dashboard → each service → **Settings** → confirm **Auto-Deploy** is **Yes**
2. Ensure GitHub is connected: **Settings** → **Build & Deploy** → **Branch** = `main`
3. Every `git push origin main` triggers:
   - **GitHub Actions** — validates backend + frontend build
   - **Render** — rebuilds and redeploys both services

Manual redeploy: Render Dashboard → service → **Manual Deploy** → **Deploy latest commit**.

---

## Option B — Vercel (Frontend) + Render (Backend)

Best performance for the dashboard.

### Backend on Render

1. [Render New Web Service](https://dashboard.render.com/create?type=web)
2. Connect repo → set **Root Directory**: `backend`
3. **Build**: `pip install -r requirements.txt`
4. **Start**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Add env vars:
   ```
   HF_TOKEN=hf_...
   LLM_PROVIDER=huggingface
   ALERT_STREAMER_API_KEY=<strong-secret>
   CORS_ORIGINS=https://your-app.vercel.app
   ```

### Frontend on Vercel

1. Go to **[vercel.com/new](https://vercel.com/new)**
2. Import **`Darshan475/Alert-Streamer-Agent`**
3. Set **Root Directory**: `frontend`
4. Add environment variable:
   ```
   NEXT_PUBLIC_API_URL=https://alert-streamer-api.onrender.com
   ```
5. Deploy

---

## Option C — Docker (Local or VPS)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```powershell
# Copy and configure secrets first
copy backend\.env.example backend\.env
# Edit backend\.env with HF_TOKEN

docker compose up --build
```

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3000 |
| API | http://localhost:8000 |

---

## Required Environment Variables

### Backend (`alert-streamer-api`)

| Variable | Required | Example |
|----------|----------|---------|
| `HF_TOKEN` or `LLM_API_KEY` | Yes (for AI) | `hf_...` |
| `LLM_PROVIDER` | Yes | `huggingface` |
| `ALERT_STREAMER_API_KEY` | Yes | auto-generated on Render |
| `CORS_ORIGINS` | Yes | frontend URL (auto in Blueprint) |

### Frontend (`alert-streamer-web`)

| Variable | Required | Example |
|----------|----------|---------|
| `NEXT_PUBLIC_API_URL` | Yes | `https://alert-streamer-api.onrender.com` |

---

## Test After Deploy

```powershell
# Health check
curl https://alert-streamer-api.onrender.com/health

# Ingest test alert
curl -X POST https://alert-streamer-api.onrender.com/api/v1/alerts/ingest `
  -H "X-API-Key: YOUR_ALERT_STREAMER_API_KEY" `
  -H "Content-Type: application/json" `
  -d '{"source":"prometheus","alert_type":"cpu_high","title":"CPU > 95%","description":"High CPU","severity":"critical","service":"api-gateway","environment":"production"}'
```

Open your dashboard URL → filter **Needs Review** → approve alerts.

---

## CI/CD

GitHub Actions (`.github/workflows/deploy.yml`) runs on every push to `main`:
- Validates backend imports
- Builds frontend

Render auto-deploys when connected to GitHub (enable in Render service settings).

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Blank dashboard | Check `NEXT_PUBLIC_API_URL` points to live API |
| CORS error | Set `CORS_ORIGINS` to exact frontend URL |
| API slow first request | Render free tier cold start — normal |
| LLM offline | Add `HF_TOKEN` to backend env on Render |
