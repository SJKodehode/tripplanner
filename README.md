# Trip Planner (Dublin)

React + Vite frontend with a Node API connected to PostgreSQL via Prisma.

## What Is Included

- HeroUI v3 feed-style trip planner UI
- Create trip / join trip by code flow
- Day tabs with posts:
  - Suggestion
  - Event (`fromTime`/`toTime`)
  - Pinpoint (place or lat/lng)
- Comments on each feed post
- Legacy MSSQL schema in `sql/001_create_tripplanner_schema.sql`
- PostgreSQL SQL schema in `sql/postgres/`
- Prisma schema and migration in `prisma/`
- API server in `server/index.mjs`

## Environment

Copy `.env.example` to `.env` and set values:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/tripplanner?schema=app"
API_PORT=3001
VITE_API_BASE_URL=http://localhost:3001
```

`DATABASE_URL` is used by Prisma for both CLI and runtime API access.
The API supports:
- `postgres://...` and `postgresql://...` via Prisma Postgres adapter.
- `prisma://...` and `prisma+postgres://...` via Prisma Accelerate.

## Install

```bash
npm install
```

If Prisma is not installed yet:

```bash
npm install prisma @prisma/client
```

## Prisma/PostgreSQL Migration

Use one of these options:

Option A: Prisma migration (recommended)

```bash
npx prisma migrate deploy
npx prisma generate
```

Option B: Run converted SQL directly

```bash
psql "$DATABASE_URL" -f sql/postgres/001_create_tripplanner_schema.sql
psql "$DATABASE_URL" -f sql/postgres/002_add_votes_and_images.sql
```

For `psql`, use a standard PostgreSQL connection string, not `prisma+postgres://`.

## Run

Terminal 1:

```bash
npm run dev:api
```

Terminal 2:

```bash
npm run dev
```

## Build Frontend

```bash
npm run build
```

## Auto Deploy To Ubuntu (GitHub Actions)

This repo includes:
- `.github/workflows/deploy.yml`
- `scripts/deploy-remote.sh`
- `scripts/bootstrap-ubuntu.sh`
- `ecosystem.config.cjs` (runs API + frontend concurrently with PM2)

One-time setup on the Ubuntu server:

```bash
sudo apt-get update
sudo apt-get install -y git rsync
git clone <your-repo-url> /var/www/tripplanner
cd /var/www/tripplanner
chmod +x scripts/bootstrap-ubuntu.sh
./scripts/bootstrap-ubuntu.sh
```

GitHub repo secrets required:
- `DEPLOY_HOST` (server IP or domain)
- `DEPLOY_USER` (ssh user, for example `ubuntu`)
- `DEPLOY_PORT` (usually `22`)
- `DEPLOY_PATH` (remote path, for example `/var/www/tripplanner`)
- `DEPLOY_SSH_PRIVATE_KEY` (private key that matches your server authorized key)
- `DEPLOY_ENV_FILE` (full `.env` file content)

Push to `main` to deploy automatically.
The workflow syncs files, writes `.env`, runs Prisma migrations, builds frontend, and reloads PM2.

Useful server commands:

```bash
pm2 status
pm2 logs tripplanner-api
pm2 logs tripplanner-web
```

## API Endpoints

- `GET /api/health`
- `GET /api/trips/:tripId`
- `POST /api/trips`
- `POST /api/trips/join`
- `POST /api/trips/:tripId/posts`
- `POST /api/posts/:postId/comments`
