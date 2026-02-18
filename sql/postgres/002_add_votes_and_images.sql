/*
    Trip Planner (PostgreSQL)
    Migration 002: post votes + post images.
*/

CREATE TABLE IF NOT EXISTS app.post_votes (
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

CREATE TABLE IF NOT EXISTS app.feed_post_images (
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

CREATE INDEX IF NOT EXISTS ix_post_votes_user_id
  ON app.post_votes (user_id);

CREATE INDEX IF NOT EXISTS ix_feed_post_images_feed_post_id_sort_order
  ON app.feed_post_images (feed_post_id, sort_order, created_at);
