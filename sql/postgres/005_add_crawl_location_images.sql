/*
    Trip Planner (PostgreSQL)
    Migration 005: crawl location images.
*/

CREATE TABLE IF NOT EXISTS app.feed_post_crawl_location_images (
  crawl_location_image_id UUID NOT NULL DEFAULT gen_random_uuid(),
  feed_post_crawl_location_id UUID NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_feed_post_crawl_location_images PRIMARY KEY (crawl_location_image_id),
  CONSTRAINT ck_feed_post_crawl_location_images_sort_order CHECK (sort_order >= 0),
  CONSTRAINT fk_feed_post_crawl_location_images_location
    FOREIGN KEY (feed_post_crawl_location_id)
    REFERENCES app.feed_post_crawl_locations (feed_post_crawl_location_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_feed_post_crawl_location_images_location_id_sort_order
  ON app.feed_post_crawl_location_images (feed_post_crawl_location_id, sort_order, created_at);
