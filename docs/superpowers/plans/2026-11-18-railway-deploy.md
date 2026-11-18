# Railway Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the whole app (built dashboard + backend + Telegram + SQLite) as one container on Railway, with data on a persistent volume.

**Architecture:** One Docker image built from the repo root. The image installs all workspace deps, builds the frontend with Vite, and runs the backend with `tsx`. The backend already serves `frontend/dist` through `@fastify/static` (`backend/src/api/server.ts`), so there is no second service. SQLite lives at `data/1mbot.sqlite` (`DB_PATH` default, resolved from repo root), which is mounted as a Railway volume at `/app/data`.

**Tech Stack:** Docker (`node:24-slim`), Node 24 (built-in `node:sqlite`, no native addons), npm workspaces, Vite, tsx, Fastify, Railway.

**Spec:** None. Decisions come from the conversation: Railway chosen over Fly/Oracle; Vercel dropped.

## Global Constraints

- Node 22.5+ is required for `node:sqlite`; the image uses Node 24.
- Only `HOST=0.0.0.0` is allowed in production; the default `127.0.0.1` makes the app unreachable from Railway's proxy.
- `DASHBOARD_TOKEN` must be set before the public URL is shared.
- `LIVE_TRADING_ENABLED` stays `false`.
- Secrets (`TG_*`, `*_API_KEY`, `DASHBOARD_TOKEN`) are set only as Railway variables, never committed.
- Do not commit `.env`, `data/`, or `node_modules/`.

## Review Focus

1. Railway restarts the container: the SQLite file and Telegram session must survive on the volume, not the container layer.
2. `PORT` is injected by Railway; the app must listen on it, not on 8787.
3. `npm start` runs `tsx` from a devDependency; a production-only install would crash at boot.
4. Startup with no `.env` file (Railway has none): `env.ts` already tolerates this; the container must not fail on it.
5. Telegram with `TG_API_ID` unset: the bot must start in a degraded mode, not crash the dashboard.

---

### Task 1: Dockerfile and ignore rules

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Consumes: root `package.json` `start` script (`npm run build -w frontend && npm start -w backend`).
- Produces: image that listens on `process.env.PORT` and serves the dashboard at `/`.

- [ ] **Step 1: Write `.dockerignore`**

Exclude `node_modules`, `data`, `.env`, `frontend/dist`, `.git`, `docs`. Reason: local artifacts must not leak into the image, and `.env` must never be baked in.

- [ ] **Step 2: Write `Dockerfile`**

- `FROM node:24-slim`, `WORKDIR /app`
- Copy `package.json`, `package-lock.json`, `backend/package.json`, `frontend/package.json`; run `npm ci` (full install including devDependencies, because `tsx` and `vite` are devDependencies).
- Copy the rest of the source.
- `ENV NODE_ENV=production HOST=0.0.0.0`
- `CMD ["npm", "start"]`

- [ ] **Step 3: Verify the image builds**

Run: `docker build -t 1mbot .`
Expected: build completes; the `vite build` step prints `dist` output for the frontend.

- [ ] **Step 4: Verify the container serves the dashboard**

Run: `docker run --rm -e PORT=8787 -p 8787:8787 1mbot` then in another shell `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/`
Expected: `200`. The `/ws` route should accept an upgrade (check logs for no crash at boot).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build: add Dockerfile for Railway deploy"
```

---

### Task 2: Railway project configuration

**Files:**
- None in repo. Configuration lives in the Railway UI.

**Interfaces:**
- Consumes: Task 1 image (Railway builds from `Dockerfile` automatically).
- Produces: public URL of the running service, with the volume mounted.

- [ ] **Step 1: Create the service**

Railway → New Project → Deploy from GitHub repo `andriihukco/hesoyam`. Railway detects the `Dockerfile`.

- [ ] **Step 2: Add a volume**

Service → Volumes → mount path `/app/data`. Default `DB_PATH=data/1mbot.sqlite` resolves to `/app/data/1mbot.sqlite`; no `DB_PATH` override needed.

- [ ] **Step 3: Set variables**

- `HOST=0.0.0.0`
- `PORT=${{PORT}}` (Railway's reference variable; or leave unset, Railway injects `PORT`)
- `DASHBOARD_TOKEN=<openssl rand -hex 32>` (bootstrap token; after Settings → Security → Rotate token now, the rotated token replaces it and this one stops working)
- Lock-out recovery: set `DASHBOARD_TOKEN_RESET=1`, redeploy, log in with `DASHBOARD_TOKEN`, rotate again, then delete `DASHBOARD_TOKEN_RESET` (while it is set, every restart clears the rotated token)
- `TG_API_ID`, `TG_API_HASH`, `TG_SESSION`, `TG_FOLDER_LINKS`, `TG_CHANNELS`, `TG_AUTO_JOIN` copied from local `.env`
- `RPC_ENDPOINTS`, `PUMPPORTAL_WS_URL`, `PUMPPORTAL_API_KEY`, `JUPITER_API_URL`, `JUPITER_API_KEY`, `RUGCHECK_API_URL`, `DEXSCREENER_API_URL` as needed
- `LIVE_TRADING_ENABLED=false`
- Hard limits (phase 1+; read-only in the dashboard, agents cannot change them): `AGENT_LIVE_ENABLED=false`, `LIVE_MAX_BUY_SOL`, `LIVE_MAX_DAILY_LOSS_SOL`, `LIVE_MAX_OPEN`, `LIVE_CANARY_BUY_SOL`, `LIVE_ROLLBACK_LOSS_SOL` (leave empty until the live engine exists)
- `GEMINI_API_KEY`, `GEMINI_MODEL` (phase 4 advisor; set as a Railway secret, never in the repo)

The signal recorder (phase 1) writes `signal_paths` / `signal_facts` into the same SQLite file on the volume, so it keeps collecting replay data 24/7 once deployed.

- [ ] **Step 4: Generate a public domain**

Service → Settings → Networking → Generate Domain.

- [ ] **Step 5: Verify**

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://<railway-domain>/`
Expected: `200`. Open the dashboard; it asks for the token; after entering `DASHBOARD_TOKEN` the state loads over `/ws`.

- [ ] **Step 6: Verify persistence**

Redeploy the service (Railway → Deployments → Redeploy). After it comes back, confirm the mentions/positions from before are still listed.
Expected: data preserved. If empty, the volume is not mounted at `/app/data`; fix Task 2 Step 2.

---

### Task 3: Remove Vercel project

**Files:** none.

- [ ] **Step 1:** Vercel dashboard → project `hesoyam-chi` → Settings → Delete Project.
- [ ] **Step 2:** Verify `https://hesoyam-chi.vercel.app` returns a not-found error (expected after deletion).
