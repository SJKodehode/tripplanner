import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import sql from 'mssql'
import multer from 'multer'
import path from 'node:path'
import { mkdir, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const app = express()
const port = Number(process.env.API_PORT ?? 3001)
const connectionString = process.env.MSSQL_CONNECTION_STRING
const auth0Domain = (process.env.AUTH0_DOMAIN ?? process.env.VITE_AUTH0_DOMAIN ?? '')
  .trim()
  .replace(/^https?:\/\//, '')
  .replace(/\/+$/, '')
const configuredIssuerBaseUrl =
  (process.env.AUTH0_ISSUER_BASE_URL ?? '').trim() || (auth0Domain ? `https://${auth0Domain}` : '')
const auth0Audience = (process.env.AUTH0_AUDIENCE ?? process.env.VITE_AUTH0_AUDIENCE ?? '').trim()
const auth0Issuer = configuredIssuerBaseUrl.endsWith('/') ? configuredIssuerBaseUrl : `${configuredIssuerBaseUrl}/`
const currentFilePath = fileURLToPath(import.meta.url)
const currentDir = path.dirname(currentFilePath)
const uploadsDir = path.resolve(currentDir, 'uploads')
const maxPostImageCount = 6
const maxPostImageSizeBytes = 8 * 1024 * 1024

if (!connectionString) {
  console.error('Missing MSSQL_CONNECTION_STRING in environment variables.')
  process.exit(1)
}

if (!configuredIssuerBaseUrl) {
  console.error('Missing AUTH0_ISSUER_BASE_URL (or VITE_AUTH0_DOMAIN) in environment variables.')
  process.exit(1)
}

const pool = new sql.ConnectionPool(connectionString)
const poolConnect = pool.connect()
const jwks = createRemoteJWKSet(new URL(`${auth0Issuer}.well-known/jwks.json`))

pool.on('error', (error) => {
  console.error('SQL pool error:', error)
})

app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use('/uploads', express.static(uploadsDir))

const POST_TYPES = new Set(['SUGGESTION', 'EVENT', 'PIN'])
const imageMimeToExt = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
}

const uploadStorage = multer.diskStorage({
  destination(_req, _file, callback) {
    callback(null, uploadsDir)
  },
  filename(_req, file, callback) {
    const rawExtension = path.extname(file.originalname || '').toLowerCase()
    const extension = rawExtension || imageMimeToExt[file.mimetype] || '.jpg'
    callback(null, `${randomUUID()}${extension}`)
  },
})

const postImageUpload = multer({
  storage: uploadStorage,
  limits: {
    fileSize: maxPostImageSizeBytes,
    files: maxPostImageCount,
  },
  fileFilter(_req, file, callback) {
    if (!file.mimetype?.startsWith('image/')) {
      callback(new ApiError(400, 'Only image uploads are allowed.'))
      return
    }

    callback(null, true)
  },
})

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

function makeId() {
  return randomUUID()
}

function generateJoinCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''

  for (let i = 0; i < 8; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)]
  }

  return code
}

