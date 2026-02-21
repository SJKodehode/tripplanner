DO $$
BEGIN
  ALTER TYPE "app"."post_type" ADD VALUE 'CRAWL';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE "app"."feed_post_crawl_locations" (
  "feed_post_crawl_location_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "feed_post_id" UUID NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "location_name" VARCHAR(200) NOT NULL,
  "latitude" DECIMAL(9, 6),
  "longitude" DECIMAL(9, 6),
  "is_completed" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),

  CONSTRAINT "feed_post_crawl_locations_pkey" PRIMARY KEY ("feed_post_crawl_location_id"),
  CONSTRAINT "ck_feed_post_crawl_locations_sort_order" CHECK ("sort_order" >= 0),
  CONSTRAINT "ck_feed_post_crawl_locations_name_not_blank" CHECK (btrim("location_name") <> ''),
  CONSTRAINT "ck_feed_post_crawl_locations_coordinates"
    CHECK (
      ("latitude" IS NULL AND "longitude" IS NULL)
      OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
    )
);

CREATE TABLE "app"."feed_post_crawl_location_challenges" (
  "feed_post_crawl_location_challenge_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "feed_post_crawl_location_id" UUID NOT NULL,
  "author_user_id" UUID NOT NULL,
  "challenge_text" VARCHAR(500) NOT NULL,
  "is_completed" BOOLEAN NOT NULL DEFAULT false,
  "completed_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),

  CONSTRAINT "feed_post_crawl_location_challenges_pkey" PRIMARY KEY ("feed_post_crawl_location_challenge_id"),
  CONSTRAINT "ck_feed_post_crawl_location_challenges_text_not_blank" CHECK (btrim("challenge_text") <> ''),
  CONSTRAINT "ck_feed_post_crawl_location_challenges_completion_state"
    CHECK (
      ("is_completed" = TRUE AND "completed_by_user_id" IS NOT NULL)
      OR ("is_completed" = FALSE AND "completed_by_user_id" IS NULL)
    )
);

CREATE INDEX "ix_feed_post_crawl_locations_feed_post_id_sort_order"
  ON "app"."feed_post_crawl_locations"("feed_post_id", "sort_order", "created_at");

CREATE INDEX "ix_feed_post_crawl_location_challenges_location_id_created_at"
  ON "app"."feed_post_crawl_location_challenges"("feed_post_crawl_location_id", "created_at");

ALTER TABLE "app"."feed_post_crawl_locations"
  ADD CONSTRAINT "fk_feed_post_crawl_locations_post"
  FOREIGN KEY ("feed_post_id")
  REFERENCES "app"."feed_posts"("feed_post_id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "app"."feed_post_crawl_location_challenges"
  ADD CONSTRAINT "fk_feed_post_crawl_location_challenges_location"
  FOREIGN KEY ("feed_post_crawl_location_id")
  REFERENCES "app"."feed_post_crawl_locations"("feed_post_crawl_location_id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "app"."feed_post_crawl_location_challenges"
  ADD CONSTRAINT "fk_feed_post_crawl_location_challenges_author"
  FOREIGN KEY ("author_user_id")
  REFERENCES "app"."users"("user_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "app"."feed_post_crawl_location_challenges"
  ADD CONSTRAINT "fk_feed_post_crawl_location_challenges_completed_by"
  FOREIGN KEY ("completed_by_user_id")
  REFERENCES "app"."users"("user_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
