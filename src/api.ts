import type {
  ComposerType,
  FeedChallenge,
  FeedComment,
  FeedCrawlLocation,
  FeedCrawlLocationChallenge,
  FeedPost,
  TripData,
  TripDay,
  TripMember,
  TripSummary,
} from './types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001'
let accessTokenGetter: (() => Promise<string | null>) | null = null

interface CreateTripInput {
  tripName: string
  destinationName: string
  startDate: string | null
  dayCount: number
  userId: string
  displayName: string
}

interface JoinTripInput {
  joinCode: string
  userId: string
  displayName: string
}

interface CreatePostInput {
  userId: string
  displayName: string
  dayNumber: number
  postType: ComposerType
  title: string
  body: string
  eventName: string
  fromTime: string
  toTime: string
  locationName: string
  latitude: string
  longitude: string
  crawlLocations?: CreateCrawlLocationInput[]
  images?: File[]
}

interface CreateCrawlLocationInput {
  locationName: string
  latitude: string
  longitude: string
}

interface CreateCommentInput {
  userId: string
  displayName: string
  commentBody: string
}

interface CreateChallengeInput {
  displayName: string
  challengeText: string
  taggedUserId: string | null
}

interface CreateCrawlLocationChallengeInput {
  displayName: string
  challengeText: string
}

interface TripResponse {
  trip: TripData
  userId?: string
}

interface PostResponse {
  post: FeedPost
}

interface CommentResponse {
  comment: FeedComment
}

interface ChallengeResponse {
  challenge: FeedChallenge
}

interface CrawlLocationChallengeResponse {
  challenge: FeedCrawlLocationChallenge
}

interface SuccessResponse {
  success: boolean
}

interface VoteResponse {
  voteCount: number
  hasVoted: boolean
  voterDisplayNames: string[]
}

interface AuthSessionInput {
  displayName: string
}

interface AuthSessionResponse {
  userId: string
  displayName: string
  email: string | null
  trips: TripSummary[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return fallback
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return value !== 0
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()

    if (normalized === 'true' || normalized === '1') {
      return true
    }

    if (normalized === 'false' || normalized === '0') {
      return false
    }
  }

  return fallback
}

function normalizeImageUrl(value: unknown): string {
  const raw = asString(value).trim()

  if (!raw) {
    return ''
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw
  }

  if (raw.startsWith('/')) {
    return `${API_BASE_URL}${raw}`
  }

  return `${API_BASE_URL}/${raw}`
}

function normalizeDisplayNameList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => asString(entry).trim())
    .filter((entry) => entry.length > 0)
}

function normalizeDay(raw: unknown): TripDay {
  if (!isObject(raw)) {
    return {
      dayNumber: 1,
      label: 'Day 1',
      tripDate: null,
    }
  }

  const dayNumber = Math.max(1, asNumber(raw.dayNumber, 1))
  const label = asString(raw.label, `Day ${dayNumber}`)
  const tripDateRaw = asString(raw.tripDate)
  const tripDate = tripDateRaw || null

  return {
    dayNumber,
    label,
    tripDate,
  }
}

function normalizeTripSummary(raw: unknown): TripSummary {
  if (!isObject(raw)) {
    throw new Error('Invalid trip summary payload.')
  }

  const id = asString(raw.id)

  if (!id) {
    throw new Error('Trip summary missing id.')
  }

  return {
    id,
    joinCode: asString(raw.joinCode),
    tripName: asString(raw.tripName, 'Untitled Trip'),
    destinationName: asString(raw.destinationName, 'Unknown Destination'),
    startDate: asString(raw.startDate) || null,
    dayCount: Math.max(1, asNumber(raw.dayCount, 1)),
    updatedAt: asString(raw.updatedAt, new Date().toISOString()),
  }
}