function serializeDate(value) {
  if (!value) {
    return new Date().toISOString()
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  return new Date(String(value)).toISOString()
}

function toTrimmedString(value) {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim()
}

function normalizeDisplayName(value) {
  const trimmed = toTrimmedString(value)

  if (!trimmed) {
    return 'Traveler'
  }

  return trimmed.slice(0, 120)
}

function normalizeEmail(value) {
  const trimmed = toTrimmedString(value).toLowerCase()

  if (!trimmed) {
    return null
  }

  if (trimmed.length > 255) {
    throw new ApiError(400, 'Email is too long.')
  }

  return trimmed
}

function isEmailLike(value) {
  const trimmed = toTrimmedString(value)

  if (!trimmed) {
    return false
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
}

function normalizeEditableDisplayName(value) {
  const trimmed = toTrimmedString(value)

  if (!trimmed || isEmailLike(trimmed)) {
    return ''
  }

  return normalizeDisplayName(trimmed)
}

function normalizeAuthSub(value) {
  const trimmed = toTrimmedString(value)

  if (!trimmed) {
    throw new ApiError(400, 'Auth subject is required.')
  }

  return trimmed
}

function getAuthClaimString(claims, key) {
  if (!claims || typeof claims !== 'object') {
    return ''
  }

  return toTrimmedString(claims[key])
}

function uuidFromString(source) {
  const digest = createHash('sha1').update(source).digest().subarray(0, 16)
  const bytes = Uint8Array.from(digest)

  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function normalizeJoinCode(value) {
  const upper = toTrimmedString(value).toUpperCase()

  if (!/^[A-Z0-9]{8}$/.test(upper)) {
    throw new ApiError(400, 'Join code must be 8 characters (A-Z, 0-9).')
  }

  return upper
}

function normalizeTripName(value) {
  const trimmed = toTrimmedString(value)

  if (!trimmed) {
    throw new ApiError(400, 'Trip name is required.')
  }

  return trimmed.slice(0, 120)
}

function normalizeDestination(value) {
  const trimmed = toTrimmedString(value)

  if (!trimmed) {
    throw new ApiError(400, 'Destination is required.')
  }

  return trimmed.slice(0, 200)
}

function normalizeDayCount(value) {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 60) {
    throw new ApiError(400, 'Day count must be between 1 and 60.')
  }

  return parsed
}

function normalizeStartDate(value) {
  const trimmed = toTrimmedString(value)

  if (!trimmed) {
    return null
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new ApiError(400, 'Start date must be in YYYY-MM-DD format.')
  }

  const parsed = new Date(`${trimmed}T00:00:00Z`)

  if (Number.isNaN(parsed.valueOf())) {
    throw new ApiError(400, 'Start date is invalid.')
  }

  return trimmed
}

function normalizePostType(value) {
  const upper = toTrimmedString(value).toUpperCase()

  if (!POST_TYPES.has(upper)) {
    throw new ApiError(400, 'Invalid post type.')
  }

  return upper
}

function normalizeTime(value) {
  const trimmed = toTrimmedString(value)

  if (!trimmed) {
    return null
  }

  if (!/^\d{2}:\d{2}$/.test(trimmed)) {
    throw new ApiError(400, 'Time must be in HH:MM format.')
  }

  return `${trimmed}:00`
}

function normalizeLatitude(value) {
  const trimmed = toTrimmedString(value)

  if (!trimmed) {
    return null
  }

  const parsed = Number(trimmed)

  if (!Number.isFinite(parsed) || parsed < -90 || parsed > 90) {
    throw new ApiError(400, 'Latitude must be between -90 and 90.')
  }

  return parsed
}

function normalizeLongitude(value) {
  const trimmed = toTrimmedString(value)

  if (!trimmed) {
    return null
  }

  const parsed = Number(trimmed)

  if (!Number.isFinite(parsed) || parsed < -180 || parsed > 180) {
    throw new ApiError(400, 'Longitude must be between -180 and 180.')
  }

  return parsed
}

function getUploadedFiles(req) {
  if (!req.files || !Array.isArray(req.files)) {
    return []
  }

  return req.files
}

async function cleanupUploadedFiles(files) {
  if (!files || files.length === 0) {
    return
  }

  await Promise.all(
    files.map(async (file) => {
      try {
        await unlink(file.path)
      } catch {
        // ignore cleanup errors
      }
    }),
  )
}

async function getDb() {
  return poolConnect
}

async function verifyAuthToken(req, _res, next) {
  try {
    if (req.path === '/health' || req.method === 'OPTIONS') {
      next()
      return
    }

    const authorization = req.headers.authorization

    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new ApiError(401, 'Missing bearer token.')
    }

    const token = authorization.slice('Bearer '.length).trim()

    if (!token) {
      throw new ApiError(401, 'Missing bearer token.')
    }

    const verifyOptions = auth0Audience
      ? { issuer: auth0Issuer, audience: auth0Audience }
      : { issuer: auth0Issuer }
    const { payload } = await jwtVerify(token, jwks, verifyOptions)
    req.authClaims = payload
    next()
  } catch (error) {
    if (error instanceof ApiError) {
      next(error)
      return
    }

    next(new ApiError(401, 'Invalid or expired access token.'))
  }
}

async function resolveAuthenticatedUser(db, req, preferredDisplayName = '') {
  const authSub = normalizeAuthSub(getAuthClaimString(req.authClaims, 'sub'))
  const tokenEmail = normalizeEmail(getAuthClaimString(req.authClaims, 'email'))
  const tokenName = getAuthClaimString(req.authClaims, 'name') || getAuthClaimString(req.authClaims, 'nickname')
  const preferredName = normalizeEditableDisplayName(preferredDisplayName)
  const tokenDisplayName = normalizeEditableDisplayName(tokenName)

  let userId = uuidFromString(`auth0:${authSub}`)
  let existingDisplayName = ''
  let existingEmail = null

  const existingUserResult = await db
    .request()
    .input('UserId', sql.UniqueIdentifier, userId)
    .input('Email', sql.NVarChar(255), tokenEmail)
    .query(`
      SELECT TOP 1 UserId, DisplayName, Email
      FROM app.Users
      WHERE UserId = @UserId
         OR (@Email IS NOT NULL AND Email = @Email)
      ORDER BY
        CASE WHEN @Email IS NOT NULL AND Email = @Email THEN 0 ELSE 1 END,
        CASE WHEN UserId = @UserId THEN 0 ELSE 1 END;
    `)

  if (existingUserResult.recordset.length > 0) {
    const existingUser = existingUserResult.recordset[0]
    userId = existingUser.UserId
    existingDisplayName = normalizeEditableDisplayName(existingUser.DisplayName)
    existingEmail = normalizeEmail(existingUser.Email)
  }

  const safeDisplayName = preferredName || existingDisplayName || tokenDisplayName || 'Traveler'
  const userEmail = tokenEmail ?? existingEmail

  await upsertUser(db, userId, safeDisplayName, userEmail)

  return {
    userId,
    displayName: safeDisplayName,
    email: userEmail,
    authSub,
  }
}

async function upsertUser(db, userId, displayName, email = null) {
  const safeName = normalizeDisplayName(displayName)
  const safeEmail = normalizeEmail(email)

  await db
    .request()
    .input('UserId', sql.UniqueIdentifier, userId)
    .input('DisplayName', sql.NVarChar(120), safeName)
    .input('Email', sql.NVarChar(255), safeEmail)
    .query(`
      IF EXISTS (SELECT 1 FROM app.Users WHERE UserId = @UserId)
      BEGIN
        UPDATE app.Users
        SET DisplayName = @DisplayName,
            Email = COALESCE(@Email, Email),
            LastSeenAt = SYSUTCDATETIME()
        WHERE UserId = @UserId;
      END
      ELSE
      BEGIN
        INSERT INTO app.Users (UserId, DisplayName, Email, LastSeenAt)
        VALUES (@UserId, @DisplayName, @Email, SYSUTCDATETIME());
      END
    `)
}

async function ensureTripMember(db, tripId, userId, isOwner = false) {
  await db
    .request()
    .input('TripId', sql.UniqueIdentifier, tripId)
    .input('UserId', sql.UniqueIdentifier, userId)
    .input('MemberRole', sql.VarChar(20), isOwner ? 'OWNER' : 'MEMBER')
    .query(`
      IF EXISTS (SELECT 1 FROM app.TripMembers WHERE TripId = @TripId AND UserId = @UserId)
      BEGIN
        UPDATE app.TripMembers
        SET IsActive = 1
        WHERE TripId = @TripId AND UserId = @UserId;
      END
      ELSE
      BEGIN
        INSERT INTO app.TripMembers (TripId, UserId, MemberRole)
        VALUES (@TripId, @UserId, @MemberRole);
      END
    `)
}

async function isTripMember(db, tripId, userId) {
  const result = await db
    .request()
    .input('TripId', sql.UniqueIdentifier, tripId)
    .input('UserId', sql.UniqueIdentifier, userId)
    .query(`
      SELECT TOP 1 1 AS IsMember
      FROM app.TripMembers
      WHERE TripId = @TripId
        AND UserId = @UserId
        AND IsActive = 1;
    `)

  return result.recordset.length > 0
}

async function isTripOwner(db, tripId, userId) {
  const result = await db
    .request()
    .input('TripId', sql.UniqueIdentifier, tripId)
    .input('UserId', sql.UniqueIdentifier, userId)
    .query(`
      SELECT TOP 1 1 AS IsOwner
      FROM app.TripMembers
      WHERE TripId = @TripId
        AND UserId = @UserId
        AND MemberRole = 'OWNER'
        AND IsActive = 1;
    `)

  return result.recordset.length > 0
}

async function getUserTrips(db, userId) {
  const result = await db
    .request()
    .input('UserId', sql.UniqueIdentifier, userId)
    .query(`
      SELECT
        t.TripId,
        t.JoinCode,
        t.TripName,
        t.DestinationName,
        CONVERT(VARCHAR(10), t.StartDate, 23) AS StartDate,
        t.DayCount,
        t.UpdatedAt
      FROM app.Trips t
      INNER JOIN app.TripMembers tm
        ON tm.TripId = t.TripId
      WHERE tm.UserId = @UserId
        AND tm.IsActive = 1
        AND t.IsArchived = 0
      ORDER BY t.UpdatedAt DESC;
    `)

  return result.recordset.map((trip) => ({
    id: trip.TripId,
    joinCode: trip.JoinCode,
    tripName: trip.TripName,
    destinationName: trip.DestinationName,
    startDate: trip.StartDate ?? null,
    dayCount: trip.DayCount,
    updatedAt: serializeDate(trip.UpdatedAt),
  }))
}

function mapCommentRow(row) {
  return {
    id: row.FeedCommentId,
    authorName: row.AuthorName,
    commentBody: row.CommentBody,
    createdAt: serializeDate(row.CreatedAt),
  }
}

function mapPostRow(row, commentsByPostId, votesByPostId, imagesByPostId) {
  const voteInfo = votesByPostId.get(row.FeedPostId) ?? { voteCount: 0, hasVoted: false, voterDisplayNames: [] }

  return {
    id: row.FeedPostId,
    dayNumber: row.DayNumber ?? 1,
    postType: row.PostType,
    title: row.Title ?? '',
    body: row.Body ?? '',
    eventName: row.EventName ?? '',
    fromTime: row.FromTime ?? '',
    toTime: row.ToTime ?? '',
    locationName: row.LocationName ?? '',
    latitude: row.Latitude == null ? '' : String(row.Latitude),
    longitude: row.Longitude == null ? '' : String(row.Longitude),
    authorName: row.AuthorName,
    createdAt: serializeDate(row.CreatedAt),
    comments: commentsByPostId.get(row.FeedPostId) ?? [],
    voteCount: voteInfo.voteCount,
    hasVoted: voteInfo.hasVoted,
    voterDisplayNames: voteInfo.voterDisplayNames,
    images: imagesByPostId.get(row.FeedPostId) ?? [],
  }
}

async function getTripById(db, tripId, currentUserId = null) {
  const tripResult = await db
    .request()
    .input('TripId', sql.UniqueIdentifier, tripId)
    .query(`
      SELECT
        TripId,
        JoinCode,
        TripName,
        DestinationName,
        CONVERT(VARCHAR(10), StartDate, 23) AS StartDate,
        DayCount,
        CreatedAt
      FROM app.Trips
      WHERE TripId = @TripId AND IsArchived = 0;
    `)

  if (tripResult.recordset.length === 0) {
    return null
  }

  const postResult = await db
    .request()
    .input('TripId', sql.UniqueIdentifier, tripId)
    .query(`
      SELECT
        p.FeedPostId,
        p.PostType,
        p.Title,
        p.Body,
        p.EventName,
        LEFT(CONVERT(VARCHAR(8), p.FromTime, 108), 5) AS FromTime,
        LEFT(CONVERT(VARCHAR(8), p.ToTime, 108), 5) AS ToTime,
        p.LocationName,
        p.Latitude,
        p.Longitude,
        p.CreatedAt,
        d.DayNumber,
        u.DisplayName AS AuthorName
      FROM app.FeedPosts p
      INNER JOIN app.Users u
        ON u.UserId = p.AuthorUserId
      LEFT JOIN app.TripDays d
        ON d.TripDayId = p.TripDayId
      WHERE p.TripId = @TripId
        AND p.IsDeleted = 0
      ORDER BY p.CreatedAt DESC;
    `)

  const dayResult = await db
    .request()
    .input('TripId', sql.UniqueIdentifier, tripId)
    .query(`
      SELECT
        DayNumber,
        Label,
        CONVERT(VARCHAR(10), TripDate, 23) AS TripDate
      FROM app.TripDays
      WHERE TripId = @TripId
      ORDER BY DayNumber ASC;
    `)

  const commentResult = await db
    .request()
    .input('TripId', sql.UniqueIdentifier, tripId)
    .query(`
      SELECT
        c.FeedCommentId,
        c.FeedPostId,
        c.CommentBody,
        c.CreatedAt,
        u.DisplayName AS AuthorName
      FROM app.FeedComments c
      INNER JOIN app.FeedPosts p
        ON p.FeedPostId = c.FeedPostId
      INNER JOIN app.Users u
        ON u.UserId = c.AuthorUserId
      WHERE p.TripId = @TripId
        AND c.IsDeleted = 0
      ORDER BY c.CreatedAt ASC;
    `)

  const voteResult = await db
    .request()
    .input('TripId', sql.UniqueIdentifier, tripId)
    .input('CurrentUserId', sql.UniqueIdentifier, currentUserId)
    .query(`
      SELECT
        pv.FeedPostId,
        u.DisplayName AS VoterDisplayName,
        CASE WHEN @CurrentUserId IS NOT NULL AND pv.UserId = @CurrentUserId THEN 1 ELSE 0 END AS IsCurrentUserVote,
        pv.CreatedAt
      FROM app.PostVotes pv
      INNER JOIN app.FeedPosts p
        ON p.FeedPostId = pv.FeedPostId
      INNER JOIN app.Users u
        ON u.UserId = pv.UserId
      WHERE p.TripId = @TripId
        AND p.IsDeleted = 0
      ORDER BY pv.CreatedAt ASC;
    `)

  const imageResult = await db
    .request()
    .input('TripId', sql.UniqueIdentifier, tripId)
    .query(`
      SELECT
        i.FeedPostId,
        i.ImageUrl
      FROM app.FeedPostImages i
      INNER JOIN app.FeedPosts p
        ON p.FeedPostId = i.FeedPostId
      WHERE p.TripId = @TripId
        AND p.IsDeleted = 0
      ORDER BY i.FeedPostId, i.SortOrder, i.CreatedAt;
    `)

  const commentsByPostId = new Map()
  const votesByPostId = new Map()
  const imagesByPostId = new Map()

  for (const row of commentResult.recordset) {
    if (!commentsByPostId.has(row.FeedPostId)) {
      commentsByPostId.set(row.FeedPostId, [])
    }

    commentsByPostId.get(row.FeedPostId).push(mapCommentRow(row))
  }

  for (const row of voteResult.recordset) {
    if (!votesByPostId.has(row.FeedPostId)) {
      votesByPostId.set(row.FeedPostId, {
        voteCount: 0,
        hasVoted: false,
        voterDisplayNames: [],
      })
    }

    const voteInfo = votesByPostId.get(row.FeedPostId)
    voteInfo.voteCount += 1

    if (Number(row.IsCurrentUserVote) > 0) {
      voteInfo.hasVoted = true
    }

    const voterDisplayName = toTrimmedString(row.VoterDisplayName) || 'Traveler'

    if (!voteInfo.voterDisplayNames.includes(voterDisplayName)) {
      voteInfo.voterDisplayNames.push(voterDisplayName)
    }
  }

  for (const row of imageResult.recordset) {
    if (!imagesByPostId.has(row.FeedPostId)) {
      imagesByPostId.set(row.FeedPostId, [])
    }

    imagesByPostId.get(row.FeedPostId).push(row.ImageUrl)
  }

  const trip = tripResult.recordset[0]

  return {
    id: trip.TripId,
    joinCode: trip.JoinCode,
    tripName: trip.TripName,
    destinationName: trip.DestinationName,
    startDate: trip.StartDate ?? null,
    dayCount: trip.DayCount,
    createdAt: serializeDate(trip.CreatedAt),
    days: dayResult.recordset.map((day) => ({
      dayNumber: day.DayNumber,
      label: day.Label ?? `Day ${day.DayNumber}`,
      tripDate: day.TripDate ?? null,
    })),
    posts: postResult.recordset.map((row) => mapPostRow(row, commentsByPostId, votesByPostId, imagesByPostId)),
  }
}

async function getPostById(db, postId, currentUserId = null) {
  const postResult = await db
    .request()
    .input('FeedPostId', sql.UniqueIdentifier, postId)
    .query(`
      SELECT
        p.FeedPostId,
        p.PostType,
        p.Title,
        p.Body,
        p.EventName,
        LEFT(CONVERT(VARCHAR(8), p.FromTime, 108), 5) AS FromTime,
        LEFT(CONVERT(VARCHAR(8), p.ToTime, 108), 5) AS ToTime,
        p.LocationName,
        p.Latitude,
        p.Longitude,
        p.CreatedAt,
        d.DayNumber,
        u.DisplayName AS AuthorName
      FROM app.FeedPosts p
      INNER JOIN app.Users u
        ON u.UserId = p.AuthorUserId
      LEFT JOIN app.TripDays d
        ON d.TripDayId = p.TripDayId
      WHERE p.FeedPostId = @FeedPostId
        AND p.IsDeleted = 0;
    `)

  if (postResult.recordset.length === 0) {
    return null
  }

  const voteResult = await db
    .request()
    .input('FeedPostId', sql.UniqueIdentifier, postId)
    .input('CurrentUserId', sql.UniqueIdentifier, currentUserId)
    .query(`
      SELECT
        pv.FeedPostId,
        u.DisplayName AS VoterDisplayName,
        CASE WHEN @CurrentUserId IS NOT NULL AND pv.UserId = @CurrentUserId THEN 1 ELSE 0 END AS IsCurrentUserVote,
        pv.CreatedAt
      FROM app.PostVotes pv
      INNER JOIN app.Users u
        ON u.UserId = pv.UserId
      WHERE pv.FeedPostId = @FeedPostId
      ORDER BY pv.CreatedAt ASC;
    `)

  const imageResult = await db
    .request()
    .input('FeedPostId', sql.UniqueIdentifier, postId)
    .query(`
      SELECT FeedPostId, ImageUrl
      FROM app.FeedPostImages
      WHERE FeedPostId = @FeedPostId
      ORDER BY SortOrder, CreatedAt;
    `)

  const votesByPostId = new Map()
  const imagesByPostId = new Map()

  for (const row of voteResult.recordset) {
    if (!votesByPostId.has(row.FeedPostId)) {
      votesByPostId.set(row.FeedPostId, {
        voteCount: 0,
        hasVoted: false,
        voterDisplayNames: [],
      })
    }

    const voteInfo = votesByPostId.get(row.FeedPostId)
    voteInfo.voteCount += 1

    if (Number(row.IsCurrentUserVote) > 0) {
      voteInfo.hasVoted = true
    }

    const voterDisplayName = toTrimmedString(row.VoterDisplayName) || 'Traveler'

    if (!voteInfo.voterDisplayNames.includes(voterDisplayName)) {
      voteInfo.voterDisplayNames.push(voterDisplayName)
    }
  }

  for (const row of imageResult.recordset) {
    if (!imagesByPostId.has(row.FeedPostId)) {
      imagesByPostId.set(row.FeedPostId, [])
    }

    imagesByPostId.get(row.FeedPostId).push(row.ImageUrl)
  }

  return mapPostRow(postResult.recordset[0], new Map(), votesByPostId, imagesByPostId)
}

async function getCommentById(db, commentId) {
  const result = await db
    .request()
    .input('FeedCommentId', sql.UniqueIdentifier, commentId)
    .query(`
      SELECT
        c.FeedCommentId,
        c.CommentBody,
        c.CreatedAt,
        u.DisplayName AS AuthorName
      FROM app.FeedComments c
      INNER JOIN app.Users u
        ON u.UserId = c.AuthorUserId
      WHERE c.FeedCommentId = @FeedCommentId
        AND c.IsDeleted = 0;
    `)

  if (result.recordset.length === 0) {
    return null
  }

  return mapCommentRow(result.recordset[0])
}

async function createTripRecord(db, { tripName, destinationName, startDate, dayCount, userId }) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const joinCode = generateJoinCode()
    const transaction = new sql.Transaction(db)

    try {
      await transaction.begin()

      const request = new sql.Request(transaction)
      request.input('TripId', sql.UniqueIdentifier, makeId())
      request.input('JoinCode', sql.Char(8), joinCode)
      request.input('TripName', sql.NVarChar(120), tripName)
      request.input('DestinationName', sql.NVarChar(200), destinationName)
      request.input('StartDate', sql.Date, startDate)
      request.input('DayCount', sql.Int, dayCount)
      request.input('CreatedByUserId', sql.UniqueIdentifier, userId)

      const created = await request.query(`
        INSERT INTO app.Trips
        (
          TripId,
          JoinCode,
          TripName,
          DestinationName,
          StartDate,
          DayCount,
          CreatedByUserId
        )
        OUTPUT inserted.TripId
        VALUES
        (
          @TripId,
          @JoinCode,
          @TripName,
          @DestinationName,
          @StartDate,
          @DayCount,
          @CreatedByUserId
        );
      `)

      const createdTripId = created.recordset[0].TripId

      await new sql.Request(transaction)
        .input('TripId', sql.UniqueIdentifier, createdTripId)
        .input('UserId', sql.UniqueIdentifier, userId)
        .query(`
          INSERT INTO app.TripMembers (TripId, UserId, MemberRole)
          VALUES (@TripId, @UserId, 'OWNER');
        `)

      await new sql.Request(transaction)
        .input('TripId', sql.UniqueIdentifier, createdTripId)
        .input('StartDate', sql.Date, startDate)
        .input('DayCount', sql.Int, dayCount)
        .query(`
          ;WITH DaySeed AS
          (
            SELECT 1 AS DayNumber
            UNION ALL
            SELECT DayNumber + 1
            FROM DaySeed
            WHERE DayNumber < @DayCount
          )
          INSERT INTO app.TripDays (TripId, DayNumber, TripDate, Label)
          SELECT
            @TripId,
            DayNumber,
            CASE
              WHEN @StartDate IS NULL THEN NULL
              ELSE DATEADD(DAY, DayNumber - 1, @StartDate)
            END,
            CONCAT('Day ', DayNumber)
          FROM DaySeed
          OPTION (MAXRECURSION 100);
        `)

      await transaction.commit()
      return createdTripId
    } catch (error) {
      await transaction.rollback().catch(() => {})

      if (error?.number === 2627 && attempt < 9) {
        continue
      }

      throw error
    }
  }

  throw new ApiError(500, 'Unable to generate a unique join code.')
}

