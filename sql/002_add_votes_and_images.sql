/*
    Trip Planner (MSSQL)
    Migration 002: post votes + post images.

    Adds:
    - app.PostVotes: one upvote per user per post
    - app.FeedPostImages: image attachments for posts
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

USE TripPlannerDb;
GO

IF OBJECT_ID(N'app.PostVotes', N'U') IS NULL
BEGIN
    CREATE TABLE app.PostVotes
    (
        FeedPostId UNIQUEIDENTIFIER NOT NULL,
        UserId UNIQUEIDENTIFIER NOT NULL,
        CreatedAt DATETIME2(0) NOT NULL
            CONSTRAINT DF_PostVotes_CreatedAt DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_PostVotes PRIMARY KEY (FeedPostId, UserId),

        CONSTRAINT FK_PostVotes_Post
            FOREIGN KEY (FeedPostId)
            REFERENCES app.FeedPosts (FeedPostId)
            ON DELETE CASCADE,
        CONSTRAINT FK_PostVotes_User
            FOREIGN KEY (UserId)
            REFERENCES app.Users (UserId)
    );
END
GO

IF OBJECT_ID(N'app.FeedPostImages', N'U') IS NULL
BEGIN
    CREATE TABLE app.FeedPostImages
    (
        PostImageId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT PK_FeedPostImages PRIMARY KEY
            CONSTRAINT DF_FeedPostImages_PostImageId DEFAULT NEWSEQUENTIALID(),
        FeedPostId UNIQUEIDENTIFIER NOT NULL,
        ImageUrl NVARCHAR(500) NOT NULL,
        SortOrder INT NOT NULL
            CONSTRAINT DF_FeedPostImages_SortOrder DEFAULT 0,
        CreatedAt DATETIME2(0) NOT NULL
            CONSTRAINT DF_FeedPostImages_CreatedAt DEFAULT SYSUTCDATETIME(),

        CONSTRAINT CK_FeedPostImages_SortOrder CHECK (SortOrder >= 0),
        CONSTRAINT FK_FeedPostImages_Post
            FOREIGN KEY (FeedPostId)
            REFERENCES app.FeedPosts (FeedPostId)
            ON DELETE CASCADE
    );
END
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_PostVotes_UserId'
      AND object_id = OBJECT_ID(N'app.PostVotes')
)
BEGIN
    CREATE INDEX IX_PostVotes_UserId
        ON app.PostVotes (UserId);
END
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_FeedPostImages_FeedPostId_SortOrder'
      AND object_id = OBJECT_ID(N'app.FeedPostImages')
)
BEGIN
    CREATE INDEX IX_FeedPostImages_FeedPostId_SortOrder
        ON app.FeedPostImages (FeedPostId, SortOrder, CreatedAt);
END
GO
