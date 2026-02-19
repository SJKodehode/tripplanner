-- DropForeignKey
ALTER TABLE "feed_comments" DROP CONSTRAINT "fk_feed_comments_author";

-- DropForeignKey
ALTER TABLE "feed_comments" DROP CONSTRAINT "fk_feed_comments_post";

-- DropForeignKey
ALTER TABLE "feed_post_challenges" DROP CONSTRAINT "fk_feed_post_challenges_author";

-- DropForeignKey
ALTER TABLE "feed_post_challenges" DROP CONSTRAINT "fk_feed_post_challenges_completed_by";

-- DropForeignKey
ALTER TABLE "feed_post_challenges" DROP CONSTRAINT "fk_feed_post_challenges_post";

-- DropForeignKey
ALTER TABLE "feed_post_challenges" DROP CONSTRAINT "fk_feed_post_challenges_tagged_user";

-- DropForeignKey
ALTER TABLE "feed_post_images" DROP CONSTRAINT "fk_feed_post_images_post";

-- DropForeignKey
ALTER TABLE "feed_posts" DROP CONSTRAINT "fk_feed_posts_author";

-- DropForeignKey
ALTER TABLE "feed_posts" DROP CONSTRAINT "fk_feed_posts_trip";

-- DropForeignKey
ALTER TABLE "feed_posts" DROP CONSTRAINT "fk_feed_posts_trip_day";

-- DropForeignKey
ALTER TABLE "post_votes" DROP CONSTRAINT "fk_post_votes_post";

-- DropForeignKey
ALTER TABLE "post_votes" DROP CONSTRAINT "fk_post_votes_user";

-- DropForeignKey
ALTER TABLE "trip_days" DROP CONSTRAINT "fk_trip_days_trip";

-- DropForeignKey
ALTER TABLE "trip_members" DROP CONSTRAINT "fk_trip_members_trip";

-- DropForeignKey
ALTER TABLE "trip_members" DROP CONSTRAINT "fk_trip_members_user";

-- DropForeignKey
ALTER TABLE "trips" DROP CONSTRAINT "fk_trips_created_by_user";

-- DropIndex
DROP INDEX "ux_users_email_not_null";

-- AlterTable
ALTER TABLE "feed_comments" RENAME CONSTRAINT "pk_feed_comments" TO "feed_comments_pkey";

-- AlterTable
ALTER TABLE "feed_post_challenges" RENAME CONSTRAINT "pk_feed_post_challenges" TO "feed_post_challenges_pkey";

-- AlterTable
ALTER TABLE "feed_post_images" RENAME CONSTRAINT "pk_feed_post_images" TO "feed_post_images_pkey";

-- AlterTable
ALTER TABLE "feed_posts" RENAME CONSTRAINT "pk_feed_posts" TO "feed_posts_pkey";

-- AlterTable
ALTER TABLE "trip_days" RENAME CONSTRAINT "pk_trip_days" TO "trip_days_pkey";

-- AlterTable
ALTER TABLE "trips" RENAME CONSTRAINT "pk_trips" TO "trips_pkey";

-- AlterTable
ALTER TABLE "users" RENAME CONSTRAINT "pk_users" TO "users_pkey";

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "fk_trips_created_by_user" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_members" ADD CONSTRAINT "fk_trip_members_trip" FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_members" ADD CONSTRAINT "fk_trip_members_user" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_days" ADD CONSTRAINT "fk_trip_days_trip" FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_posts" ADD CONSTRAINT "fk_feed_posts_trip" FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_posts" ADD CONSTRAINT "fk_feed_posts_trip_day" FOREIGN KEY ("trip_day_id") REFERENCES "trip_days"("trip_day_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_posts" ADD CONSTRAINT "fk_feed_posts_author" FOREIGN KEY ("author_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_post_challenges" ADD CONSTRAINT "fk_feed_post_challenges_post" FOREIGN KEY ("feed_post_id") REFERENCES "feed_posts"("feed_post_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_post_challenges" ADD CONSTRAINT "fk_feed_post_challenges_author" FOREIGN KEY ("author_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_post_challenges" ADD CONSTRAINT "fk_feed_post_challenges_tagged_user" FOREIGN KEY ("tagged_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_post_challenges" ADD CONSTRAINT "fk_feed_post_challenges_completed_by" FOREIGN KEY ("completed_by_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_comments" ADD CONSTRAINT "fk_feed_comments_post" FOREIGN KEY ("feed_post_id") REFERENCES "feed_posts"("feed_post_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_comments" ADD CONSTRAINT "fk_feed_comments_author" FOREIGN KEY ("author_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_votes" ADD CONSTRAINT "fk_post_votes_post" FOREIGN KEY ("feed_post_id") REFERENCES "feed_posts"("feed_post_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_votes" ADD CONSTRAINT "fk_post_votes_user" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_post_images" ADD CONSTRAINT "fk_feed_post_images_post" FOREIGN KEY ("feed_post_id") REFERENCES "feed_posts"("feed_post_id") ON DELETE CASCADE ON UPDATE CASCADE;