function formatDateOnly(dateValue: Date): string {
  const year = dateValue.getUTCFullYear()
  const month = String(dateValue.getUTCMonth() + 1).padStart(2, '0')
  const day = String(dateValue.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function createFallbackDays(dayCount: number, startDate: string | null): TripDay[] {
  const safeDayCount = Math.max(1, dayCount)
  const hasStartDate = Boolean(startDate)

  return Array.from({ length: safeDayCount }, (_, index) => {
    const dayNumber = index + 1

    let tripDate: string | null = null

    if (hasStartDate && startDate) {
      const base = new Date(`${startDate}T00:00:00Z`)
      base.setUTCDate(base.getUTCDate() + index)
      tripDate = formatDateOnly(base)
    }

    return {
      dayNumber,
      label: `Day ${dayNumber}`,
      tripDate,
    }
  })
}

function normalizeComment(raw: unknown): FeedComment {
  if (!isObject(raw)) {
    return {
      id: '',
      authorName: 'Traveler',
      commentBody: '',
      createdAt: new Date().toISOString(),
    }
  }

  return {
    id: asString(raw.id),
    authorName: asString(raw.authorName, 'Traveler'),
    commentBody: asString(raw.commentBody),
    createdAt: asString(raw.createdAt, new Date().toISOString()),
  }
}

function normalizeMember(raw: unknown): TripMember {
  if (!isObject(raw)) {
    return {
      userId: '',
      displayName: 'Traveler',
    }
  }

  return {
    userId: asString(raw.userId),
    displayName: asString(raw.displayName, 'Traveler'),
  }
}

function normalizeChallenge(raw: unknown): FeedChallenge {
  if (!isObject(raw)) {
    return {
      id: '',
      authorUserId: '',
      authorName: 'Traveler',
      challengeText: '',
      taggedUserId: null,
      taggedDisplayName: null,
      isCompleted: false,
      completedByUserId: null,
      completedByDisplayName: null,
      createdAt: new Date().toISOString(),
    }
  }

  const taggedUserId = asString(raw.taggedUserId)
  const taggedDisplayName = asString(raw.taggedDisplayName)
  const completedByUserId = asString(raw.completedByUserId)
  const completedByDisplayName = asString(raw.completedByDisplayName)

  return {
    id: asString(raw.id),
    authorUserId: asString(raw.authorUserId),
    authorName: asString(raw.authorName, 'Traveler'),
    challengeText: asString(raw.challengeText),
    taggedUserId: taggedUserId || null,
    taggedDisplayName: taggedDisplayName || null,
    isCompleted: asBoolean(raw.isCompleted, false),
    completedByUserId: completedByUserId || null,
    completedByDisplayName: completedByDisplayName || null,
    createdAt: asString(raw.createdAt, new Date().toISOString()),
  }
}

function normalizeCrawlLocationChallenge(raw: unknown): FeedCrawlLocationChallenge {
  if (!isObject(raw)) {
    return {
      id: '',
      authorUserId: '',
      authorName: 'Traveler',
      challengeText: '',
      isCompleted: false,
      completedByUserId: null,
      completedByDisplayName: null,
      createdAt: new Date().toISOString(),
    }
  }

  const completedByUserId = asString(raw.completedByUserId)
  const completedByDisplayName = asString(raw.completedByDisplayName)

  return {
    id: asString(raw.id),
    authorUserId: asString(raw.authorUserId),
    authorName: asString(raw.authorName, 'Traveler'),
    challengeText: asString(raw.challengeText),
    isCompleted: asBoolean(raw.isCompleted, false),
    completedByUserId: completedByUserId || null,
    completedByDisplayName: completedByDisplayName || null,
    createdAt: asString(raw.createdAt, new Date().toISOString()),
  }
}

function normalizeCrawlLocation(raw: unknown): FeedCrawlLocation {
  if (!isObject(raw)) {
    return {
      id: '',
      sortOrder: 0,
      locationName: '',
      latitude: '',
      longitude: '',
      isCompleted: false,
      images: [],
      challenges: [],
    }
  }

  const challenges = Array.isArray(raw.challenges)
    ? raw.challenges.map(normalizeCrawlLocationChallenge).filter((challenge) => challenge.id)
    : []
  const images = Array.isArray(raw.images)
    ? raw.images.map((image) => normalizeImageUrl(image)).filter((image) => image.length > 0)
    : []

  return {
    id: asString(raw.id),
    sortOrder: Math.max(0, asNumber(raw.sortOrder, 0)),
    locationName: asString(raw.locationName),
    latitude: asString(raw.latitude),
    longitude: asString(raw.longitude),
    isCompleted: asBoolean(raw.isCompleted, false),
    images,
    challenges,
  }
}

function normalizePost(raw: unknown): FeedPost {
  if (!isObject(raw)) {
    return {
      id: '',
      dayNumber: 1,
      postType: 'SUGGESTION',
      title: '',
      body: '',
      eventName: '',
      fromTime: '',
      toTime: '',
      locationName: '',
      latitude: '',
      longitude: '',
      authorUserId: '',
      authorName: 'Traveler',
      createdAt: new Date().toISOString(),
      voteCount: 0,
      hasVoted: false,
      voterDisplayNames: [],
      images: [],
      challenges: [],
      crawlLocations: [],
      comments: [],
    }
  }

  const comments = Array.isArray(raw.comments) ? raw.comments.map(normalizeComment) : []
  const images = Array.isArray(raw.images)
    ? raw.images.map((image) => normalizeImageUrl(image)).filter((image) => image.length > 0)
    : []
  const challenges = Array.isArray(raw.challenges)
    ? raw.challenges.map(normalizeChallenge).filter((challenge) => challenge.id)
    : []
  const crawlLocations = Array.isArray(raw.crawlLocations)
    ? raw.crawlLocations.map(normalizeCrawlLocation).filter((location) => location.id)
    : []
  const postTypeRaw = asString(raw.postType, 'SUGGESTION')
  const postType = postTypeRaw === 'EVENT' || postTypeRaw === 'CRAWL' ? postTypeRaw : 'SUGGESTION'

  return {
    id: asString(raw.id),
    dayNumber: Math.max(1, asNumber(raw.dayNumber, 1)),
    postType,
    title: asString(raw.title),
    body: asString(raw.body),
    eventName: asString(raw.eventName),
    fromTime: asString(raw.fromTime),
    toTime: asString(raw.toTime),
    locationName: asString(raw.locationName),
    latitude: asString(raw.latitude),
    longitude: asString(raw.longitude),
    authorUserId: asString(raw.authorUserId),
    authorName: asString(raw.authorName, 'Traveler'),
    createdAt: asString(raw.createdAt, new Date().toISOString()),
    voteCount: Math.max(0, asNumber(raw.voteCount, 0)),
    hasVoted: asBoolean(raw.hasVoted, false),
    voterDisplayNames: normalizeDisplayNameList(raw.voterDisplayNames),
    images,
    challenges,
    crawlLocations,
    comments,
  }
}

function normalizeTrip(raw: unknown): TripData {
  if (!isObject(raw)) {
    throw new Error('API returned invalid trip data.')
  }

  const id = asString(raw.id)

  if (!id) {
    throw new Error('API returned trip data without an id.')
  }

  const posts = Array.isArray(raw.posts) ? raw.posts.map(normalizePost).filter((post) => post.id) : []
  const dayCount = Math.max(1, asNumber(raw.dayCount, 1))
  const startDate = asString(raw.startDate) || null
  const rawDays = Array.isArray(raw.days) ? raw.days.map(normalizeDay) : []
  const members = Array.isArray(raw.members)
    ? raw.members.map(normalizeMember).filter((member) => member.userId)
    : []
  const days = (rawDays.length > 0 ? rawDays : createFallbackDays(dayCount, startDate))
    .filter((day) => day.dayNumber >= 1)
    .sort((a, b) => a.dayNumber - b.dayNumber)

  return {
    id,
    joinCode: asString(raw.joinCode),
    tripName: asString(raw.tripName, 'Untitled Trip'),
    destinationName: asString(raw.destinationName, 'Unknown Destination'),
    startDate,
    dayCount,
    createdAt: asString(raw.createdAt, new Date().toISOString()),
    days,
    members,
    posts,
  }
}

async function request<TResponse>(path: string, init?: RequestInit): Promise<TResponse> {
  let authorizationHeader: Record<string, string> = {}

  if (accessTokenGetter) {
    const token = await accessTokenGetter()

    if (token) {
      authorizationHeader = { Authorization: `Bearer ${token}` }
    }
  }

  const isFormDataBody = typeof FormData !== 'undefined' && init?.body instanceof FormData

  const headers: Record<string, string> = {
    ...authorizationHeader,
    ...(init?.headers as Record<string, string> | undefined),
  }

  if (!isFormDataBody) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(errorBody?.error ?? `Request failed with ${response.status}`)
  }

  return (await response.json()) as TResponse
}

export function setAccessTokenGetter(getter: (() => Promise<string | null>) | null) {
  accessTokenGetter = getter
}

export async function fetchTrip(tripId: string): Promise<TripData> {
  const response = await request<TripResponse>(`/api/trips/${tripId}`)
  return normalizeTrip(response.trip)
}

export async function createTrip(input: CreateTripInput): Promise<TripResponse> {
  const response = await request<TripResponse>('/api/trips', {
    method: 'POST',
    body: JSON.stringify(input),
  })

  return {
    ...response,
    trip: normalizeTrip(response.trip),
  }
}

export async function joinTrip(input: JoinTripInput): Promise<TripResponse> {
  const response = await request<TripResponse>('/api/trips/join', {
    method: 'POST',
    body: JSON.stringify(input),
  })

  return {
    ...response,
    trip: normalizeTrip(response.trip),
  }
}

export async function createPost(tripId: string, input: CreatePostInput): Promise<FeedPost> {
  const formData = new FormData()
  formData.set('userId', input.userId)
  formData.set('displayName', input.displayName)
  formData.set('dayNumber', String(input.dayNumber))
  formData.set('postType', input.postType)
  formData.set('title', input.title)
  formData.set('body', input.body)
  formData.set('eventName', input.eventName)
  formData.set('fromTime', input.fromTime)
  formData.set('toTime', input.toTime)
  formData.set('locationName', input.locationName)
  formData.set('latitude', input.latitude)
  formData.set('longitude', input.longitude)
  formData.set('crawlLocations', JSON.stringify(input.crawlLocations ?? []))

  for (const image of input.images ?? []) {
    formData.append('images', image)
  }

  const response = await request<PostResponse>(`/api/trips/${tripId}/posts`, {
    method: 'POST',
    body: formData,
  })

  return normalizePost(response.post)
}

export async function reorderCrawlLocations(postId: string, orderedLocationIds: string[]): Promise<FeedPost> {
  const response = await request<PostResponse>(`/api/posts/${postId}/crawl-locations/reorder`, {
    method: 'PATCH',
    body: JSON.stringify({ orderedLocationIds }),
  })

  return normalizePost(response.post)
}

export async function toggleCrawlLocation(postId: string, locationId: string): Promise<FeedPost> {
  const response = await request<PostResponse>(`/api/posts/${postId}/crawl-locations/${locationId}/toggle`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  })

  return normalizePost(response.post)
}

