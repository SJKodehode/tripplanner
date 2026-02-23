-- DropForeignKey
ALTER TABLE "app"."feed_comments" DROP CONSTRAINT IF EXISTS "fk_feed_comments_author";

-- DropForeignKey
ALTER TABLE "app"."feed_comments" DROP CONSTRAINT IF EXISTS "fk_feed_comments_post";

-- DropForeignKey
ALTER TABLE "app"."feed_post_challenges" DROP CONSTRAINT IF EXISTS "fk_feed_post_challenges_author";

-- DropForeignKey
ALTER TABLE "app"."feed_post_challenges" DROP CONSTRAINT IF EXISTS "fk_feed_post_challenges_completed_by";

-- DropForeignKey
ALTER TABLE "app"."feed_post_challenges" DROP CONSTRAINT IF EXISTS "fk_feed_post_challenges_post";

-- DropForeignKey
ALTER TABLE "app"."feed_post_challenges" DROP CONSTRAINT IF EXISTS "fk_feed_post_challenges_tagged_user";

-- DropForeignKey
ALTER TABLE "app"."feed_post_images" DROP CONSTRAINT IF EXISTS "fk_feed_post_images_post";

-- DropForeignKey
ALTER TABLE "app"."feed_posts" DROP CONSTRAINT IF EXISTS "fk_feed_posts_author";

-- DropForeignKey
ALTER TABLE "app"."feed_posts" DROP CONSTRAINT IF EXISTS "fk_feed_posts_trip";

-- DropForeignKey
ALTER TABLE "app"."feed_posts" DROP CONSTRAINT IF EXISTS "fk_feed_posts_trip_day";

-- DropForeignKey
ALTER TABLE "app"."post_votes" DROP CONSTRAINT IF EXISTS "fk_post_votes_post";

-- DropForeignKey
ALTER TABLE "app"."post_votes" DROP CONSTRAINT IF EXISTS "fk_post_votes_user";

-- DropForeignKey
ALTER TABLE "app"."trip_days" DROP CONSTRAINT IF EXISTS "fk_trip_days_trip";

-- DropForeignKey
ALTER TABLE "app"."trip_members" DROP CONSTRAINT IF EXISTS "fk_trip_members_trip";

-- DropForeignKey
ALTER TABLE "app"."trip_members" DROP CONSTRAINT IF EXISTS "fk_trip_members_user";

-- DropForeignKey
ALTER TABLE "app"."trips" DROP CONSTRAINT IF EXISTS "fk_trips_created_by_user";

-- DropIndex
DROP INDEX IF EXISTS "app"."ux_users_email_not_null";

-- AlterTable
DO $$
DECLARE
  row_record RECORD;
BEGIN
  FOR row_record IN
    SELECT *
    FROM (VALUES
      ('feed_comments', 'pk_feed_comments', 'feed_comments_pkey'),
      ('feed_post_challenges', 'pk_feed_post_challenges', 'feed_post_challenges_pkey'),
      ('feed_post_images', 'pk_feed_post_images', 'feed_post_images_pkey'),
      ('feed_posts', 'pk_feed_posts', 'feed_posts_pkey'),
      ('trip_days', 'pk_trip_days', 'trip_days_pkey'),
      ('trips', 'pk_trips', 'trips_pkey'),
      ('users', 'pk_users', 'users_pkey')
    ) AS t(table_name, old_name, new_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class table_ref ON table_ref.oid = c.conrelid
      JOIN pg_namespace schema_ref ON schema_ref.oid = table_ref.relnamespace
      WHERE schema_ref.nspname = 'app'
        AND table_ref.relname = row_record.table_name
        AND c.conname = row_record.old_name
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class table_ref ON table_ref.oid = c.conrelid
      JOIN pg_namespace schema_ref ON schema_ref.oid = table_ref.relnamespace
      WHERE schema_ref.nspname = 'app'
        AND table_ref.relname = row_record.table_name
        AND c.conname = row_record.new_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE "app".%I RENAME CONSTRAINT %I TO %I',
        row_record.table_name,
        row_record.old_name,
        row_record.new_name
      );
    END IF;
  END LOOP;
END $$;

-- AddForeignKey
ALTER TABLE "app"."trips" ADD CONSTRAINT "fk_trips_created_by_user" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."trip_members" ADD CONSTRAINT "fk_trip_members_trip" FOREIGN KEY ("trip_id") REFERENCES "app"."trips"("trip_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."trip_members" ADD CONSTRAINT "fk_trip_members_user" FOREIGN KEY ("user_id") REFERENCES "app"."users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."trip_days" ADD CONSTRAINT "fk_trip_days_trip" FOREIGN KEY ("trip_id") REFERENCES "app"."trips"("trip_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."feed_posts" ADD CONSTRAINT "fk_feed_posts_trip" FOREIGN KEY ("trip_id") REFERENCES "app"."trips"("trip_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."feed_posts" ADD CONSTRAINT "fk_feed_posts_trip_day" FOREIGN KEY ("trip_day_id") REFERENCES "app"."trip_days"("trip_day_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."feed_posts" ADD CONSTRAINT "fk_feed_posts_author" FOREIGN KEY ("author_user_id") REFERENCES "app"."users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."feed_post_challenges" ADD CONSTRAINT "fk_feed_post_challenges_post" FOREIGN KEY ("feed_post_id") REFERENCES "app"."feed_posts"("feed_post_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."feed_post_challenges" ADD CONSTRAINT "fk_feed_post_challenges_author" FOREIGN KEY ("author_user_id") REFERENCES "app"."users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."feed_post_challenges" ADD CONSTRAINT "fk_feed_post_challenges_tagged_user" FOREIGN KEY ("tagged_user_id") REFERENCES "app"."users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."feed_post_challenges" ADD CONSTRAINT "fk_feed_post_challenges_completed_by" FOREIGN KEY ("completed_by_user_id") REFERENCES "app"."users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."feed_comments" ADD CONSTRAINT "fk_feed_comments_post" FOREIGN KEY ("feed_post_id") REFERENCES "app"."feed_posts"("feed_post_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."feed_comments" ADD CONSTRAINT "fk_feed_comments_author" FOREIGN KEY ("author_user_id") REFERENCES "app"."users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."post_votes" ADD CONSTRAINT "fk_post_votes_post" FOREIGN KEY ("feed_post_id") REFERENCES "app"."feed_posts"("feed_post_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."post_votes" ADD CONSTRAINT "fk_post_votes_user" FOREIGN KEY ("user_id") REFERENCES "app"."users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."feed_post_images" ADD CONSTRAINT "fk_feed_post_images_post" FOREIGN KEY ("feed_post_id") REFERENCES "app"."feed_posts"("feed_post_id") ON DELETE CASCADE ON UPDATE CASCADE;

