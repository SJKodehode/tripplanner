CREATE SCHEMA IF NOT EXISTS app;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE TYPE app.member_role AS ENUM ('OWNER', 'MEMBER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE app.post_type AS ENUM ('SUGGESTION', 'EVENT', 'PIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE app.users (
  user_id UUID NOT NULL DEFAULT gen_random_uuid(),
  display_name VARCHAR(120) NOT NULL,
  email VARCHAR(255),
  created_at TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ(0),

  CONSTRAINT pk_users PRIMARY KEY (user_id)
);

CREATE UNIQUE INDEX ux_users_email_not_null
  ON app.users (email)
  WHERE email IS NOT NULL;

CREATE TABLE app.trips (
  trip_id UUID NOT NULL DEFAULT gen_random_uuid(),
  join_code CHAR(8) NOT NULL,
  trip_name VARCHAR(120) NOT NULL,
  destination_name VARCHAR(200) NOT NULL,
  start_date DATE,
  day_count INTEGER NOT NULL,
  created_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,

  CONSTRAINT pk_trips PRIMARY KEY (trip_id),
  CONSTRAINT uq_trips_join_code UNIQUE (join_code),
  CONSTRAINT ck_trips_day_count CHECK (day_count BETWEEN 1 AND 60),
  CONSTRAINT ck_trips_join_code_chars CHECK (join_code ~ '^[A-Z0-9]{8}$'),
  CONSTRAINT fk_trips_created_by_user
    FOREIGN KEY (created_by_user_id)
    REFERENCES app.users (user_id)
);

CREATE TABLE app.trip_members (
  trip_id UUID NOT NULL,
  user_id UUID NOT NULL,
  member_role app.member_role NOT NULL DEFAULT 'MEMBER',
  joined_at TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  CONSTRAINT pk_trip_members PRIMARY KEY (trip_id, user_id),
  CONSTRAINT fk_trip_members_trip
    FOREIGN KEY (trip_id)
    REFERENCES app.trips (trip_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_trip_members_user
    FOREIGN KEY (user_id)
    REFERENCES app.users (user_id)
);

CREATE TABLE app.trip_days (
  trip_day_id UUID NOT NULL DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL,
  day_number INTEGER NOT NULL,
  trip_date DATE,
  label VARCHAR(80),
  created_at TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_trip_days PRIMARY KEY (trip_day_id),
  CONSTRAINT uq_trip_days_trip_id_day_number UNIQUE (trip_id, day_number),
  CONSTRAINT ck_trip_days_day_number CHECK (day_number BETWEEN 1 AND 60),
  CONSTRAINT fk_trip_days_trip
    FOREIGN KEY (trip_id)
    REFERENCES app.trips (trip_id)
    ON DELETE CASCADE
);

CREATE TABLE app.feed_posts (
  feed_post_id UUID NOT NULL DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL,
  trip_day_id UUID,
  author_user_id UUID NOT NULL,
  post_type app.post_type NOT NULL,
  title VARCHAR(200),
  body TEXT,
  event_name VARCHAR(200),
  from_time TIME(0),
  to_time TIME(0),
  location_name VARCHAR(200),
  latitude DECIMAL(9, 6),
  longitude DECIMAL(9, 6),
  created_at TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,

  CONSTRAINT pk_feed_posts PRIMARY KEY (feed_post_id),
  CONSTRAINT ck_feed_posts_event_times
    CHECK (
      post_type <> 'EVENT'
      OR (
        event_name IS NOT NULL
        AND from_time IS NOT NULL
        AND to_time IS NOT NULL
        AND to_time > from_time
      )
    ),
  CONSTRAINT ck_feed_posts_event_day
    CHECK (post_type <> 'EVENT' OR trip_day_id IS NOT NULL),
  CONSTRAINT ck_feed_posts_pin_coordinates
    CHECK (
      (latitude IS NULL AND longitude IS NULL)
      OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
    ),
  CONSTRAINT ck_feed_posts_pin_payload
    CHECK (
      post_type <> 'PIN'
      OR (location_name IS NOT NULL OR (latitude IS NOT NULL AND longitude IS NOT NULL))
    ),
  CONSTRAINT fk_feed_posts_trip
    FOREIGN KEY (trip_id)
    REFERENCES app.trips (trip_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_feed_posts_author
    FOREIGN KEY (author_user_id)
    REFERENCES app.users (user_id),
  CONSTRAINT fk_feed_posts_trip_day
    FOREIGN KEY (trip_day_id)
    REFERENCES app.trip_days (trip_day_id)
);

CREATE TABLE app.feed_comments (
  feed_comment_id UUID NOT NULL DEFAULT gen_random_uuid(),
  feed_post_id UUID NOT NULL,
  author_user_id UUID NOT NULL,
  comment_body VARCHAR(2000) NOT NULL,
  created_at TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,

  CONSTRAINT pk_feed_comments PRIMARY KEY (feed_comment_id),
  CONSTRAINT ck_feed_comments_body_not_blank CHECK (btrim(comment_body) <> ''),
  CONSTRAINT fk_feed_comments_post
    FOREIGN KEY (feed_post_id)
    REFERENCES app.feed_posts (feed_post_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_feed_comments_author
    FOREIGN KEY (author_user_id)
    REFERENCES app.users (user_id)
);

CREATE INDEX ix_trip_members_user_id
  ON app.trip_members (user_id);

CREATE INDEX ix_feed_posts_trip_id_created_at
  ON app.feed_posts (trip_id, created_at DESC);

CREATE INDEX ix_feed_posts_trip_day_id_created_at
  ON app.feed_posts (trip_day_id, created_at DESC);

CREATE INDEX ix_feed_comments_feed_post_id_created_at
  ON app.feed_comments (feed_post_id, created_at DESC);

CREATE TABLE app.post_votes (
  feed_post_id UUID NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_post_votes PRIMARY KEY (feed_post_id, user_id),
  CONSTRAINT fk_post_votes_post
    FOREIGN KEY (feed_post_id)
    REFERENCES app.feed_posts (feed_post_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_post_votes_user
    FOREIGN KEY (user_id)
    REFERENCES app.users (user_id)
);

CREATE TABLE app.feed_post_images (
  post_image_id UUID NOT NULL DEFAULT gen_random_uuid(),
  feed_post_id UUID NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_feed_post_images PRIMARY KEY (post_image_id),
  CONSTRAINT ck_feed_post_images_sort_order CHECK (sort_order >= 0),
  CONSTRAINT fk_feed_post_images_post
    FOREIGN KEY (feed_post_id)
    REFERENCES app.feed_posts (feed_post_id)
    ON DELETE CASCADE
);

CREATE INDEX ix_post_votes_user_id
  ON app.post_votes (user_id);

CREATE INDEX ix_feed_post_images_feed_post_id_sort_order
  ON app.feed_post_images (feed_post_id, sort_order, created_at);