export async function createComment(postId: string, input: CreateCommentInput): Promise<FeedComment> {
  const response = await request<CommentResponse>(`/api/posts/${postId}/comments`, {
    method: 'POST',
    body: JSON.stringify(input),
  })

  return normalizeComment(response.comment)
}

export async function createChallenge(postId: string, input: CreateChallengeInput): Promise<FeedChallenge> {
  const response = await request<ChallengeResponse>(`/api/posts/${postId}/challenges`, {
    method: 'POST',
    body: JSON.stringify(input),
  })

  return normalizeChallenge(response.challenge)
}

export async function toggleChallenge(postId: string, challengeId: string): Promise<FeedChallenge> {
  const response = await request<ChallengeResponse>(`/api/posts/${postId}/challenges/${challengeId}/toggle`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  })

  return normalizeChallenge(response.challenge)
}

export async function createCrawlLocationChallenge(
  postId: string,
  locationId: string,
  input: CreateCrawlLocationChallengeInput,
): Promise<FeedCrawlLocationChallenge> {
  const response = await request<CrawlLocationChallengeResponse>(
    `/api/posts/${postId}/crawl-locations/${locationId}/challenges`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )

  return normalizeCrawlLocationChallenge(response.challenge)
}

export async function toggleCrawlLocationChallenge(
  postId: string,
  locationId: string,
  challengeId: string,
): Promise<FeedCrawlLocationChallenge> {
  const response = await request<CrawlLocationChallengeResponse>(
    `/api/posts/${postId}/crawl-locations/${locationId}/challenges/${challengeId}/toggle`,
    {
      method: 'PATCH',
      body: JSON.stringify({}),
    },
  )

  return normalizeCrawlLocationChallenge(response.challenge)
}

