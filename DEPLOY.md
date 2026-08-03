# Deploy Alert Streamer

**Primary:** single FastAPI service (API + built-in dashboard at `/`).

**Optional:** `frontend/` Next.js app can still be deployed separately if you prefer React.

Repository: [github.com/Darshan475/Alert-Streamer-Agent](https://github.com/Darshan475/Alert-Streamer-Agent)

---

## Render — FastAPI only (Recommended)

1. Go to **[Render Blueprint](https://dashboard.render.com/select-repo?type=blueprint)**
2. Connect GitHub → **`Darshan475/Alert-Streamer-Agent`**
3. Creates **`alert-streamer`** — Python FastAPI (API + dashboard)
4. Add environment variables:
   ```
   GEMINI_API_KEY=your_key_from_aistudio.google.com/apikey
   LLM_PROVIDER=gemini
   ```
5. Wait ~5–10 min.

| URL | Purpose |
|-----|---------|
| `https://alert-streamer.onrender.com` | Dashboard + API |
| `https://alert-streamer.onrender.com/health` | Health check |

Auto-deploy: every push to `main` redeploys (see `render.yaml`).

---

## Optional — Next.js on Vercel + API on Render

If you want the React dashboard from `frontend/`:

1. Deploy backend to Render (above)
2. Deploy `frontend/` to [Vercel](https://vercel.com/new) with root directory `frontend`
3. Set `NEXT_PUBLIC_API_URL=https://alert-streamer.onrender.com`
4. Set backend `CORS_ORIGINS` to your Vercel URL

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
| `ALERT_STREAMER_API_KEY` | Yes | auto on Render |
| `CORS_ORIGINS` | Optional | `http://localhost:8000,http://localhost:3000` |

---

## Test

```powershell
curl https://alert-streamer.onrender.com/health
python scripts/trigger_alerts.py
```

Open the dashboard URL in your browser.
