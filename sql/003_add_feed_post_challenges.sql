/*
    Trip Planner (MSSQL)
    Migration 003: feed post challenges.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

USE TripPlannerDb;
GO

IF OBJECT_ID(N'app.FeedPostChallenges', N'U') IS NULL
BEGIN
    CREATE TABLE app.FeedPostChallenges
    (
        FeedPostChallengeId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT PK_FeedPostChallenges PRIMARY KEY
            CONSTRAINT DF_FeedPostChallenges_Id DEFAULT NEWSEQUENTIALID(),
        FeedPostId UNIQUEIDENTIFIER NOT NULL,
        AuthorUserId UNIQUEIDENTIFIER NOT NULL,
        TaggedUserId UNIQUEIDENTIFIER NULL,
        ChallengeText NVARCHAR(500) NOT NULL,
        IsCompleted BIT NOT NULL
            CONSTRAINT DF_FeedPostChallenges_IsCompleted DEFAULT 0,
        CompletedByUserId UNIQUEIDENTIFIER NULL,
        CreatedAt DATETIME2(0) NOT NULL
            CONSTRAINT DF_FeedPostChallenges_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(0) NOT NULL
            CONSTRAINT DF_FeedPostChallenges_UpdatedAt DEFAULT SYSUTCDATETIME(),

        CONSTRAINT CK_FeedPostChallenges_Text_NotBlank CHECK (LEN(LTRIM(RTRIM(ChallengeText))) > 0),
        CONSTRAINT CK_FeedPostChallenges_CompletionState
            CHECK (
              (IsCompleted = 1 AND CompletedByUserId IS NOT NULL)
              OR (IsCompleted = 0 AND CompletedByUserId IS NULL)
            ),
        CONSTRAINT FK_FeedPostChallenges_Post
            FOREIGN KEY (FeedPostId)
            REFERENCES app.FeedPosts (FeedPostId)
            ON DELETE CASCADE,
        CONSTRAINT FK_FeedPostChallenges_Author
            FOREIGN KEY (AuthorUserId)
            REFERENCES app.Users (UserId),
        CONSTRAINT FK_FeedPostChallenges_TaggedUser
            FOREIGN KEY (TaggedUserId)
            REFERENCES app.Users (UserId),
        CONSTRAINT FK_FeedPostChallenges_CompletedBy
            FOREIGN KEY (CompletedByUserId)
            REFERENCES app.Users (UserId)
    );
END
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_FeedPostChallenges_FeedPostId_CreatedAt'
      AND object_id = OBJECT_ID(N'app.FeedPostChallenges')
)
BEGIN
    CREATE INDEX IX_FeedPostChallenges_FeedPostId_CreatedAt
        ON app.FeedPostChallenges (FeedPostId, CreatedAt);
END
GO
