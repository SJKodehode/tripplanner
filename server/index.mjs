import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import prismaClientPackage from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool as PgPool } from 'pg'
import multer from 'multer'
import path from 'node:path'
import { mkdir, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const { Prisma, PrismaClient } = prismaClientPackage

const app = express()
const port = Number(process.env.API_PORT ?? 3001)
const databaseUrl = (process.env.DATABASE_URL ?? '').trim()
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
const maxChallengesPerPost = 3
const maxCrawlLocationsPerPost = 12
const maxChallengesPerCrawlLocation = 3
const maxCrawlLocationImageCount = 6

function createPrismaResources(rawDatabaseUrl) {
  const trimmed = (rawDatabaseUrl ?? '').trim()

  if (!trimmed) {
    throw new Error('Missing DATABASE_URL in environment variables.')
  }

  if (trimmed.startsWith('prisma://') || trimmed.startsWith('prisma+postgres://')) {
    return {
      prisma: new PrismaClient({
        accelerateUrl: trimmed,
      }),
      pgPool: null,
    }
  }

  let parsedUrl

  try {
    parsedUrl = new URL(trimmed)
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.')
  }

  const protocol = parsedUrl.protocol.toLowerCase()
  const isPostgresProtocol = protocol === 'postgres:' || protocol === 'postgresql:'

  if (!isPostgresProtocol) {
    throw new Error(
      'DATABASE_URL must be one of: postgres://, postgresql://, prisma://, or prisma+postgres://',
    )
  }

  const schemaName = (parsedUrl.searchParams.get('schema') ?? '').trim()

  if (schemaName && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(schemaName)) {
    throw new Error('DATABASE_URL schema query parameter is invalid. Use an unquoted schema identifier, e.g. schema=app.')
  }

  if (schemaName) {
    parsedUrl.searchParams.delete('schema')
  }

  if (schemaName && schemaName !== 'public') {
    const searchPathOption = `-csearch_path=${schemaName}`
    const existingOptions = parsedUrl.searchParams.get('options')

    if (!existingOptions) {
      parsedUrl.searchParams.set('options', searchPathOption)
    } else if (!existingOptions.includes('search_path')) {
      parsedUrl.searchParams.set('options', `${existingOptions} ${searchPathOption}`)
    }
  }

  const pgPool = new PgPool({
    connectionString: parsedUrl.toString(),
  })

  const adapter = new PrismaPg(pgPool)

  return {
    prisma: new PrismaClient({
      adapter,
    }),
    pgPool,
  }
}

if (!configuredIssuerBaseUrl) {
  console.error('Missing AUTH0_ISSUER_BASE_URL (or VITE_AUTH0_DOMAIN) in environment variables.')
  process.exit(1)
}

let prismaResources

try {
  prismaResources = createPrismaResources(databaseUrl)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

const { prisma, pgPool } = prismaResources
const jwks = createRemoteJWKSet(new URL(`${auth0Issuer}.well-known/jwks.json`))

app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use('/uploads', express.static(uploadsDir))

const POST_TYPES = new Set(['SUGGESTION', 'EVENT', 'CRAWL'])
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

function serializeDateOnly(value) {
  if (!value) {
    return null
  }

  const parsed = value instanceof Date ? value : new Date(String(value))

  if (Number.isNaN(parsed.valueOf())) {
    return null
  }

  const year = String(parsed.getUTCFullYear())
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0')
  const day = String(parsed.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function serializeTime(value) {
  if (!value) {
    return ''
  }

  const parsed = value instanceof Date ? value : new Date(String(value))

  if (Number.isNaN(parsed.valueOf())) {
    return ''
  }

  const hours = String(parsed.getUTCHours()).padStart(2, '0')
  const minutes = String(parsed.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function parseDateOnly(value) {
  const trimmed = toTrimmedString(value)

  if (!trimmed) {
    return null
  }

  const [year, month, day] = trimmed.split('-').map((part) => Number(part))

  if (!year || !month || !day) {
    throw new ApiError(400, 'Start date is invalid.')
  }

  return new Date(Date.UTC(year, month - 1, day))
}

function timeStringToDate(value) {
  if (!value) {
    return null
  }

  const [hours, minutes, seconds] = value.split(':').map((part) => Number(part))

  if (
    !Number.isInteger(hours)
    || !Number.isInteger(minutes)
    || !Number.isInteger(seconds)
    || hours < 0
    || hours > 23
    || minutes < 0
    || minutes > 59
    || seconds < 0
    || seconds > 59
  ) {
    throw new ApiError(400, 'Time is invalid.')
  }

  return new Date(Date.UTC(1970, 0, 1, hours, minutes, seconds))
}

function addDaysUtc(date, daysToAdd) {
  const next = new Date(date.getTime())
  next.setUTCDate(next.getUTCDate() + daysToAdd)
  return next
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

  parseDateOnly(trimmed)
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

function normalizeCrawlLocations(value) {
  if (value == null || value === '') {
    return []
  }

  let parsed = value

  if (typeof parsed === 'string') {
    const trimmed = parsed.trim()

    if (!trimmed) {
      return []
    }

    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new ApiError(400, 'Crawl locations payload is invalid JSON.')
    }
  }

  if (!Array.isArray(parsed)) {
    throw new ApiError(400, 'Crawl locations payload must be an array.')
  }

  if (parsed.length > maxCrawlLocationsPerPost) {
    throw new ApiError(400, `Crawl posts can include up to ${maxCrawlLocationsPerPost} locations.`)
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new ApiError(400, 'Each crawl location must be an object.')
    }

    const locationName = toTrimmedString(entry.locationName).slice(0, 200)

    if (!locationName) {
      throw new ApiError(400, 'Each crawl location needs a location name.')
    }

    const latitude = normalizeLatitude(entry.latitude)
    const longitude = normalizeLongitude(entry.longitude)

    return {
      locationName,
      latitude,
      longitude,
      sortOrder: index,
    }
  })
}

function normalizeChallengeText(value) {
  const trimmed = toTrimmedString(value)

  if (!trimmed) {
    throw new ApiError(400, 'Challenge text is required.')
  }

  return trimmed.slice(0, 500)
}

function normalizeOptionalUserId(value) {
  const trimmed = toTrimmedString(value)
  return trimmed || null
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

function isJoinCodeUniqueViolation(error) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false
  }

  if (error.code !== 'P2002') {
    return false
  }

  const target = error.meta?.target

  if (Array.isArray(target)) {
    return target.some((entry) => {
      const normalized = String(entry).toLowerCase()
      return normalized.includes('join_code') || normalized.includes('uq_trips_join_code')
    })
  }

  const normalized = String(target ?? '').toLowerCase()
  return normalized.includes('join_code') || normalized.includes('uq_trips_join_code')
}

function isPrismaConnectionError(error) {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true
  }

  if (error instanceof Prisma.PrismaClientRustPanicError) {
    return true
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return true
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(error.code)
  }

  return false
}

async function getDb() {
  return prisma
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

  const where = tokenEmail
    ? { OR: [{ userId }, { email: tokenEmail }] }
    : { userId }

  const candidates = await db.user.findMany({
    where,
    select: {
      userId: true,
      displayName: true,
      email: true,
    },
  })

  let existingUser = null

  if (tokenEmail) {
    existingUser = candidates.find((candidate) => normalizeEmail(candidate.email) === tokenEmail) ?? null
  }

  if (!existingUser) {
    existingUser = candidates.find((candidate) => candidate.userId === userId) ?? null
  }

  if (!existingUser && candidates.length > 0) {
    existingUser = candidates[0]
  }

  if (existingUser) {
    userId = existingUser.userId
    existingDisplayName = normalizeEditableDisplayName(existingUser.displayName)
    existingEmail = normalizeEmail(existingUser.email)
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

  const existingUser = await db.user.findUnique({
    where: { userId },
    select: {
      userId: true,
    },
  })

  if (existingUser) {
    await db.user.update({
      where: { userId },
      data: {
        displayName: safeName,
        lastSeenAt: new Date(),
        ...(safeEmail ? { email: safeEmail } : {}),
      },
    })
    return
  }

  await db.user.create({
    data: {
      userId,
      displayName: safeName,
      email: safeEmail,
      lastSeenAt: new Date(),
    },
  })
}

async function ensureTripMember(db, tripId, userId, isOwner = false) {
  const key = {
    tripId_userId: {
      tripId,
      userId,
    },
  }

  const existingMember = await db.tripMember.findUnique({
    where: key,
    select: {
      tripId: true,
    },
  })

  if (existingMember) {
    await db.tripMember.update({
      where: key,
      data: {
        isActive: true,
      },
    })
    return
  }

  await db.tripMember.create({
    data: {
      tripId,
      userId,
      memberRole: isOwner ? 'OWNER' : 'MEMBER',
    },
  })
}

async function isTripMember(db, tripId, userId) {
  const result = await db.tripMember.findFirst({
    where: {
      tripId,
      userId,
      isActive: true,
    },
    select: {
      tripId: true,
    },
  })

  return Boolean(result)
}

async function isTripOwner(db, tripId, userId) {
  const result = await db.tripMember.findFirst({
    where: {
      tripId,
      userId,
      memberRole: 'OWNER',
      isActive: true,
    },
    select: {
      tripId: true,
    },
  })

  return Boolean(result)
}

async function getUserTrips(db, userId) {
  const trips = await db.trip.findMany({
    where: {
      isArchived: false,
      tripMembers: {
        some: {
          userId,
          isActive: true,
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
  })

  return trips.map((trip) => ({
    id: trip.tripId,
    joinCode: trip.joinCode,
    tripName: trip.tripName,
    destinationName: trip.destinationName,
    startDate: serializeDateOnly(trip.startDate),
    dayCount: trip.dayCount,
    updatedAt: serializeDate(trip.updatedAt),
  }))
}

function mapCommentRow(row) {
  return {
    id: row.feedCommentId,
    authorName: toTrimmedString(row.author?.displayName) || 'Traveler',
    commentBody: row.commentBody,
    createdAt: serializeDate(row.createdAt),
  }
}

function mapChallengeRow(row) {
  return {
    id: row.feedPostChallengeId,
    authorUserId: row.authorUserId,
    authorName: toTrimmedString(row.author?.displayName) || 'Traveler',
    challengeText: row.challengeText ?? '',
    taggedUserId: row.taggedUserId ?? null,
    taggedDisplayName: toTrimmedString(row.taggedUser?.displayName) || null,
    isCompleted: Boolean(row.isCompleted),
    completedByUserId: row.completedByUserId ?? null,
    completedByDisplayName: toTrimmedString(row.completedByUser?.displayName) || null,
    createdAt: serializeDate(row.createdAt),
  }
}

function mapCrawlLocationChallengeRow(row) {
  return {
    id: row.feedPostCrawlLocationChallengeId,
    authorUserId: row.authorUserId,
    authorName: toTrimmedString(row.author?.displayName) || 'Traveler',
    challengeText: row.challengeText ?? '',
    isCompleted: Boolean(row.isCompleted),
    completedByUserId: row.completedByUserId ?? null,
    completedByDisplayName: toTrimmedString(row.completedByUser?.displayName) || null,
    createdAt: serializeDate(row.createdAt),
  }
}

function mapCrawlLocationImageUrl(row) {
  return row.imageUrl
}

function mapCrawlLocationRow(row) {
  return {
    id: row.feedPostCrawlLocationId,
    sortOrder: row.sortOrder ?? 0,
    locationName: row.locationName ?? '',
    latitude: row.latitude == null ? '' : String(row.latitude),
    longitude: row.longitude == null ? '' : String(row.longitude),
    isCompleted: Boolean(row.isCompleted),
    images: (row.feedPostCrawlLocationImages ?? []).map(mapCrawlLocationImageUrl),
    challenges: (row.feedPostCrawlLocationChallenges ?? []).map(mapCrawlLocationChallengeRow),
  }
}

function buildVoteInfo(postVotes, currentUserId = null) {
  const voterDisplayNames = []
  let hasVoted = false

  for (const vote of postVotes) {
    const voterDisplayName = toTrimmedString(vote.user?.displayName) || 'Traveler'

    if (!voterDisplayNames.includes(voterDisplayName)) {
      voterDisplayNames.push(voterDisplayName)
    }

    if (currentUserId && String(vote.userId).toLowerCase() === String(currentUserId).toLowerCase()) {
      hasVoted = true
    }
  }

  return {
    voteCount: postVotes.length,
    hasVoted,
    voterDisplayNames,
  }
}

function mapPostRow(row, currentUserId = null) {
  const voteInfo = buildVoteInfo(row.postVotes ?? [], currentUserId)

  return {
    id: row.feedPostId,
    dayNumber: row.tripDay?.dayNumber ?? 1,
    postType: row.postType,
    title: row.title ?? '',
    body: row.body ?? '',
    eventName: row.eventName ?? '',
    fromTime: serializeTime(row.fromTime),
    toTime: serializeTime(row.toTime),
    locationName: row.locationName ?? '',
    latitude: row.latitude == null ? '' : String(row.latitude),
    longitude: row.longitude == null ? '' : String(row.longitude),
    authorUserId: row.authorUserId,
    authorName: toTrimmedString(row.author?.displayName) || 'Traveler',
    createdAt: serializeDate(row.createdAt),
    comments: (row.feedComments ?? []).map(mapCommentRow),
    voteCount: voteInfo.voteCount,
    hasVoted: voteInfo.hasVoted,
    voterDisplayNames: voteInfo.voterDisplayNames,
    images: (row.feedPostImages ?? []).map((image) => image.imageUrl),
    challenges: (row.feedPostChallenges ?? []).map(mapChallengeRow),
    crawlLocations: (row.feedPostCrawlLocations ?? []).map(mapCrawlLocationRow),
  }
}
async function getTripById(db, tripId, currentUserId = null) {
  const trip = await db.trip.findFirst({
    where: {
      tripId,
      isArchived: false,
    },
    include: {
      tripDays: {
        orderBy: {
          dayNumber: 'asc',
        },
      },
      tripMembers: {
        where: {
          isActive: true,
        },
        include: {
          user: {
            select: {
              userId: true,
              displayName: true,
            },
          },
        },
      },
      feedPosts: {
        where: {
          isDeleted: false,
        },
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          tripDay: {
            select: {
              dayNumber: true,
            },
          },
          author: {
            select: {
              displayName: true,
            },
          },
          feedComments: {
            where: {
              isDeleted: false,
            },
            orderBy: {
              createdAt: 'asc',
            },
            include: {
              author: {
                select: {
                  displayName: true,
                },
              },
            },
          },
          postVotes: {
            orderBy: {
              createdAt: 'asc',
            },
            include: {
              user: {
                select: {
                  displayName: true,
                },
              },
            },
          },
          feedPostImages: {
            orderBy: [
              { sortOrder: 'asc' },
              { createdAt: 'asc' },
            ],
          },
          feedPostChallenges: {
            orderBy: {
              createdAt: 'asc',
            },
            include: {
              author: {
                select: {
                  displayName: true,
                },
              },
              taggedUser: {
                select: {
                  displayName: true,
                },
              },
              completedByUser: {
                select: {
                  displayName: true,
                },
              },
            },
          },
          feedPostCrawlLocations: {
            orderBy: [
              { sortOrder: 'asc' },
              { createdAt: 'asc' },
            ],
            include: {
              feedPostCrawlLocationImages: {
                orderBy: [
                  { sortOrder: 'asc' },
                  { createdAt: 'asc' },
                ],
              },
              feedPostCrawlLocationChallenges: {
                orderBy: {
                  createdAt: 'asc',
                },
                include: {
                  author: {
                    select: {
                      displayName: true,
                    },
                  },
                  completedByUser: {
                    select: {
                      displayName: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!trip) {
    return null
  }

  return {
    id: trip.tripId,
    joinCode: trip.joinCode,
    tripName: trip.tripName,
    destinationName: trip.destinationName,
    startDate: serializeDateOnly(trip.startDate),
    dayCount: trip.dayCount,
    createdAt: serializeDate(trip.createdAt),
    days: trip.tripDays.map((day) => ({
      dayNumber: day.dayNumber,
      label: day.label ?? `Day ${day.dayNumber}`,
      tripDate: serializeDateOnly(day.tripDate),
    })),
    members: trip.tripMembers
      .map((member) => ({
        userId: member.user?.userId ?? member.userId,
        displayName: toTrimmedString(member.user?.displayName) || 'Traveler',
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    posts: trip.feedPosts.map((post) => mapPostRow(post, currentUserId)),
  }
}

async function getPostById(db, postId, currentUserId = null) {
  const post = await db.feedPost.findFirst({
    where: {
      feedPostId: postId,
      isDeleted: false,
    },
    include: {
      tripDay: {
        select: {
          dayNumber: true,
        },
      },
      author: {
        select: {
          displayName: true,
        },
      },
      feedComments: {
        where: {
          isDeleted: false,
        },
        orderBy: {
          createdAt: 'asc',
        },
        include: {
          author: {
            select: {
              displayName: true,
            },
          },
        },
      },
      postVotes: {
        orderBy: {
          createdAt: 'asc',
        },
        include: {
          user: {
            select: {
              displayName: true,
            },
          },
        },
      },
      feedPostImages: {
        orderBy: [
          { sortOrder: 'asc' },
          { createdAt: 'asc' },
        ],
      },
      feedPostChallenges: {
        orderBy: {
          createdAt: 'asc',
        },
        include: {
          author: {
            select: {
              displayName: true,
            },
          },
          taggedUser: {
            select: {
              displayName: true,
            },
          },
          completedByUser: {
            select: {
              displayName: true,
            },
          },
        },
      },
      feedPostCrawlLocations: {
        orderBy: [
          { sortOrder: 'asc' },
          { createdAt: 'asc' },
        ],
        include: {
          feedPostCrawlLocationImages: {
            orderBy: [
              { sortOrder: 'asc' },
              { createdAt: 'asc' },
            ],
          },
          feedPostCrawlLocationChallenges: {
            orderBy: {
              createdAt: 'asc',
            },
            include: {
              author: {
                select: {
                  displayName: true,
                },
              },
              completedByUser: {
                select: {
                  displayName: true,
                },
              },
            },
          },
        },
      },
    },
  })

  if (!post) {
    return null
  }

  return mapPostRow(post, currentUserId)
}

async function getCommentById(db, commentId) {
  const comment = await db.feedComment.findFirst({
    where: {
      feedCommentId: commentId,
      isDeleted: false,
    },
    include: {
      author: {
        select: {
          displayName: true,
        },
      },
    },
  })

  if (!comment) {
    return null
  }

  return mapCommentRow(comment)
}

async function getChallengeById(db, challengeId) {
  const challenge = await db.feedPostChallenge.findFirst({
    where: {
      feedPostChallengeId: challengeId,
    },
    include: {
      author: {
        select: {
          displayName: true,
        },
      },
      taggedUser: {
        select: {
          displayName: true,
        },
      },
      completedByUser: {
        select: {
          displayName: true,
        },
      },
    },
  })

  if (!challenge) {
    return null
  }

  return mapChallengeRow(challenge)
}

async function getCrawlLocationChallengeById(db, challengeId) {
  const challenge = await db.feedPostCrawlLocationChallenge.findFirst({
    where: {
      feedPostCrawlLocationChallengeId: challengeId,
    },
    include: {
      author: {
        select: {
          displayName: true,
        },
      },
      completedByUser: {
        select: {
          displayName: true,
        },
      },
    },
  })

  if (!challenge) {
    return null
  }

  return mapCrawlLocationChallengeRow(challenge)
}

async function createTripRecord(db, { tripName, destinationName, startDate, dayCount, userId }) {
  const parsedStartDate = parseDateOnly(startDate)

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const joinCode = generateJoinCode()
    const tripId = makeId()

    try {
      await db.$transaction(async (tx) => {
        await tx.trip.create({
          data: {
            tripId,
            joinCode,
            tripName,
            destinationName,
            startDate: parsedStartDate,
            dayCount,
            createdByUserId: userId,
          },
        })

        await tx.tripMember.create({
          data: {
            tripId,
            userId,
            memberRole: 'OWNER',
          },
        })

        const dayRows = []

        for (let dayNumber = 1; dayNumber <= dayCount; dayNumber += 1) {
          dayRows.push({
            tripId,
            dayNumber,
            tripDate: parsedStartDate ? addDaysUtc(parsedStartDate, dayNumber - 1) : null,
            label: `Day ${dayNumber}`,
          })
        }

        await tx.tripDay.createMany({
          data: dayRows,
        })
      })

      return tripId
    } catch (error) {
      if (isJoinCodeUniqueViolation(error) && attempt < 9) {
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
    await db.$queryRaw`SELECT 1`

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

    const tripRecord = await db.trip.findFirst({
      where: {
        joinCode,
        isArchived: false,
      },
      select: {
        tripId: true,
      },
    })

    if (!tripRecord) {
      throw new ApiError(404, 'No trip found for that join code.')
    }

    const tripId = tripRecord.tripId

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
    const crawlLocations = normalizeCrawlLocations(req.body.crawlLocations)

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

    if (postType === 'CRAWL') {
      if (!title) {
        throw new ApiError(400, 'Crawl post needs a title.')
      }

      if (!fromTime || !toTime) {
        throw new ApiError(400, 'Crawl post needs both start and end time.')
      }

      if (fromTime >= toTime) {
        throw new ApiError(400, 'Crawl end time must be after start time.')
      }

      if (crawlLocations.length === 0) {
        throw new ApiError(400, 'Crawl post needs at least one location.')
      }
    }

    if (postType === 'SUGGESTION' && (fromTime || toTime)) {
      if (!fromTime || !toTime) {
        throw new ApiError(400, 'Suggestion post needs both start and end time when scheduling.')
      }

      if (fromTime >= toTime) {
        throw new ApiError(400, 'Suggestion end time must be after start time.')
      }
    }

    const member = await isTripMember(db, tripId, userId)

    if (!member) {
      throw new ApiError(403, 'Join this trip before posting.')
    }

    const dayRecord = await db.tripDay.findFirst({
      where: {
        tripId,
        dayNumber,
      },
      select: {
        tripDayId: true,
      },
    })

    if (!dayRecord) {
      throw new ApiError(404, 'Selected day not found in trip.')
    }

    const tripDayId = dayRecord.tripDayId
    const imageUrls = uploadedFiles.map((file) => `/uploads/${file.filename}`)
    const firstCrawlLocation = crawlLocations[0] ?? null

    const postId = await db.$transaction(async (tx) => {
      const createdPost = await tx.feedPost.create({
        data: {
          tripId,
          tripDayId,
          authorUserId: userId,
          postType,
          title: title || null,
          body: body || null,
          eventName: eventName || null,
          fromTime: timeStringToDate(fromTime),
          toTime: timeStringToDate(toTime),
          locationName: postType === 'CRAWL' ? (firstCrawlLocation?.locationName ?? null) : (locationName || null),
          latitude: postType === 'CRAWL' ? (firstCrawlLocation?.latitude ?? null) : latitude,
          longitude: postType === 'CRAWL' ? (firstCrawlLocation?.longitude ?? null) : longitude,
        },
        select: {
          feedPostId: true,
        },
      })

      if (postType === 'CRAWL' && crawlLocations.length > 0) {
        await tx.feedPostCrawlLocation.createMany({
          data: crawlLocations.map((crawlLocation, index) => ({
            feedPostId: createdPost.feedPostId,
            sortOrder: index,
            locationName: crawlLocation.locationName,
            latitude: crawlLocation.latitude,
            longitude: crawlLocation.longitude,
          })),
        })
      }

      if (imageUrls.length > 0) {
        await tx.feedPostImage.createMany({
          data: imageUrls.map((imageUrl, index) => ({
            feedPostId: createdPost.feedPostId,
            imageUrl,
            sortOrder: index,
          })),
        })
      }

      return createdPost.feedPostId
    })

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

app.patch('/api/posts/:postId/crawl-locations/reorder', async (req, res, next) => {
  try {
    const db = await getDb()
    const postId = req.params.postId
    const { userId } = await resolveAuthenticatedUser(db, req)
    const rawOrderedIds = Array.isArray(req.body.orderedLocationIds) ? req.body.orderedLocationIds : null

    if (!rawOrderedIds) {
      throw new ApiError(400, 'orderedLocationIds must be an array.')
    }

    const orderedLocationIds = rawOrderedIds
      .map((entry) => toTrimmedString(entry))
      .filter((entry) => entry.length > 0)

    const post = await db.feedPost.findFirst({
      where: {
        feedPostId: postId,
        postType: 'CRAWL',
        isDeleted: false,
      },
      select: {
        tripId: true,
      },
    })

    if (!post) {
      throw new ApiError(404, 'Crawl post not found.')
    }

    const member = await isTripMember(db, post.tripId, userId)

    if (!member) {
      throw new ApiError(403, 'Join this trip before updating crawl locations.')
    }

    const crawlLocations = await db.feedPostCrawlLocation.findMany({
      where: {
        feedPostId: postId,
      },
      select: {
        feedPostCrawlLocationId: true,
      },
      orderBy: [
        { sortOrder: 'asc' },
        { createdAt: 'asc' },
      ],
    })

    if (crawlLocations.length === 0) {
      throw new ApiError(400, 'This crawl post has no locations to reorder.')
    }

    if (orderedLocationIds.length !== crawlLocations.length) {
      throw new ApiError(400, 'orderedLocationIds must include all crawl locations exactly once.')
    }

    const currentIds = crawlLocations.map((row) => row.feedPostCrawlLocationId).sort()
    const nextIds = [...orderedLocationIds].sort()

    if (currentIds.some((id, index) => id !== nextIds[index])) {
      throw new ApiError(400, 'orderedLocationIds contains unknown crawl location ids.')
    }

    await db.$transaction(async (tx) => {
      await Promise.all(
        orderedLocationIds.map((locationId, index) =>
          tx.feedPostCrawlLocation.update({
            where: {
              feedPostCrawlLocationId: locationId,
            },
            data: {
              sortOrder: index,
              updatedAt: new Date(),
            },
          }),
        ),
      )

      await tx.feedPost.update({
        where: {
          feedPostId: postId,
        },
        data: {
          updatedAt: new Date(),
        },
      })
    })

    const updatedPost = await getPostById(db, postId, userId)

    if (!updatedPost) {
      throw new ApiError(500, 'Crawl locations were reordered but the post could not be loaded.')
    }

    res.json({ post: updatedPost })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/posts/:postId/crawl-locations/:locationId/toggle', async (req, res, next) => {
  try {
    const db = await getDb()
    const postId = req.params.postId
    const locationId = req.params.locationId
    const { userId } = await resolveAuthenticatedUser(db, req)

    const crawlLocation = await db.feedPostCrawlLocation.findFirst({
      where: {
        feedPostCrawlLocationId: locationId,
        feedPostId: postId,
      },
      include: {
        feedPost: {
          select: {
            tripId: true,
            postType: true,
            isDeleted: true,
          },
        },
      },
    })

    if (!crawlLocation || crawlLocation.feedPost?.isDeleted || crawlLocation.feedPost?.postType !== 'CRAWL') {
      throw new ApiError(404, 'Crawl location not found.')
    }

    const member = await isTripMember(db, crawlLocation.feedPost.tripId, userId)

    if (!member) {
      throw new ApiError(403, 'Join this trip before updating crawl locations.')
    }

    await db.$transaction(async (tx) => {
      await tx.feedPostCrawlLocation.update({
        where: {
          feedPostCrawlLocationId: locationId,
        },
        data: {
          isCompleted: !crawlLocation.isCompleted,
          updatedAt: new Date(),
        },
      })

      await tx.feedPost.update({
        where: {
          feedPostId: postId,
        },
        data: {
          updatedAt: new Date(),
        },
      })
    })

    const updatedPost = await getPostById(db, postId, userId)

    if (!updatedPost) {
      throw new ApiError(500, 'Crawl location was updated but the post could not be loaded.')
    }

    res.json({ post: updatedPost })
  } catch (error) {
    next(error)
  }
})

app.post('/api/posts/:postId/images', postImageUpload.array('images', maxPostImageCount), async (req, res, next) => {
  const uploadedFiles = getUploadedFiles(req)

  try {
    const db = await getDb()
    const postId = req.params.postId
    const { userId } = await resolveAuthenticatedUser(db, req)

    if (uploadedFiles.length === 0) {
      throw new ApiError(400, 'Select at least one image to upload.')
    }

    const post = await db.feedPost.findFirst({
      where: {
        feedPostId: postId,
        isDeleted: false,
      },
      select: {
        tripId: true,
      },
    })

    if (!post) {
      throw new ApiError(404, 'Post not found.')
    }

    const member = await isTripMember(db, post.tripId, userId)

    if (!member) {
      throw new ApiError(403, 'Join this trip before uploading images.')
    }

    const imageUrls = uploadedFiles.map((file) => `/uploads/${file.filename}`)

    await db.$transaction(async (tx) => {
      const existingImageCount = await tx.feedPostImage.count({
        where: {
          feedPostId: postId,
        },
      })

      if (existingImageCount + imageUrls.length > maxPostImageCount) {
        throw new ApiError(400, `Each post can include up to ${maxPostImageCount} images total.`)
      }

      await tx.feedPostImage.createMany({
        data: imageUrls.map((imageUrl, index) => ({
          feedPostId: postId,
          imageUrl,
          sortOrder: existingImageCount + index,
        })),
      })

      await tx.feedPost.update({
        where: {
          feedPostId: postId,
        },
        data: {
          updatedAt: new Date(),
        },
      })
    })

    const updatedPost = await getPostById(db, postId, userId)

    if (!updatedPost) {
      throw new ApiError(500, 'Images were uploaded but the post could not be loaded.')
    }

    res.status(201).json({ post: updatedPost })
  } catch (error) {
    await cleanupUploadedFiles(uploadedFiles)
    next(error)
  }
})

app.post('/api/posts/:postId/crawl-locations/:locationId/images', postImageUpload.array('images', maxPostImageCount), async (req, res, next) => {
  const uploadedFiles = getUploadedFiles(req)

  try {
    const db = await getDb()
    const postId = req.params.postId
    const locationId = req.params.locationId
    const { userId } = await resolveAuthenticatedUser(db, req)

    if (uploadedFiles.length === 0) {
      throw new ApiError(400, 'Select at least one image to upload.')
    }

    const crawlLocation = await db.feedPostCrawlLocation.findFirst({
      where: {
        feedPostCrawlLocationId: locationId,
        feedPostId: postId,
      },
      include: {
        feedPost: {
          select: {
            tripId: true,
            postType: true,
            isDeleted: true,
          },
        },
      },
    })

    if (!crawlLocation || crawlLocation.feedPost?.isDeleted || crawlLocation.feedPost?.postType !== 'CRAWL') {
      throw new ApiError(404, 'Crawl location not found.')
    }

    const member = await isTripMember(db, crawlLocation.feedPost.tripId, userId)

    if (!member) {
      throw new ApiError(403, 'Join this trip before uploading crawl location images.')
    }

    const imageUrls = uploadedFiles.map((file) => `/uploads/${file.filename}`)

    await db.$transaction(async (tx) => {
      const existingImageCount = await tx.feedPostCrawlLocationImage.count({
        where: {
          feedPostCrawlLocationId: locationId,
        },
      })

      if (existingImageCount + imageUrls.length > maxCrawlLocationImageCount) {
        throw new ApiError(400, `Each crawl location can include up to ${maxCrawlLocationImageCount} images total.`)
      }

      await tx.feedPostCrawlLocationImage.createMany({
        data: imageUrls.map((imageUrl, index) => ({
          feedPostCrawlLocationId: locationId,
          imageUrl,
          sortOrder: existingImageCount + index,
        })),
      })

      await tx.feedPost.update({
        where: {
          feedPostId: postId,
        },
        data: {
          updatedAt: new Date(),
        },
      })
    })

    const updatedPost = await getPostById(db, postId, userId)

    if (!updatedPost) {
      throw new ApiError(500, 'Images were uploaded but the crawl post could not be loaded.')
    }

    res.status(201).json({ post: updatedPost })
  } catch (error) {
    await cleanupUploadedFiles(uploadedFiles)
    next(error)
  }
})

app.post('/api/posts/:postId/crawl-locations/:locationId/challenges', async (req, res, next) => {
  try {
    const db = await getDb()
    const postId = req.params.postId
    const locationId = req.params.locationId
    const preferredDisplayName = toTrimmedString(req.body.displayName)
    const { userId } = await resolveAuthenticatedUser(db, req, preferredDisplayName)
    const challengeText = normalizeChallengeText(req.body.challengeText)

    const crawlLocation = await db.feedPostCrawlLocation.findFirst({
      where: {
        feedPostCrawlLocationId: locationId,
        feedPostId: postId,
      },
      include: {
        feedPost: {
          select: {
            tripId: true,
            postType: true,
            isDeleted: true,
          },
        },
      },
    })

    if (!crawlLocation || crawlLocation.feedPost?.isDeleted || crawlLocation.feedPost?.postType !== 'CRAWL') {
      throw new ApiError(404, 'Crawl location not found.')
    }

    const member = await isTripMember(db, crawlLocation.feedPost.tripId, userId)

    if (!member) {
      throw new ApiError(403, 'Join this trip before adding crawl location challenges.')
    }

    const challengeId = await db.$transaction(async (tx) => {
      const challengeCount = await tx.feedPostCrawlLocationChallenge.count({
        where: {
          feedPostCrawlLocationId: locationId,
        },
      })

      if (challengeCount >= maxChallengesPerCrawlLocation) {
        throw new ApiError(
          400,
          `Each crawl location can only have ${maxChallengesPerCrawlLocation} challenges.`,
        )
      }

      const created = await tx.feedPostCrawlLocationChallenge.create({
        data: {
          feedPostCrawlLocationId: locationId,
          authorUserId: userId,
          challengeText,
        },
        select: {
          feedPostCrawlLocationChallengeId: true,
        },
      })

      await tx.feedPost.update({
        where: {
          feedPostId: postId,
        },
        data: {
          updatedAt: new Date(),
        },
      })

      return created.feedPostCrawlLocationChallengeId
    })

    const challenge = await getCrawlLocationChallengeById(db, challengeId)

    if (!challenge) {
      throw new ApiError(500, 'Challenge was created but could not be loaded.')
    }

    res.status(201).json({ challenge })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/posts/:postId/crawl-locations/:locationId/challenges/:challengeId/toggle', async (req, res, next) => {
  try {
    const db = await getDb()
    const postId = req.params.postId
    const locationId = req.params.locationId
    const challengeId = req.params.challengeId
    const { userId } = await resolveAuthenticatedUser(db, req)

    const challengeRecord = await db.feedPostCrawlLocationChallenge.findFirst({
      where: {
        feedPostCrawlLocationChallengeId: challengeId,
        feedPostCrawlLocationId: locationId,
        feedPostCrawlLocation: {
          feedPostId: postId,
        },
      },
      include: {
        feedPostCrawlLocation: {
          include: {
            feedPost: {
              select: {
                tripId: true,
                postType: true,
                isDeleted: true,
              },
            },
          },
        },
      },
    })

    const post = challengeRecord?.feedPostCrawlLocation?.feedPost

    if (!challengeRecord || !post || post.isDeleted || post.postType !== 'CRAWL') {
      throw new ApiError(404, 'Crawl location challenge not found.')
    }

    const member = await isTripMember(db, post.tripId, userId)

    if (!member) {
      throw new ApiError(403, 'Join this trip before updating crawl location challenges.')
    }

    const nextCompleted = !challengeRecord.isCompleted

    await db.$transaction(async (tx) => {
      await tx.feedPostCrawlLocationChallenge.update({
        where: {
          feedPostCrawlLocationChallengeId: challengeId,
        },
        data: {
          isCompleted: nextCompleted,
          completedByUserId: nextCompleted ? userId : null,
          updatedAt: new Date(),
        },
      })

      await tx.feedPost.update({
        where: {
          feedPostId: postId,
        },
        data: {
          updatedAt: new Date(),
        },
      })
    })

    const challenge = await getCrawlLocationChallengeById(db, challengeId)

    if (!challenge) {
      throw new ApiError(500, 'Challenge was updated but could not be loaded.')
    }

    res.json({ challenge })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/posts/:postId/crawl-locations/:locationId/challenges/:challengeId', async (req, res, next) => {
  try {
    const db = await getDb()
    const postId = req.params.postId
    const locationId = req.params.locationId
    const challengeId = req.params.challengeId
    const { userId } = await resolveAuthenticatedUser(db, req)

    const challengeRecord = await db.feedPostCrawlLocationChallenge.findFirst({
      where: {
        feedPostCrawlLocationChallengeId: challengeId,
        feedPostCrawlLocationId: locationId,
        feedPostCrawlLocation: {
          feedPostId: postId,
        },
      },
      include: {
        feedPostCrawlLocation: {
          include: {
            feedPost: {
              select: {
                postType: true,
                isDeleted: true,
              },
            },
          },
        },
      },
    })

    const post = challengeRecord?.feedPostCrawlLocation?.feedPost

    if (!challengeRecord || !post || post.isDeleted || post.postType !== 'CRAWL') {
      throw new ApiError(404, 'Crawl location challenge not found.')
    }

    const isAuthor = String(challengeRecord.authorUserId).toLowerCase() === userId.toLowerCase()

    if (!isAuthor) {
      throw new ApiError(403, 'Only the challenge author can delete this challenge.')
    }

    await db.$transaction(async (tx) => {
      await tx.feedPostCrawlLocationChallenge.delete({
        where: {
          feedPostCrawlLocationChallengeId: challengeId,
        },
      })

      await tx.feedPost.update({
        where: {
          feedPostId: postId,
        },
        data: {
          updatedAt: new Date(),
        },
      })
    })

    res.json({ success: true })
  } catch (error) {
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

    const postExists = await db.feedPost.findFirst({
      where: {
        feedPostId: postId,
        isDeleted: false,
      },
      select: {
        tripId: true,
      },
    })

    if (!postExists) {
      throw new ApiError(404, 'Post not found.')
    }

    const member = await isTripMember(db, postExists.tripId, userId)

    if (!member) {
      throw new ApiError(403, 'Join this trip before commenting.')
    }

    const insertedComment = await db.feedComment.create({
      data: {
        feedPostId: postId,
        authorUserId: userId,
        commentBody,
      },
      select: {
        feedCommentId: true,
      },
    })

    const comment = await getCommentById(db, insertedComment.feedCommentId)

    if (!comment) {
      throw new ApiError(500, 'Comment was created but could not be loaded.')
    }

    res.status(201).json({ comment })
  } catch (error) {
    next(error)
  }
})

app.post('/api/posts/:postId/challenges', async (req, res, next) => {
  try {
    const db = await getDb()
    const postId = req.params.postId
    const preferredDisplayName = toTrimmedString(req.body.displayName)
    const { userId } = await resolveAuthenticatedUser(db, req, preferredDisplayName)
    const challengeText = normalizeChallengeText(req.body.challengeText)
    const taggedUserId = normalizeOptionalUserId(req.body.taggedUserId)

    const post = await db.feedPost.findFirst({
      where: {
        feedPostId: postId,
        isDeleted: false,
      },
      select: {
        tripId: true,
      },
    })

    if (!post) {
      throw new ApiError(404, 'Post not found.')
    }

    const member = await isTripMember(db, post.tripId, userId)

    if (!member) {
      throw new ApiError(403, 'Join this trip before adding challenges.')
    }

    if (taggedUserId) {
      const taggedIsMember = await isTripMember(db, post.tripId, taggedUserId)

      if (!taggedIsMember) {
        throw new ApiError(400, 'Tagged user must be an active member of the trip.')
      }
    }

    const challengeId = await db.$transaction(async (tx) => {
      const challengeCount = await tx.feedPostChallenge.count({
        where: {
          feedPostId: postId,
        },
      })

      if (challengeCount >= maxChallengesPerPost) {
        throw new ApiError(400, `Each post can only have ${maxChallengesPerPost} challenges.`)
      }

      const created = await tx.feedPostChallenge.create({
        data: {
          feedPostId: postId,
          authorUserId: userId,
          taggedUserId,
          challengeText,
        },
        select: {
          feedPostChallengeId: true,
        },
      })

      return created.feedPostChallengeId
    })

    const challenge = await getChallengeById(db, challengeId)

    if (!challenge) {
      throw new ApiError(500, 'Challenge was created but could not be loaded.')
    }

    res.status(201).json({ challenge })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/posts/:postId/challenges/:challengeId/toggle', async (req, res, next) => {
  try {
    const db = await getDb()
    const postId = req.params.postId
    const challengeId = req.params.challengeId
    const { userId } = await resolveAuthenticatedUser(db, req)

    const challengeRecord = await db.feedPostChallenge.findFirst({
      where: {
        feedPostChallengeId: challengeId,
        feedPostId: postId,
      },
      include: {
        feedPost: {
          select: {
            tripId: true,
            isDeleted: true,
          },
        },
      },
    })

    if (!challengeRecord || challengeRecord.feedPost?.isDeleted) {
      throw new ApiError(404, 'Challenge not found.')
    }

    const member = await isTripMember(db, challengeRecord.feedPost.tripId, userId)

    if (!member) {
      throw new ApiError(403, 'Join this trip before updating challenges.')
    }

    const nextCompleted = !challengeRecord.isCompleted

    await db.feedPostChallenge.update({
      where: {
        feedPostChallengeId: challengeId,
      },
      data: {
        isCompleted: nextCompleted,
        completedByUserId: nextCompleted ? userId : null,
        updatedAt: new Date(),
      },
    })

    const challenge = await getChallengeById(db, challengeId)

    if (!challenge) {
      throw new ApiError(500, 'Challenge was updated but could not be loaded.')
    }

    res.json({ challenge })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/posts/:postId/challenges/:challengeId', async (req, res, next) => {
  try {
    const db = await getDb()
    const postId = req.params.postId
    const challengeId = req.params.challengeId
    const { userId } = await resolveAuthenticatedUser(db, req)

    const challengeRecord = await db.feedPostChallenge.findFirst({
      where: {
        feedPostChallengeId: challengeId,
        feedPostId: postId,
      },
      include: {
        feedPost: {
          select: {
            isDeleted: true,
          },
        },
      },
    })

    if (!challengeRecord || challengeRecord.feedPost?.isDeleted) {
      throw new ApiError(404, 'Challenge not found.')
    }

    const isAuthor = String(challengeRecord.authorUserId).toLowerCase() === userId.toLowerCase()

    if (!isAuthor) {
      throw new ApiError(403, 'Only the challenge author can delete this challenge.')
    }

    await db.feedPostChallenge.delete({
      where: {
        feedPostChallengeId: challengeId,
      },
    })

    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

app.post('/api/posts/:postId/votes', async (req, res, next) => {
  try {
    const db = await getDb()
    const postId = req.params.postId
    const { userId } = await resolveAuthenticatedUser(db, req)

    const post = await db.feedPost.findFirst({
      where: {
        feedPostId: postId,
        isDeleted: false,
      },
      select: {
        tripId: true,
      },
    })

    if (!post) {
      throw new ApiError(404, 'Post not found.')
    }

    const member = await isTripMember(db, post.tripId, userId)

    if (!member) {
      throw new ApiError(403, 'Join this trip before voting.')
    }

    await db.postVote.upsert({
      where: {
        feedPostId_userId: {
          feedPostId: postId,
          userId,
        },
      },
      update: {},
      create: {
        feedPostId: postId,
        userId,
      },
    })

    const voteRows = await db.postVote.findMany({
      where: {
        feedPostId: postId,
      },
      orderBy: {
        createdAt: 'asc',
      },
      include: {
        user: {
          select: {
            userId: true,
            displayName: true,
          },
        },
      },
    })

    const voterDisplayNames = []
    let hasVoted = false

    for (const row of voteRows) {
      const voterDisplayName = toTrimmedString(row.user?.displayName) || 'Traveler'

      if (!voterDisplayNames.includes(voterDisplayName)) {
        voterDisplayNames.push(voterDisplayName)
      }

      if (String(row.userId).toLowerCase() === String(userId).toLowerCase()) {
        hasVoted = true
      }
    }

    res.json({
      voteCount: voteRows.length,
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

    const post = await db.feedPost.findFirst({
      where: {
        feedPostId: postId,
        isDeleted: false,
      },
      select: {
        tripId: true,
        authorUserId: true,
      },
    })

    if (!post) {
      throw new ApiError(404, 'Post not found.')
    }

    const isAuthor = String(post.authorUserId).toLowerCase() === userId.toLowerCase()
    let allowed = isAuthor

    if (!allowed) {
      allowed = await isTripOwner(db, post.tripId, userId)
    }

    if (!allowed) {
      throw new ApiError(403, 'You are not allowed to delete this post.')
    }

    await db.feedPost.update({
      where: {
        feedPostId: postId,
      },
      data: {
        isDeleted: true,
        updatedAt: new Date(),
      },
    })

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

    const tripExists = await db.trip.findFirst({
      where: {
        tripId,
        isArchived: false,
      },
      select: {
        tripId: true,
      },
    })

    if (!tripExists) {
      throw new ApiError(404, 'Trip not found.')
    }

    const owner = await isTripOwner(db, tripId, userId)

    if (!owner) {
      throw new ApiError(403, 'Only trip owners can delete trips.')
    }

    const result = await db.trip.updateMany({
      where: {
        tripId,
        isArchived: false,
      },
      data: {
        isArchived: true,
        updatedAt: new Date(),
      },
    })

    if (result.count === 0) {
      throw new ApiError(404, 'Trip not found.')
    }

    await db.tripMember.updateMany({
      where: {
        tripId,
      },
      data: {
        isActive: false,
      },
    })

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

  if (isPrismaConnectionError(error)) {
    res.status(500).json({ error: 'Database connection failed.' })
    return
  }

  console.error(error)
  res.status(500).json({ error: 'Unexpected server error.' })
})

async function start() {
  await prisma.$connect()
  await mkdir(uploadsDir, { recursive: true })
  await prisma.$queryRaw`SELECT 1`

  const requiredPrismaDelegates = [
    'postVote',
    'feedPostImage',
    'feedPostChallenge',
    'feedPostCrawlLocation',
    'feedPostCrawlLocationImage',
    'feedPostCrawlLocationChallenge',
  ]
  const missingPrismaDelegates = requiredPrismaDelegates.filter((delegate) => {
    const modelClient = prisma[delegate]
    return !modelClient || typeof modelClient.count !== 'function'
  })

  if (missingPrismaDelegates.length > 0) {
    throw new Error(
      `Prisma client is out of date (missing model delegates: ${missingPrismaDelegates.join(', ')}). `
      + 'Run `npx prisma generate`, then restart the API.',
    )
  }

  try {
    await prisma.postVote.count()
    await prisma.feedPostImage.count()
    await prisma.feedPostChallenge.count()
    await prisma.feedPostCrawlLocation.count()
    await prisma.feedPostCrawlLocationImage.count()
    await prisma.feedPostCrawlLocationChallenge.count()
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021') {
      throw new Error(
        'Missing tables for votes/images/challenges/crawl locations/crawl location images. Run Prisma migrations and restart the API.',
      )
    }

    throw error
  }

  app.listen(port, () => {
    console.log(`Trip planner API listening on http://localhost:${port}`)
  })
}

start().catch((error) => {
  console.error('Failed to start API:', error)
  process.exit(1)
})

async function shutdown(signal) {
  try {
    await prisma.$disconnect()
    if (pgPool) {
      await pgPool.end()
    }
  } catch (error) {
    console.error(`Failed to disconnect Prisma on ${signal}:`, error)
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT').finally(() => {
    process.exit(0)
  })
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM').finally(() => {
    process.exit(0)
  })
})
