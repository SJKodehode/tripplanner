/*
    Trip Planner (PostgreSQL)
    Migration 006: trip group messages.
*/

CREATE TABLE IF NOT EXISTS app.trip_messages (
  trip_message_id UUID NOT NULL DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL,
  author_user_id UUID NOT NULL,
  message_body VARCHAR(2000) NOT NULL,
  created_at TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_trip_messages PRIMARY KEY (trip_message_id),
  CONSTRAINT ck_trip_messages_body_not_blank CHECK (btrim(message_body) <> ''),
  CONSTRAINT fk_trip_messages_trip
    FOREIGN KEY (trip_id)
    REFERENCES app.trips (trip_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_trip_messages_author
    FOREIGN KEY (author_user_id)
    REFERENCES app.users (user_id)
);

CREATE INDEX IF NOT EXISTS ix_trip_messages_trip_id_created_at
  ON app.trip_messages (trip_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_trip_messages_author_user_id_created_at
  ON app.trip_messages (author_user_id, created_at DESC);