app.get('/api/health', async (_req, res, next) => {
  try {
    const db = await getDb()
    await db.request().query('SELECT 1 AS ok;')

    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.use('/api', verifyAuthToken)

app.post('/api/auth/session', async (req, res, next) => {
  try {
    const db = await getDb()
    const preferredDisplayName = toTrimmedString(req.body.displayName)
    const { userId, displayName, email } = await resolveAuthenticatedUser(db, req, preferredDisplayName)

    const trips = await getUserTrips(db, userId)

    res.json({ userId, displayName, email, trips })
  } catch (error) {
    next(error)
  }
})

app.get('/api/trips/:tripId', async (req, res, next) => {
  try {
    const db = await getDb()
    const { userId } = await resolveAuthenticatedUser(db, req)
    const tripId = req.params.tripId
    const member = await isTripMember(db, tripId, userId)

    if (!member) {
      throw new ApiError(403, 'You are not a member of this trip.')
    }

    const trip = await getTripById(db, tripId, userId)

    if (!trip) {
      throw new ApiError(404, 'Trip not found.')
    }

    res.json({ trip })
  } catch (error) {
    next(error)
  }
})

app.post('/api/trips', async (req, res, next) => {
  try {
    const db = await getDb()
    const preferredDisplayName = toTrimmedString(req.body.displayName)
    const { userId } = await resolveAuthenticatedUser(db, req, preferredDisplayName)
    const tripName = normalizeTripName(req.body.tripName)
    const destinationName = normalizeDestination(req.body.destinationName)
    const startDate = normalizeStartDate(req.body.startDate)
    const dayCount = normalizeDayCount(req.body.dayCount)

    const tripId = await createTripRecord(db, {
      tripName,
      destinationName,
      startDate,
      dayCount,
      userId,
    })

    const trip = await getTripById(db, tripId, userId)

    if (!trip) {
      throw new ApiError(500, 'Trip was created but could not be loaded.')
    }

    res.status(201).json({ trip, userId })
  } catch (error) {
    next(error)
  }
})

app.post('/api/trips/join', async (req, res, next) => {
  try {
    const db = await getDb()
    const preferredDisplayName = toTrimmedString(req.body.displayName)
    const { userId } = await resolveAuthenticatedUser(db, req, preferredDisplayName)
    const joinCode = normalizeJoinCode(req.body.joinCode)

    const result = await db
      .request()
      .input('JoinCode', sql.Char(8), joinCode)
      .query(`
        SELECT TOP 1 TripId
        FROM app.Trips
        WHERE JoinCode = @JoinCode
          AND IsArchived = 0;
      `)

    if (result.recordset.length === 0) {
      throw new ApiError(404, 'No trip found for that join code.')
    }

    const tripId = result.recordset[0].TripId

    await ensureTripMember(db, tripId, userId, false)

    const trip = await getTripById(db, tripId, userId)

    if (!trip) {
      throw new ApiError(500, 'Joined trip could not be loaded.')
    }

    res.json({ trip, userId })
  } catch (error) {
    next(error)
  }
})

app.post('/api/trips/:tripId/posts', postImageUpload.array('images', maxPostImageCount), async (req, res, next) => {
  const uploadedFiles = getUploadedFiles(req)

  try {
    const db = await getDb()
    const tripId = req.params.tripId
    const preferredDisplayName = toTrimmedString(req.body.displayName)
    const { userId } = await resolveAuthenticatedUser(db, req, preferredDisplayName)
    const dayNumber = normalizeDayCount(req.body.dayNumber)
    const postType = normalizePostType(req.body.postType)

    const title = toTrimmedString(req.body.title).slice(0, 200)
    const body = toTrimmedString(req.body.body)
    const eventName = toTrimmedString(req.body.eventName).slice(0, 200)
    const fromTime = normalizeTime(req.body.fromTime)
    const toTime = normalizeTime(req.body.toTime)
    const locationName = toTrimmedString(req.body.locationName).slice(0, 200)
    const latitude = normalizeLatitude(req.body.latitude)
    const longitude = normalizeLongitude(req.body.longitude)

    if (postType === 'SUGGESTION' && !title && !body && uploadedFiles.length === 0) {
      throw new ApiError(400, 'Suggestion post needs a title or body.')
    }

    if (postType === 'EVENT') {
      if (!eventName || !fromTime || !toTime) {
        throw new ApiError(400, 'Event post needs event name, from time, and to time.')
      }

      if (fromTime >= toTime) {
        throw new ApiError(400, 'Event end time must be after start time.')
      }
    }

    if (postType === 'PIN') {
      const hasLocation = locationName.length > 0
      const hasCoordinates = latitude != null && longitude != null

      if (!hasLocation && !hasCoordinates) {
        throw new ApiError(400, 'Pin post needs location name or latitude/longitude.')
      }
    }

    const member = await isTripMember(db, tripId, userId)

    if (!member) {
      throw new ApiError(403, 'Join this trip before posting.')
    }

    const dayResult = await db
      .request()
      .input('TripId', sql.UniqueIdentifier, tripId)
      .input('DayNumber', sql.Int, dayNumber)
      .query(`
        SELECT TOP 1 TripDayId
        FROM app.TripDays
        WHERE TripId = @TripId
          AND DayNumber = @DayNumber;
      `)

    if (dayResult.recordset.length === 0) {
      throw new ApiError(404, 'Selected day not found in trip.')
    }

    const tripDayId = dayResult.recordset[0].TripDayId
    const imageUrls = uploadedFiles.map((file) => `/uploads/${file.filename}`)

    const insertResult = await db
      .request()
      .input('TripId', sql.UniqueIdentifier, tripId)
      .input('TripDayId', sql.UniqueIdentifier, tripDayId)
      .input('AuthorUserId', sql.UniqueIdentifier, userId)
      .input('PostType', sql.VarChar(20), postType)
      .input('Title', sql.NVarChar(200), title || null)
      .input('Body', sql.NVarChar(sql.MAX), body || null)
      .input('EventName', sql.NVarChar(200), eventName || null)
      .input('FromTime', sql.VarChar(8), fromTime)
      .input('ToTime', sql.VarChar(8), toTime)
      .input('LocationName', sql.NVarChar(200), locationName || null)
      .input('Latitude', sql.Decimal(9, 6), latitude)
      .input('Longitude', sql.Decimal(9, 6), longitude)
      .query(`
        INSERT INTO app.FeedPosts
        (
          TripId,
          TripDayId,
          AuthorUserId,
          PostType,
          Title,
          Body,
          EventName,
          FromTime,
          ToTime,
          LocationName,
          Latitude,
          Longitude
        )
        OUTPUT inserted.FeedPostId
        VALUES
        (
          @TripId,
          @TripDayId,
          @AuthorUserId,
          @PostType,
          @Title,
          @Body,
          @EventName,
          @FromTime,
          @ToTime,
          @LocationName,
          @Latitude,
          @Longitude
        );
      `)

    const postId = insertResult.recordset[0].FeedPostId

    for (let index = 0; index < imageUrls.length; index += 1) {
      await db
        .request()
        .input('FeedPostId', sql.UniqueIdentifier, postId)
        .input('ImageUrl', sql.NVarChar(500), imageUrls[index])
        .input('SortOrder', sql.Int, index)
        .query(`
          INSERT INTO app.FeedPostImages (FeedPostId, ImageUrl, SortOrder)
          VALUES (@FeedPostId, @ImageUrl, @SortOrder);
        `)
    }

    const post = await getPostById(db, postId, userId)

    if (!post) {
      throw new ApiError(500, 'Post was created but could not be loaded.')
    }

    res.status(201).json({ post })
  } catch (error) {
    await cleanupUploadedFiles(uploadedFiles)
    next(error)
  }
})

app.post('/api/posts/:postId/comments', async (req, res, next) => {
  try {
    const db = await getDb()
    const postId = req.params.postId
    const preferredDisplayName = toTrimmedString(req.body.displayName)
    const { userId } = await resolveAuthenticatedUser(db, req, preferredDisplayName)
    const commentBody = toTrimmedString(req.body.commentBody)

    if (!commentBody) {
      throw new ApiError(400, 'Comment body is required.')
    }

    const postExists = await db
      .request()
      .input('FeedPostId', sql.UniqueIdentifier, postId)
      .query(`
        SELECT TOP 1 FeedPostId, TripId
        FROM app.FeedPosts
        WHERE FeedPostId = @FeedPostId
          AND IsDeleted = 0;
      `)

    if (postExists.recordset.length === 0) {
      throw new ApiError(404, 'Post not found.')
    }

    const tripId = postExists.recordset[0].TripId
    const member = await isTripMember(db, tripId, userId)

    if (!member) {
      throw new ApiError(403, 'Join this trip before commenting.')
    }

    const insertResult = await db
      .request()
      .input('FeedPostId', sql.UniqueIdentifier, postId)
      .input('AuthorUserId', sql.UniqueIdentifier, userId)
      .input('CommentBody', sql.NVarChar(2000), commentBody)
      .query(`
        INSERT INTO app.FeedComments (FeedPostId, AuthorUserId, CommentBody)
        OUTPUT inserted.FeedCommentId
        VALUES (@FeedPostId, @AuthorUserId, @CommentBody);
      `)

    const commentId = insertResult.recordset[0].FeedCommentId
    const comment = await getCommentById(db, commentId)

    if (!comment) {
      throw new ApiError(500, 'Comment was created but could not be loaded.')
    }

    res.status(201).json({ comment })
  } catch (error) {
    next(error)
  }
})

app.post('/api/posts/:postId/votes', async (req, res, next) => {
  try {
    const db = await getDb()
    const postId = req.params.postId
    const { userId } = await resolveAuthenticatedUser(db, req)

    const postResult = await db
      .request()
      .input('FeedPostId', sql.UniqueIdentifier, postId)
      .query(`
        SELECT TOP 1 FeedPostId, TripId
        FROM app.FeedPosts
        WHERE FeedPostId = @FeedPostId
          AND IsDeleted = 0;
      `)

    if (postResult.recordset.length === 0) {
      throw new ApiError(404, 'Post not found.')
    }

    const tripId = postResult.recordset[0].TripId
    const member = await isTripMember(db, tripId, userId)

    if (!member) {
      throw new ApiError(403, 'Join this trip before voting.')
    }

    await db
      .request()
      .input('FeedPostId', sql.UniqueIdentifier, postId)
      .input('UserId', sql.UniqueIdentifier, userId)
      .query(`
        IF NOT EXISTS
        (
          SELECT 1
          FROM app.PostVotes
          WHERE FeedPostId = @FeedPostId
            AND UserId = @UserId
        )
        BEGIN
          INSERT INTO app.PostVotes (FeedPostId, UserId)
          VALUES (@FeedPostId, @UserId);
        END
      `)

    const voteResult = await db
      .request()
      .input('FeedPostId', sql.UniqueIdentifier, postId)
      .input('UserId', sql.UniqueIdentifier, userId)
      .query(`
        SELECT
          pv.UserId,
          u.DisplayName AS VoterDisplayName
        FROM app.PostVotes pv
        INNER JOIN app.Users u
          ON u.UserId = pv.UserId
        WHERE pv.FeedPostId = @FeedPostId
        ORDER BY pv.CreatedAt ASC;
      `)

    const voterDisplayNames = []
    let hasVoted = false

    for (const row of voteResult.recordset) {
      const voterDisplayName = toTrimmedString(row.VoterDisplayName) || 'Traveler'

      if (!voterDisplayNames.includes(voterDisplayName)) {
        voterDisplayNames.push(voterDisplayName)
      }

      if (String(row.UserId).toLowerCase() === String(userId).toLowerCase()) {
        hasVoted = true
      }
    }

    res.json({
      voteCount: voteResult.recordset.length,
      hasVoted,
      voterDisplayNames,
    })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/posts/:postId', async (req, res, next) => {
  try {
    const db = await getDb()
    const postId = req.params.postId
    const { userId } = await resolveAuthenticatedUser(db, req)

    const postResult = await db
      .request()
      .input('FeedPostId', sql.UniqueIdentifier, postId)
      .query(`
        SELECT TOP 1 FeedPostId, TripId, AuthorUserId
        FROM app.FeedPosts
        WHERE FeedPostId = @FeedPostId
          AND IsDeleted = 0;
      `)

    if (postResult.recordset.length === 0) {
      throw new ApiError(404, 'Post not found.')
    }

    const post = postResult.recordset[0]
    const isAuthor = String(post.AuthorUserId).toLowerCase() === userId.toLowerCase()
    let allowed = isAuthor

    if (!allowed) {
      allowed = await isTripOwner(db, post.TripId, userId)
    }

    if (!allowed) {
      throw new ApiError(403, 'You are not allowed to delete this post.')
    }

    await db
      .request()
      .input('FeedPostId', sql.UniqueIdentifier, postId)
      .query(`
        UPDATE app.FeedPosts
        SET IsDeleted = 1,
            UpdatedAt = SYSUTCDATETIME()
        WHERE FeedPostId = @FeedPostId;
      `)

    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/trips/:tripId', async (req, res, next) => {
  try {
    const db = await getDb()
    const tripId = req.params.tripId
    const { userId } = await resolveAuthenticatedUser(db, req)

    const tripExists = await db
      .request()
      .input('TripId', sql.UniqueIdentifier, tripId)
      .query(`
        SELECT TOP 1 TripId
        FROM app.Trips
        WHERE TripId = @TripId
          AND IsArchived = 0;
      `)

    if (tripExists.recordset.length === 0) {
      throw new ApiError(404, 'Trip not found.')
    }

    const owner = await isTripOwner(db, tripId, userId)

    if (!owner) {
      throw new ApiError(403, 'Only trip owners can delete trips.')
    }

    const result = await db
      .request()
      .input('TripId', sql.UniqueIdentifier, tripId)
      .query(`
        UPDATE app.Trips
        SET IsArchived = 1,
            UpdatedAt = SYSUTCDATETIME()
        WHERE TripId = @TripId
          AND IsArchived = 0;

        SELECT @@ROWCOUNT AS AffectedRows;
      `)

    const affectedRows = result.recordset[0]?.AffectedRows ?? 0

    if (affectedRows === 0) {
      throw new ApiError(404, 'Trip not found.')
    }

    await db
      .request()
      .input('TripId', sql.UniqueIdentifier, tripId)
      .query(`
        UPDATE app.TripMembers
        SET IsActive = 0
        WHERE TripId = @TripId;
      `)

    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

app.use((error, _req, res, _next) => {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json({ error: error.message })
    return
  }

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: `Each image must be ${Math.floor(maxPostImageSizeBytes / (1024 * 1024))}MB or smaller.` })
      return
    }

    if (error.code === 'LIMIT_FILE_COUNT') {
      res.status(400).json({ error: `You can upload up to ${maxPostImageCount} images per post.` })
      return
    }

    res.status(400).json({ error: 'Image upload failed.' })
    return
  }

  if (error?.code === 'ESOCKET' || error?.code === 'ELOGIN') {
    res.status(500).json({ error: 'Database connection failed.' })
    return
  }

  console.error(error)
  res.status(500).json({ error: 'Unexpected server error.' })
})

async function start() {
  await poolConnect
  await mkdir(uploadsDir, { recursive: true })
  const db = await getDb()
  const tableCheck = await db.request().query(`
    SELECT
      OBJECT_ID(N'app.PostVotes', N'U') AS PostVotesObjectId,
      OBJECT_ID(N'app.FeedPostImages', N'U') AS FeedPostImagesObjectId;
  `)

  const record = tableCheck.recordset[0] ?? {}

  if (!record.PostVotesObjectId || !record.FeedPostImagesObjectId) {
    throw new Error('Missing tables for votes/images. Run sql/002_add_votes_and_images.sql and restart the API.')
  }

  app.listen(port, () => {
    console.log(`Trip planner API listening on http://localhost:${port}`)
  })
}

start().catch((error) => {
  console.error('Failed to start API:', error)
  process.exit(1)
})
