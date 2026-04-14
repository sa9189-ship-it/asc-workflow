# ASC Workflow

AI-powered consulting platform that turns a client meeting into a pitch deck, financial model, and VC shortlist in under 60 seconds.

## What it does

1. **Intake** (`/new.html`) — Fill in company details or paste a Fireflies transcript. Claude extracts any missing fields automatically.
2. **Generation** — Three outputs produced in parallel: a 10-slide pitch deck, a 3-scenario financial model (base/bear/bull), and a scored VC shortlist matched by stage, sector, check size, and geography.
3. **Review board** (`/?slug=<company>`) — Approve, revise with natural-language instructions, or export each output independently.
4. **Dashboard** (`/dashboard.html`) — Overview of all active cases with approval status and export state.

## Running locally

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# 3. Start the server
npm start
# → http://localhost:3000
```

For development with auto-reload:
```bash
npm run dev
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | Anthropic API key — get it at console.anthropic.com |
| `FIREFLIES_WEBHOOK_SECRET` | No | Webhook secret for Fireflies meeting integration |
| `PORT` | No | Server port — Railway sets this automatically (default: 3000) |

## Deploying to Railway

### First deploy

1. Push this repo to GitHub.
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
3. Select the repo. Railway auto-detects Node via `railway.json` and runs `npm install && node server.js`.
4. Open **Settings → Variables** and add:
   - `ANTHROPIC_API_KEY` — your Anthropic key
   - `FIREFLIES_WEBHOOK_SECRET` — if using Fireflies
5. Railway assigns a public URL (e.g. `asc-workflow.up.railway.app`). The app is live.

### Connecting a custom domain (asquareconsultancy.us)

1. In your Railway project → **Settings → Networking → Custom Domain**.
2. Enter `asquareconsultancy.us` (or a subdomain like `workflow.asquareconsultancy.us`).
3. Railway shows a CNAME target — copy it.
4. In your DNS provider, add a CNAME record:
   - **Host:** `@` (apex) or `workflow` (subdomain)
   - **Value:** the CNAME target from Railway
5. DNS propagates in under 5 minutes. Railway provisions SSL automatically.

### Subsequent deploys

Push to the GitHub main branch — Railway redeploys automatically.

### Persistent storage

Railway's filesystem is ephemeral: `outputs/` is wiped on each redeploy. To persist generated files:

1. In Railway → your service → **Volumes** → **Add Volume**.
2. Mount path: `/app/outputs`

## Tech stack

- **Runtime:** Node.js 20+ / Express 5
- **AI:** Anthropic Claude (`claude-sonnet-4-6`) via `@anthropic-ai/sdk`
- **File handling:** Multer (multipart uploads)
- **Frontend:** Vanilla JS + custom CSS (no build step)

## Project structure

```
├── server.js              # Express entry point
├── src/
│   ├── routes/            # intake, generate, extract, outputs, cases, webhooks
│   ├── extraction/        # extractContext() — Claude Stage 2
│   └── generation/        # deck, model, vcMatcher — Claude Stage 3
├── public/                # index.html, new.html, dashboard.html, app.js, nav.js, style.css
├── data/vcs.csv           # VC database (name, firm, stage, sector, check size, geo)
└── outputs/<slug>/        # Per-company versioned JSON drafts + export/
```
