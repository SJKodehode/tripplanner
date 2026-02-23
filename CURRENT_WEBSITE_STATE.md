# TripPlanner Website: Current State (As Implemented)

## 1) Scope and Snapshot

This document describes the current web application implemented in this repository (`c:\dev\tripplanner`) as of February 23, 2026.

Current product shape:
- Single-page React web app (Vite) for collaborative trip planning.
- Node/Express API server in the same repo.
- PostgreSQL database via Prisma (`app` schema).
- Auth0 bearer-token auth for all `/api/*` routes except health.
- Google Places autocomplete for destination/location text inputs.


## 2) Architecture

### Frontend
- Framework: React 19 + TypeScript (`src/App.tsx`).
- Build/dev: Vite (`vite.config.ts`, scripts in `package.json`).
- UI kit: HeroUI v3 + Tailwind CSS v4 (`@heroui/react`, `@heroui/styles`).
- Auth SDK: `@auth0/auth0-react`.
- Maps SDK: `@vis.gl/react-google-maps` (Places library).

### Backend
- Runtime: Node + Express (`server/index.mjs`).
- ORM: Prisma Client with PostgreSQL adapter (`@prisma/client`, `@prisma/adapter-pg`).
- Uploads: `multer` to disk, static served from `/uploads`.
- Auth verification: `jose` JWT verification against Auth0 JWKS.

### Data
- Primary schema: Prisma models in `prisma/schema.prisma`.
- Active DB schema: PostgreSQL `app` schema.
- SQL scripts exist for both PostgreSQL (`sql/postgres`) and legacy MSSQL (`sql/` root).


## 3) Environment Variables in Use

### Frontend (`import.meta.env`)
- `VITE_API_BASE_URL`
- `VITE_GOOGLE_MAPS_API_KEY`
- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_AUDIENCE`

### Backend (`process.env`)
- `DATABASE_URL`
- `API_PORT`
- `AUTH0_DOMAIN` (fallback from `VITE_AUTH0_DOMAIN`)
- `AUTH0_ISSUER_BASE_URL`
- `AUTH0_AUDIENCE` (fallback from `VITE_AUTH0_AUDIENCE`)

Notes:
- API rejects startup if issuer config is missing.
- API supports `postgres://`, `postgresql://`, `prisma://`, `prisma+postgres://`.


## 4) User-Facing Features (Current)

## 4.1 Authentication and Session
- Auth0 login/logout flow.
- Token-based API auth (`Authorization: Bearer <token>`).
- Session sync endpoint (`POST /api/auth/session`) maps Auth0 user to internal `users` row and returns joined trips.
- Display name can be edited and saved.

## 4.2 Trip Entry and Access
- Entry modal (“Trip Access”) shows:
  - list of joined trips
  - open saved active trip
  - join by 8-character code
  - create new trip

## 4.3 Trip Creation
- Inputs: trip name, destination, start date, day count.
- Frontend day-count limit: 1–14.
- Backend day-count limit: 1–60.
- On create, creator becomes owner and trip days are pre-generated.

## 4.4 Dashboard and Day Tabs
- Per-day tabs (`Day 1...N`) backed by `trip_days`.
- Trip meta shown: group name, destination, date range, join code.
- Supports switching/opening any joined trip from modal.

## 4.5 Feed Posts
- Composer supports two types:
  - `SUGGESTION`
  - `EVENT`
- Post fields:
  - title/body
  - optional location text
  - optional time window (required for events)
  - multiple image upload (max 6, each <= 8MB)
- Feed per selected day:
  - post cards
  - event details and location text
  - images (opens full image URL)
  - comments
  - votes
  - challenges

## 4.6 Comments
- Add comments per post.
- Comments display author + body.

## 4.7 Votes
- One vote per user per post (idempotent upsert).
- Vote count and voter display names are shown.
- UI disables vote button once user has voted.

## 4.8 Challenges
- Add challenge to a post with optional tagged member.
- Toggle completed/uncompleted state.
- Max challenges per post: 3.
- Completion stores who checked it off.

## 4.9 Deletion / Archiving
- Post deletion:
  - backend allows author or trip owner
  - implemented as soft delete (`feed_posts.is_deleted = true`)
- Trip deletion:
  - owner-only
  - implemented as archive (`trips.is_archived = true`)
  - trip members set inactive (`trip_members.is_active = false`)


## 5) API Surface (Current)

- `GET /api/health` (no bearer token required)
- `POST /api/auth/session`
- `GET /api/trips/:tripId`
- `POST /api/trips`
- `POST /api/trips/join`
- `POST /api/trips/:tripId/posts` (multipart images)
- `POST /api/posts/:postId/comments`
- `POST /api/posts/:postId/challenges`
- `PATCH /api/posts/:postId/challenges/:challengeId/toggle`
- `POST /api/posts/:postId/votes`
- `DELETE /api/posts/:postId`
- `DELETE /api/trips/:tripId`

All `/api/*` routes except `/api/health` require valid Auth0 bearer token and issuer (and optional audience) validation.


## 6) Data Model: Every Active Table Used

The backend currently reads/writes these PostgreSQL tables (schema `app`):
- `users`
- `trips`
- `trip_members`
- `trip_days`
- `feed_posts`
- `feed_comments`
- `post_votes`
- `feed_post_images`
- `feed_post_challenges`

