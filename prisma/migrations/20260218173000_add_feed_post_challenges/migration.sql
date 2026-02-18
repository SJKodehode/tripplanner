CREATE TABLE app.feed_post_challenges (
  feed_post_challenge_id UUID NOT NULL DEFAULT gen_random_uuid(),
  feed_post_id UUID NOT NULL,
  author_user_id UUID NOT NULL,
  tagged_user_id UUID,
  challenge_text VARCHAR(500) NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_by_user_id UUID,
  created_at TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(0) NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_feed_post_challenges PRIMARY KEY (feed_post_challenge_id),
  CONSTRAINT ck_feed_post_challenges_text_not_blank CHECK (btrim(challenge_text) <> ''),
  CONSTRAINT ck_feed_post_challenges_completion_state
    CHECK (
      (is_completed = TRUE AND completed_by_user_id IS NOT NULL)
      OR (is_completed = FALSE AND completed_by_user_id IS NULL)
    ),
  CONSTRAINT fk_feed_post_challenges_post
    FOREIGN KEY (feed_post_id)
    REFERENCES app.feed_posts (feed_post_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_feed_post_challenges_author
    FOREIGN KEY (author_user_id)
    REFERENCES app.users (user_id),
  CONSTRAINT fk_feed_post_challenges_tagged_user
    FOREIGN KEY (tagged_user_id)
    REFERENCES app.users (user_id),
  CONSTRAINT fk_feed_post_challenges_completed_by
    FOREIGN KEY (completed_by_user_id)
    REFERENCES app.users (user_id)
);

CREATE INDEX ix_feed_post_challenges_feed_post_id_created_at
  ON app.feed_post_challenges (feed_post_id, created_at);
