# Trip Planner (Dublin)

React + Vite frontend with a Node API connected to MSSQL.

## What Is Included

- HeroUI v3 feed-style trip planner UI
- Create trip / join trip by code flow
- Day tabs with posts:
  - Suggestion
  - Event (`fromTime`/`toTime`)
  - Pinpoint (place or lat/lng)
- Comments on each feed post
- SQL schema in `sql/001_create_tripplanner_schema.sql`
- API server in `server/index.mjs`

## Environment

Copy `.env.example` to `.env` and set values:

```env
MSSQL_CONNECTION_STRING="Server=localhost;Database=TripPlannerDb;Trusted_Connection=True;TrustServerCertificate=True;"
API_PORT=3001
VITE_API_BASE_URL=http://localhost:3001
```

## Install

```bash
npm install
```

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

## API Endpoints

- `GET /api/health`
- `GET /api/trips/:tripId`
- `POST /api/trips`
- `POST /api/trips/join`
- `POST /api/trips/:tripId/posts`
- `POST /api/posts/:postId/comments`