### 6.1 `app.users`
Purpose:
- Application user profile mapped from Auth0 identity.

Important columns:
- `user_id` (PK, UUID)
- `display_name`
- `email` (nullable; unique when non-null)
- `created_at`
- `last_seen_at`

Used by:
- auth/session sync
- author/member lookup for posts/comments/challenges/votes

### 6.2 `app.trips`
Purpose:
- Trip board metadata and lifecycle.

Important columns:
- `trip_id` (PK)
- `join_code` (unique, 8-char)
- `trip_name`
- `destination_name`
- `start_date`
- `day_count`
- `created_by_user_id`
- `is_archived`
- timestamps

Used by:
- create trip
- join by code
- fetch trip
- list joined trips
- archive trip

### 6.3 `app.trip_members`
Purpose:
- Membership and roles for each trip.

Important columns:
- (`trip_id`, `user_id`) composite PK
- `member_role` (`OWNER`/`MEMBER`)
- `is_active`
- `joined_at`

Used by:
- authorization checks (member/owner)
- join flow
- trip archive deactivation

### 6.4 `app.trip_days`
Purpose:
- Canonical day rows for each trip.

Important columns:
- `trip_day_id` (PK)
- `trip_id`
- `day_number` (unique per trip)
- `trip_date`
- `label`

Used by:
- trip creation (pre-populated day rows)
- per-day tab/feed mapping
- post day assignment

### 6.5 `app.feed_posts`
Purpose:
- Main planning feed entries.

Important columns:
- `feed_post_id` (PK)
- `trip_id`, `trip_day_id`
- `author_user_id`
- `post_type` (`SUGGESTION`, `EVENT`, `PIN` enum in DB)
- `title`, `body`
- `event_name`, `from_time`, `to_time`
- `location_name`, `latitude`, `longitude`
- `is_deleted`
- timestamps

Used by:
- create/fetch posts
- delete post (soft delete)
- vote/challenge/comment parent checks

### 6.6 `app.feed_comments`
Purpose:
- Comments on posts.

Important columns:
- `feed_comment_id` (PK)
- `feed_post_id`
- `author_user_id`
- `comment_body`
- `is_deleted`
- timestamps

Used by:
- create/fetch comments

### 6.7 `app.post_votes`
Purpose:
- One user vote per post.

Important columns:
- (`feed_post_id`, `user_id`) composite PK
- `created_at`

Used by:
- vote upsert
- vote count + voter names

### 6.8 `app.feed_post_images`
Purpose:
- Image attachments for posts.

Important columns:
- `post_image_id` (PK)
- `feed_post_id`
- `image_url`
- `sort_order`
- `created_at`

Used by:
- post creation with file uploads
- feed rendering of image galleries

### 6.9 `app.feed_post_challenges`
Purpose:
- Post-level challenge/checklist items.

Important columns:
- `feed_post_challenge_id` (PK)
- `feed_post_id`
- `author_user_id`
- `tagged_user_id` (nullable)
- `challenge_text`
- `is_completed`
- `completed_by_user_id` (nullable; paired with completion state)
- timestamps

Used by:
- create challenge
- toggle completion
- feed rendering of challenge list


## 7) Business Rules and Limits (Implemented)

- Join code: exactly 8 uppercase alphanumeric chars.
- Trip name required, destination required.
- Day count:
  - frontend: 1–14
  - backend: 1–60
- Post types accepted by API: `SUGGESTION`, `EVENT`.
- Suggestion post must have title or body or at least one image.
- Event post requires event name, start time, end time, and `end > start`.
- Suggestion with time requires both start and end, and `end > start`.
- Image uploads:
  - max 6 files
  - max 8MB each
  - image mime types only
- Challenge text required, max length 500.
- Challenges per post max: 3.
- Comment body required.
- Only trip members can post/comment/vote/challenge.
- Only author or owner can delete a post.
- Only owner can delete (archive) a trip.


## 8) Frontend State and Persistence

Local storage keys:
- `tripplanner:active-trip-id:v1`
- `tripplanner:user-id:v1`
- `tripplanner:display-name:v1`
- `tripplanner:username:v1`

Stored frontend state includes:
- active trip ID
- user/display names
- selected day
- drafts for composer/comments/challenges
- modal open states


## 9) Current Functional Gaps / Notable Observations

- Database enum includes `PIN`, but API currently only accepts `SUGGESTION` and `EVENT`.
- `AddressPicker` supports lat/lng selection, but current post creation sends empty `latitude`/`longitude`; location is effectively text-only right now.
- Frontend only shows delete button on event posts, while backend delete permission supports deleting any post type.
- Frontend day-count max (14) is stricter than backend/database max (60).
- `.env.example` currently contains two `DATABASE_URL` entries; one appears to be a concrete credential-like value and should be reviewed/rotated.


## 10) Files That Define Current Behavior

- Frontend app/UI logic: `src/App.tsx`
- Frontend API client and payload normalization: `src/api.ts`
- Shared frontend types: `src/types.ts`
- Google Places input component: `src/components/AddressPicker.tsx`
- App bootstrap (Auth0 + Maps providers): `src/main.tsx`
- API server and business rules: `server/index.mjs`
- Prisma models (source of truth): `prisma/schema.prisma`
- PostgreSQL SQL bootstrap/migrations: `sql/postgres/*.sql`