export async function deleteCrawlLocationChallenge(postId: string, locationId: string, challengeId: string): Promise<void> {
  await request<SuccessResponse>(`/api/posts/${postId}/crawl-locations/${locationId}/challenges/${challengeId}`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  })
}

export async function deleteChallenge(postId: string, challengeId: string): Promise<void> {
  await request<SuccessResponse>(`/api/posts/${postId}/challenges/${challengeId}`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  })
}

export async function deletePost(postId: string, userId: string): Promise<void> {
  await request<SuccessResponse>(`/api/posts/${postId}`, {
    method: 'DELETE',
    body: JSON.stringify({ userId }),
  })
}

export async function uploadPostImages(postId: string, images: File[]): Promise<FeedPost> {
  const formData = new FormData()

  for (const image of images) {
    formData.append('images', image)
  }

  const response = await request<PostResponse>(`/api/posts/${postId}/images`, {
    method: 'POST',
    body: formData,
  })

  return normalizePost(response.post)
}

export async function uploadCrawlLocationImages(postId: string, locationId: string, images: File[]): Promise<FeedPost> {
  const formData = new FormData()

  for (const image of images) {
    formData.append('images', image)
  }

  const response = await request<PostResponse>(`/api/posts/${postId}/crawl-locations/${locationId}/images`, {
    method: 'POST',
    body: formData,
  })

  return normalizePost(response.post)
}

export async function deleteTrip(tripId: string, userId: string): Promise<void> {
  await request<SuccessResponse>(`/api/trips/${tripId}`, {
    method: 'DELETE',
    body: JSON.stringify({ userId }),
  })
}

export async function votePost(postId: string): Promise<VoteResponse> {
  const response = await request<VoteResponse>(`/api/posts/${postId}/votes`, {
    method: 'POST',
    body: JSON.stringify({}),
  })

  return {
    voteCount: Math.max(0, asNumber(response.voteCount, 0)),
    hasVoted: asBoolean(response.hasVoted, false),
    voterDisplayNames: normalizeDisplayNameList(response.voterDisplayNames),
  }
}

export async function syncAuthSession(input: AuthSessionInput): Promise<AuthSessionResponse> {
  const response = await request<AuthSessionResponse>('/api/auth/session', {
    method: 'POST',
    body: JSON.stringify(input),
  })

  const userId = asString(response.userId)

  if (!userId) {
    throw new Error('Session sync response missing user id.')
  }

  const trips = Array.isArray(response.trips) ? response.trips.map(normalizeTripSummary) : []

  return {
    userId,
    displayName: asString(response.displayName, ''),
    email: asString(response.email) || null,
    trips,
  }
}
