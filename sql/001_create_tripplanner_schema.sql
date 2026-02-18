/*
    Trip Planner (MSSQL)
    Bootstrap script: database + core tables.

    App flow covered:
    - create or join trip
    - destination + day count
    - dashboard tabs by day
    - feed posts (suggestions, events, pins)
    - comments on feed posts
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF DB_ID(N'TripPlannerDb') IS NULL
BEGIN
    CREATE DATABASE TripPlannerDb;
END
GO

USE TripPlannerDb;
GO

IF SCHEMA_ID(N'app') IS NULL
BEGIN
    EXEC(N'CREATE SCHEMA app');
END
GO

IF OBJECT_ID(N'app.Users', N'U') IS NULL
BEGIN
    CREATE TABLE app.Users
    (
        UserId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT PK_Users PRIMARY KEY
            CONSTRAINT DF_Users_UserId DEFAULT NEWSEQUENTIALID(),
        DisplayName NVARCHAR(120) NOT NULL,
        Email NVARCHAR(255) NULL,
        CreatedAt DATETIME2(0) NOT NULL
            CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
        LastSeenAt DATETIME2(0) NULL
    );
END
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_Users_Email_NotNull'
      AND object_id = OBJECT_ID(N'app.Users')
)
BEGIN
    CREATE UNIQUE INDEX UX_Users_Email_NotNull
        ON app.Users (Email)
        WHERE Email IS NOT NULL;
END
GO

IF OBJECT_ID(N'app.Trips', N'U') IS NULL
BEGIN
    CREATE TABLE app.Trips
    (
        TripId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT PK_Trips PRIMARY KEY
            CONSTRAINT DF_Trips_TripId DEFAULT NEWSEQUENTIALID(),
        JoinCode CHAR(8) NOT NULL,
        TripName NVARCHAR(120) NOT NULL,
        DestinationName NVARCHAR(200) NOT NULL,
        StartDate DATE NULL,
        DayCount INT NOT NULL,
        CreatedByUserId UNIQUEIDENTIFIER NOT NULL,
        CreatedAt DATETIME2(0) NOT NULL
            CONSTRAINT DF_Trips_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(0) NOT NULL
            CONSTRAINT DF_Trips_UpdatedAt DEFAULT SYSUTCDATETIME(),
        IsArchived BIT NOT NULL
            CONSTRAINT DF_Trips_IsArchived DEFAULT 0,

        CONSTRAINT UQ_Trips_JoinCode UNIQUE (JoinCode),
        CONSTRAINT CK_Trips_DayCount CHECK (DayCount BETWEEN 1 AND 60),
        CONSTRAINT CK_Trips_JoinCodeChars CHECK (JoinCode NOT LIKE '%[^A-Z0-9]%'),

        CONSTRAINT FK_Trips_CreatedByUser
            FOREIGN KEY (CreatedByUserId)
            REFERENCES app.Users (UserId)
    );
END
GO

IF OBJECT_ID(N'app.TripMembers', N'U') IS NULL
BEGIN
    CREATE TABLE app.TripMembers
    (
        TripId UNIQUEIDENTIFIER NOT NULL,
        UserId UNIQUEIDENTIFIER NOT NULL,
        MemberRole VARCHAR(20) NOT NULL
            CONSTRAINT DF_TripMembers_MemberRole DEFAULT 'MEMBER',
        JoinedAt DATETIME2(0) NOT NULL
            CONSTRAINT DF_TripMembers_JoinedAt DEFAULT SYSUTCDATETIME(),
        IsActive BIT NOT NULL
            CONSTRAINT DF_TripMembers_IsActive DEFAULT 1,

        CONSTRAINT PK_TripMembers PRIMARY KEY (TripId, UserId),
        CONSTRAINT CK_TripMembers_MemberRole CHECK (MemberRole IN ('OWNER', 'MEMBER')),

        CONSTRAINT FK_TripMembers_Trip
            FOREIGN KEY (TripId)
            REFERENCES app.Trips (TripId)
            ON DELETE CASCADE,
        CONSTRAINT FK_TripMembers_User
            FOREIGN KEY (UserId)
            REFERENCES app.Users (UserId)
    );
END
GO

IF OBJECT_ID(N'app.TripDays', N'U') IS NULL
BEGIN
    CREATE TABLE app.TripDays
    (
        TripDayId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT PK_TripDays PRIMARY KEY
            CONSTRAINT DF_TripDays_TripDayId DEFAULT NEWSEQUENTIALID(),
        TripId UNIQUEIDENTIFIER NOT NULL,
        DayNumber INT NOT NULL,
        TripDate DATE NULL,
        Label NVARCHAR(80) NULL,
        CreatedAt DATETIME2(0) NOT NULL
            CONSTRAINT DF_TripDays_CreatedAt DEFAULT SYSUTCDATETIME(),

        CONSTRAINT UQ_TripDays_TripId_DayNumber UNIQUE (TripId, DayNumber),
        CONSTRAINT CK_TripDays_DayNumber CHECK (DayNumber BETWEEN 1 AND 60),

        CONSTRAINT FK_TripDays_Trip
            FOREIGN KEY (TripId)
            REFERENCES app.Trips (TripId)
            ON DELETE CASCADE
    );
END
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_TripDays_TripDayId_TripId'
      AND object_id = OBJECT_ID(N'app.TripDays')
)
BEGIN
    CREATE UNIQUE INDEX UX_TripDays_TripDayId_TripId
        ON app.TripDays (TripDayId, TripId);
END
GO

IF OBJECT_ID(N'app.FeedPosts', N'U') IS NULL
BEGIN
    CREATE TABLE app.FeedPosts
    (
        FeedPostId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT PK_FeedPosts PRIMARY KEY
            CONSTRAINT DF_FeedPosts_FeedPostId DEFAULT NEWSEQUENTIALID(),
        TripId UNIQUEIDENTIFIER NOT NULL,
        TripDayId UNIQUEIDENTIFIER NULL,
        AuthorUserId UNIQUEIDENTIFIER NOT NULL,
        PostType VARCHAR(20) NOT NULL,

        Title NVARCHAR(200) NULL,
        Body NVARCHAR(MAX) NULL,

        EventName NVARCHAR(200) NULL,
        FromTime TIME(0) NULL,
        ToTime TIME(0) NULL,

        LocationName NVARCHAR(200) NULL,
        Latitude DECIMAL(9, 6) NULL,
        Longitude DECIMAL(9, 6) NULL,

        CreatedAt DATETIME2(0) NOT NULL
            CONSTRAINT DF_FeedPosts_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(0) NOT NULL
            CONSTRAINT DF_FeedPosts_UpdatedAt DEFAULT SYSUTCDATETIME(),
        IsDeleted BIT NOT NULL
            CONSTRAINT DF_FeedPosts_IsDeleted DEFAULT 0,

        CONSTRAINT CK_FeedPosts_PostType
            CHECK (PostType IN ('SUGGESTION', 'EVENT', 'PIN')),
        CONSTRAINT CK_FeedPosts_EventTimes
            CHECK
            (
                PostType <> 'EVENT'
                OR
                (
                    EventName IS NOT NULL
                    AND FromTime IS NOT NULL
                    AND ToTime IS NOT NULL
                    AND ToTime > FromTime
                )
            ),
        CONSTRAINT CK_FeedPosts_EventDay
            CHECK (PostType <> 'EVENT' OR TripDayId IS NOT NULL),
        CONSTRAINT CK_FeedPosts_PinCoordinates
            CHECK
            (
                (Latitude IS NULL AND Longitude IS NULL)
                OR
                (Latitude BETWEEN -90 AND 90 AND Longitude BETWEEN -180 AND 180)
            ),
        CONSTRAINT CK_FeedPosts_PinPayload
            CHECK
            (
                PostType <> 'PIN'
                OR
                (LocationName IS NOT NULL OR (Latitude IS NOT NULL AND Longitude IS NOT NULL))
            ),

        CONSTRAINT FK_FeedPosts_Trip
            FOREIGN KEY (TripId)
            REFERENCES app.Trips (TripId)
            ON DELETE CASCADE,
        CONSTRAINT FK_FeedPosts_Author
            FOREIGN KEY (AuthorUserId)
            REFERENCES app.Users (UserId),
        CONSTRAINT FK_FeedPosts_TripDay
            FOREIGN KEY (TripDayId, TripId)
            REFERENCES app.TripDays (TripDayId, TripId)
    );
END
GO

IF OBJECT_ID(N'app.FeedComments', N'U') IS NULL
BEGIN
    CREATE TABLE app.FeedComments
    (
        FeedCommentId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT PK_FeedComments PRIMARY KEY
            CONSTRAINT DF_FeedComments_FeedCommentId DEFAULT NEWSEQUENTIALID(),
        FeedPostId UNIQUEIDENTIFIER NOT NULL,
        AuthorUserId UNIQUEIDENTIFIER NOT NULL,
        CommentBody NVARCHAR(2000) NOT NULL,
        CreatedAt DATETIME2(0) NOT NULL
            CONSTRAINT DF_FeedComments_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(0) NOT NULL
            CONSTRAINT DF_FeedComments_UpdatedAt DEFAULT SYSUTCDATETIME(),
        IsDeleted BIT NOT NULL
            CONSTRAINT DF_FeedComments_IsDeleted DEFAULT 0,

        CONSTRAINT CK_FeedComments_BodyNotBlank
            CHECK (LEN(LTRIM(RTRIM(CommentBody))) > 0),

        CONSTRAINT FK_FeedComments_Post
            FOREIGN KEY (FeedPostId)
            REFERENCES app.FeedPosts (FeedPostId)
            ON DELETE CASCADE,
        CONSTRAINT FK_FeedComments_Author
            FOREIGN KEY (AuthorUserId)
            REFERENCES app.Users (UserId)
    );
END
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_TripMembers_UserId'
      AND object_id = OBJECT_ID(N'app.TripMembers')
)
BEGIN
    CREATE INDEX IX_TripMembers_UserId
        ON app.TripMembers (UserId);
END
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_FeedPosts_TripId_CreatedAt'
      AND object_id = OBJECT_ID(N'app.FeedPosts')
)
BEGIN
    CREATE INDEX IX_FeedPosts_TripId_CreatedAt
        ON app.FeedPosts (TripId, CreatedAt DESC);
END
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_FeedPosts_TripDayId_CreatedAt'
      AND object_id = OBJECT_ID(N'app.FeedPosts')
)
BEGIN
    CREATE INDEX IX_FeedPosts_TripDayId_CreatedAt
        ON app.FeedPosts (TripDayId, CreatedAt DESC);
END
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_FeedComments_FeedPostId_CreatedAt'
      AND object_id = OBJECT_ID(N'app.FeedComments')
)
BEGIN
    CREATE INDEX IX_FeedComments_FeedPostId_CreatedAt
        ON app.FeedComments (FeedPostId, CreatedAt DESC);
END
GO
