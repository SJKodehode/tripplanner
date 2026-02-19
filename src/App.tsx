import { useCallback, useEffect, useMemo, useRef, useState, type Key } from 'react'
import {
  Button,
  Card,
  Chip,
  Input,
  Modal,
  ScrollShadow,
  Tabs,
  TextArea,
  useOverlayState,
} from '@heroui/react'
import { useAuth0 } from '@auth0/auth0-react'
import {
  createChallenge,
  createComment,
  createPost,
  createTrip,
  deletePost,
  deleteTrip,
  fetchTrip,
  joinTrip,
  setAccessTokenGetter,
  syncAuthSession as syncAuthSessionApi,
  toggleChallenge,
  votePost,
} from './api'
import type { ComposerType, FeedPost, TripData, TripSummary } from './types'
import AddressPicker from './components/AddressPicker'

type AppView = 'setup' | 'dashboard'

const STORAGE_TRIP_ID_KEY = 'tripplanner:active-trip-id:v1'
const STORAGE_USER_ID_KEY = 'tripplanner:user-id:v1'
const STORAGE_DISPLAY_NAME_KEY = 'tripplanner:display-name:v1'
const STORAGE_USERNAME_KEY = 'tripplanner:username:v1'

const POST_TYPES: ComposerType[] = ['SUGGESTION', 'EVENT']

const DEFAULT_POST_BY_TYPE: Record<ComposerType, string> = {
  SUGGESTION: 'Suggestion',
  EVENT: 'Event',
}

const DAY_COUNT_MIN = 1
const DAY_COUNT_MAX = 14
const MAX_CHALLENGES_PER_POST = 3
const AUTH0_AUDIENCE = import.meta.env.VITE_AUTH0_AUDIENCE as string | undefined

function makeId(): string {
  return crypto.randomUUID()
}

function formatDateTime(value: string): string {
  const parsed = new Date(value)

  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateLabel(value: string | null): string {
  if (!value) {
    return ''
  }

  const parsed = new Date(`${value}T00:00:00`)

  if (Number.isNaN(parsed.valueOf())) {
    return value
  }

  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function formatDateLong(value: string | null): string {
  if (!value) {
    return 'No date set'
  }

  const parsed = new Date(`${value}T00:00:00`)

  if (Number.isNaN(parsed.valueOf())) {
    return value
  }

  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function getTodayDateInputValue(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDaysToDate(dateValue: string, daysToAdd: number): string | null {
  const parsed = new Date(`${dateValue}T00:00:00`)

  if (Number.isNaN(parsed.valueOf())) {
    return null
  }

  parsed.setDate(parsed.getDate() + daysToAdd)

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function timeToMinutes(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    return null
  }

  const [hours, minutes] = value.split(':').map((part) => Number(part))

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null
  }

  return hours * 60 + minutes
}

function comparePostsByScheduledTime(a: FeedPost, b: FeedPost): number {
  const aStart = timeToMinutes(a.fromTime)
  const bStart = timeToMinutes(b.fromTime)

  if (aStart != null && bStart != null && aStart !== bStart) {
    return aStart - bStart
  }

  if (aStart != null && bStart == null) {
    return -1
  }

  if (aStart == null && bStart != null) {
    return 1
  }

  const aEnd = timeToMinutes(a.toTime)
  const bEnd = timeToMinutes(b.toTime)

  if (aEnd != null && bEnd != null && aEnd !== bEnd) {
    return aEnd - bEnd
  }

  return b.createdAt.localeCompare(a.createdAt)
}

function getDisplayInitial(value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    return '?'
  }

  return trimmed[0].toUpperCase()
}

function formatVoterNames(value: string[]): string {
  if (value.length === 0) {
    return ''
  }

  return value.join(', ')
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Something went wrong. Please try again.'
}

function getStoredValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function setStoredValue(key: string, value: string | null) {
  try {
    if (value === null) {
      window.localStorage.removeItem(key)
      return
    }

    window.localStorage.setItem(key, value)
  } catch {
    // ignore localStorage failure
  }
}

export default function App() {
  const { isLoading: isAuthLoading, isAuthenticated, user, loginWithRedirect, logout, getAccessTokenSilently, error: authError } =
    useAuth0()
  const [userId, setUserId] = useState<string>(() => getStoredValue(STORAGE_USER_ID_KEY) ?? makeId())
  const [displayName, setDisplayName] = useState<string>(() => getStoredValue(STORAGE_DISPLAY_NAME_KEY) ?? '')
  const [displayNameDraft, setDisplayNameDraft] = useState<string>(() => getStoredValue(STORAGE_DISPLAY_NAME_KEY) ?? '')
  const [username, setUsername] = useState<string>(() => getStoredValue(STORAGE_USERNAME_KEY) ?? '')
  const [joinedTrips, setJoinedTrips] = useState<TripSummary[]>([])
  const [isSyncingSession, setIsSyncingSession] = useState<boolean>(false)
  const [isSavingDisplayName, setIsSavingDisplayName] = useState<boolean>(false)
  const [activeTripId, setActiveTripId] = useState<string | null>(() => getStoredValue(STORAGE_TRIP_ID_KEY))
  const [trip, setTrip] = useState<TripData | null>(null)
  const [view, setView] = useState<AppView>(activeTripId ? 'dashboard' : 'setup')
  const [selectedDay, setSelectedDay] = useState<number>(1)
  const [globalError, setGlobalError] = useState<string>('')
  const [isLoadingTrip, setIsLoadingTrip] = useState<boolean>(Boolean(activeTripId))

  const [setupTripName, setSetupTripName] = useState<string>('Dublin Crew')
  const [setupDestination, setSetupDestination] = useState<string>('Dublin')
  const [setupStartDate, setSetupStartDate] = useState<string>(() => getTodayDateInputValue())
  const [setupDayCount, setSetupDayCount] = useState<string>('4')
  const [setupError, setSetupError] = useState<string>('')
  const [isCreatingTrip, setIsCreatingTrip] = useState<boolean>(false)

  const [joinCodeInput, setJoinCodeInput] = useState<string>('')
  const [joinError, setJoinError] = useState<string>('')
  const [isJoiningTrip, setIsJoiningTrip] = useState<boolean>(false)

  const [composerType, setComposerType] = useState<ComposerType>('SUGGESTION')
  const [composerTitle, setComposerTitle] = useState<string>('')
  const [composerBody, setComposerBody] = useState<string>('')
  const [composerEventName, setComposerEventName] = useState<string>('')
  const [composerFromTime, setComposerFromTime] = useState<string>('')
  const [composerToTime, setComposerToTime] = useState<string>('')
  const [composerLocation, setComposerLocation] = useState<string>('')
  const [composerImages, setComposerImages] = useState<File[]>([])
  const [composerImageFieldVersion, setComposerImageFieldVersion] = useState<number>(0)
  const [composerError, setComposerError] = useState<string>('')
  const [isPosting, setIsPosting] = useState<boolean>(false)

  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [commentSavingPostId, setCommentSavingPostId] = useState<string | null>(null)
  const [votingPostId, setVotingPostId] = useState<string | null>(null)
  const [pendingPostDelete, setPendingPostDelete] = useState<{ id: string; title: string } | null>(null)
  const [isDeletingPost, setIsDeletingPost] = useState<boolean>(false)
  const [isDeletingTrip, setIsDeletingTrip] = useState<boolean>(false)
  const [challengePostId, setChallengePostId] = useState<string | null>(null)
  const [challengeDraft, setChallengeDraft] = useState<string>('')
  const [challengeTagUserId, setChallengeTagUserId] = useState<string>('')
  const [challengeError, setChallengeError] = useState<string>('')
  const [isCreatingChallenge, setIsCreatingChallenge] = useState<boolean>(false)
  const [togglingChallengeId, setTogglingChallengeId] = useState<string | null>(null)
  const composerFileInputRef = useRef<HTMLInputElement | null>(null)

  const entryModal = useOverlayState({ defaultOpen: true })
  const postDeleteModal = useOverlayState({ defaultOpen: false })
  const tripDeleteModal = useOverlayState({ defaultOpen: false })
  const challengeModal = useOverlayState({ defaultOpen: false })

  const dayEntries = useMemo(() => {
    if (!trip) {
      return []
    }

    if (trip.days.length > 0) {
      return trip.days
    }

    return Array.from({ length: trip.dayCount }, (_, index) => ({
      dayNumber: index + 1,
      label: `Day ${index + 1}`,
      tripDate: null,
    }))
  }, [trip])

  const activeDay = useMemo(() => {
    if (!trip) {
      return 1
    }

    return Math.min(Math.max(selectedDay, 1), trip.dayCount)
  }, [selectedDay, trip])

  const postsForSelectedDay = useMemo(() => {
    if (!trip) {
      return []
    }

    return trip.posts
      .filter((post) => post.dayNumber === activeDay)
      .sort(comparePostsByScheduledTime)
  }, [activeDay, trip])

  const tripDateRange = useMemo(() => {
    if (!trip) {
      return null
    }

    const startDate = trip.startDate || trip.days[0]?.tripDate || null

    if (!startDate) {
      return null
    }

    const lastDayFromList = trip.days.length > 0 ? trip.days[trip.days.length - 1]?.tripDate : null
    const fallbackEndDate = addDaysToDate(startDate, Math.max(trip.dayCount - 1, 0))
    const endDate = lastDayFromList || fallbackEndDate || startDate

    return { startDate, endDate }
  }, [trip])

  const hasUnsavedDisplayName = useMemo(
    () => displayNameDraft.trim() !== displayName.trim(),
    [displayName, displayNameDraft],
  )

  const challengeTagOptions = useMemo(() => {
    const baseMembers = trip?.members ?? []
    const normalizedCurrentName = displayName.trim() || 'Traveler'
    const hasCurrentUser = baseMembers.some((member) => member.userId === userId)

    if (hasCurrentUser) {
      return baseMembers
    }

    return [
      ...baseMembers,
      {
        userId,
        displayName: normalizedCurrentName,
      },
    ]
  }, [displayName, trip?.members, userId])

  const syncSession = useCallback(async (options?: { preferredDisplayName?: string }) => {
    if (!isAuthenticated) {
      setJoinedTrips([])
      return null
    }

    try {
      setIsSyncingSession(true)

      const preferredDisplayName = options?.preferredDisplayName ?? displayName
      const trimmedPreferredDisplayName = preferredDisplayName.trim()
      const response = await syncAuthSessionApi({
        displayName: trimmedPreferredDisplayName === 'You' ? '' : trimmedPreferredDisplayName,
      })

      setUserId(response.userId)
      setJoinedTrips(response.trips)
      setUsername(response.email ?? user?.email ?? '')

      if (response.displayName) {
        setDisplayName(response.displayName)
        setDisplayNameDraft(response.displayName)
      }
      return response
    } catch (error) {
      setGlobalError(getErrorMessage(error))
      return null
    } finally {
      setIsSyncingSession(false)
    }
  }, [displayName, isAuthenticated, user?.email])

  useEffect(() => {
    if (!isAuthenticated) {
      setAccessTokenGetter(null)
      return
    }

    const normalizedAudience = AUTH0_AUDIENCE?.trim()

    setAccessTokenGetter(async () => {
      const token = normalizedAudience
        ? await getAccessTokenSilently({
            authorizationParams: { audience: normalizedAudience },
          })
        : await getAccessTokenSilently()

      return token || null
    })

    return () => {
      setAccessTokenGetter(null)
    }
  }, [getAccessTokenSilently, isAuthenticated])

  useEffect(() => {
    setStoredValue(STORAGE_USER_ID_KEY, userId)
  }, [userId])

  useEffect(() => {
    setStoredValue(STORAGE_DISPLAY_NAME_KEY, displayName)
  }, [displayName])

  useEffect(() => {
    setStoredValue(STORAGE_USERNAME_KEY, username || null)
  }, [username])

  useEffect(() => {
    setStoredValue(STORAGE_TRIP_ID_KEY, activeTripId)
  }, [activeTripId])

  useEffect(() => {
    if (isAuthLoading) {
      return
    }

    if (!isAuthenticated) {
      setTrip(null)
      setJoinedTrips([])
      setDisplayNameDraft('')
      setUsername('')
      setActiveTripId(null)
      setView('setup')
      return
    }

    void syncSession()
  }, [isAuthLoading, isAuthenticated, syncSession])

  useEffect(() => {
    if (!isAuthenticated) {
      return
    }

    if (!activeTripId) {
      setTrip(null)
      setIsLoadingTrip(false)
      return
    }

    const tripId = activeTripId

    let canceled = false

    async function loadTrip() {
      try {
        setIsLoadingTrip(true)
        setGlobalError('')
        const loaded = await fetchTrip(tripId)

        if (canceled) {
          return
        }

        setTrip(loaded)
        setView('dashboard')
      } catch (error) {
        if (canceled) {
          return
        }

        setTrip(null)
        setView('setup')
        setGlobalError(getErrorMessage(error))
        setActiveTripId(null)
      } finally {
        if (!canceled) {
          setIsLoadingTrip(false)
        }
      }
    }

    void loadTrip()

    return () => {
      canceled = true
    }
  }, [activeTripId, isAuthenticated])

  function openCreateTrip() {
    setView('setup')
    setSetupError('')
    setSetupTripName('Dublin Crew')
    setSetupDestination('Dublin')
    setSetupStartDate(getTodayDateInputValue())
    setSetupDayCount('4')
    setJoinError('')
    entryModal.close()
  }

  function useLoadedTrip() {
    if (!trip) {
      return
    }

    setView('dashboard')
    setSelectedDay(1)
    setGlobalError('')
    entryModal.close()
  }

  function openJoinedTrip(tripId: string) {
    setActiveTripId(tripId)
    setView('dashboard')
    setGlobalError('')
    entryModal.close()
  }

  async function createTripFromSetup() {
    const dayCountValue = Number(setupDayCount)
    const trimmedDestination = setupDestination.trim()
    const trimmedTripName = setupTripName.trim()
    const trimmedStartDate = setupStartDate.trim()
    const trimmedDisplayName = displayName.trim()

    if (!trimmedTripName) {
      setSetupError('Trip name is required.')
      return
    }

    if (!trimmedDestination) {
      setSetupError('Destination is required.')
      return
    }

    if (!Number.isInteger(dayCountValue) || dayCountValue < DAY_COUNT_MIN || dayCountValue > DAY_COUNT_MAX) {
      setSetupError(`Day count must be between ${DAY_COUNT_MIN} and ${DAY_COUNT_MAX}.`)
      return
    }

    try {
      setIsCreatingTrip(true)
      setSetupError('')

      const response = await createTrip({
        tripName: trimmedTripName,
        destinationName: trimmedDestination,
        startDate: trimmedStartDate || null,
        dayCount: dayCountValue,
        userId,
        displayName: trimmedDisplayName,
      })

      if (response.userId && response.userId !== userId) {
        setUserId(response.userId)
      }

      setTrip(response.trip)
      setActiveTripId(response.trip.id)
      setSelectedDay(1)
      setView('dashboard')
      setGlobalError('')
      entryModal.close()
      void syncSession({
        preferredDisplayName: trimmedDisplayName,
      })
    } catch (error) {
      setSetupError(getErrorMessage(error))
    } finally {
      setIsCreatingTrip(false)
    }
  }

  async function joinTripByCode() {
    const normalizedCode = joinCodeInput.trim().toUpperCase()
    const trimmedDisplayName = displayName.trim()

    if (!normalizedCode) {
      setJoinError('Enter a join code first.')
      return
    }

    try {
      setIsJoiningTrip(true)
      setJoinError('')

      const response = await joinTrip({
        joinCode: normalizedCode,
        userId,
        displayName: trimmedDisplayName,
      })

      if (response.userId && response.userId !== userId) {
        setUserId(response.userId)
      }

      setTrip(response.trip)
      setActiveTripId(response.trip.id)
      setSelectedDay(1)
      setView('dashboard')
      setGlobalError('')
      setJoinCodeInput('')
      entryModal.close()
      void syncSession({
        preferredDisplayName: trimmedDisplayName,
      })
    } catch (error) {
      setJoinError(getErrorMessage(error))
    } finally {
      setIsJoiningTrip(false)
    }
  }

  function resetComposer() {
    setComposerTitle('')
    setComposerBody('')
    setComposerEventName('')
    setComposerFromTime('')
    setComposerToTime('')
    setComposerLocation('')
    setComposerImages([])
    setComposerImageFieldVersion((current) => current + 1)
    setComposerError('')
  }

  async function addPost() {
    if (!trip) {
      return
    }

    const trimmedDisplayName = displayName.trim()
    const trimmedTitle = composerTitle.trim()
    const trimmedBody = composerBody.trim()

    if (composerType === 'SUGGESTION' && !trimmedTitle && !trimmedBody && composerImages.length === 0) {
      setComposerError('Add at least a title or a note for your suggestion.')
      return
    }

    if (composerType === 'EVENT') {
      const trimmedEventName = composerEventName.trim()

      if (!trimmedEventName || !composerFromTime || !composerToTime) {
        setComposerError('Event posts need event name, start time, and end time.')
        return
      }

      if (composerFromTime >= composerToTime) {
        setComposerError('Event end time must be after start time.')
        return
      }
    }

    if (composerType === 'SUGGESTION' && (composerFromTime || composerToTime)) {
      if (!composerFromTime || !composerToTime) {
        setComposerError('Suggestion posts need both start time and end time when scheduling.')
        return
      }

      if (composerFromTime >= composerToTime) {
        setComposerError('Suggestion end time must be after start time.')
        return
      }
    }

    if (composerImages.length > 6) {
      setComposerError('You can upload up to 6 images per post.')
      return
    }

    const oversizedImage = composerImages.find((image) => image.size > 8 * 1024 * 1024)

    if (oversizedImage) {
      setComposerError(`"${oversizedImage.name}" is larger than 8MB.`)
      return
    }

    try {
      setIsPosting(true)
      setComposerError('')

      const post = await createPost(trip.id, {
        userId,
        displayName: trimmedDisplayName,
        dayNumber: activeDay,
        postType: composerType,
        title: trimmedTitle || DEFAULT_POST_BY_TYPE[composerType],
        body: trimmedBody,
        eventName: composerEventName.trim(),
        fromTime: composerFromTime,
        toTime: composerToTime,
        locationName: composerLocation.trim(),
        latitude: '',
        longitude: '',
        images: composerImages,
      })

      setTrip((current) => {
        if (!current) {
          return null
        }

        return {
          ...current,
          posts: [post, ...current.posts],
        }
      })

      resetComposer()
    } catch (error) {
      setComposerError(getErrorMessage(error))
    } finally {
      setIsPosting(false)
    }
  }

  async function addComment(postId: string) {
    const draft = (commentDrafts[postId] ?? '').trim()

    if (!draft) {
      return
    }

    try {
        setCommentSavingPostId(postId)
        const comment = await createComment(postId, {
          userId,
          displayName: displayName.trim(),
          commentBody: draft,
        })

      setTrip((current) => {
        if (!current) {
          return null
        }

        const nextPosts = current.posts.map((post) => {
          if (post.id !== postId) {
            return post
          }

          return {
            ...post,
            comments: [...post.comments, comment],
          }
        })

        return {
          ...current,
          posts: nextPosts,
        }
      })

      setCommentDrafts((current) => ({
        ...current,
        [postId]: '',
      }))
    } catch (error) {
      setGlobalError(getErrorMessage(error))
    } finally {
      setCommentSavingPostId(null)
    }
  }

  async function upvotePostById(postId: string) {
    try {
      setVotingPostId(postId)
      const vote = await votePost(postId)

      setTrip((current) => {
        if (!current) {
          return null
        }

        return {
          ...current,
          posts: current.posts.map((post) => {
            if (post.id !== postId) {
              return post
            }

            return {
              ...post,
              voteCount: vote.voteCount,
              hasVoted: vote.hasVoted,
              voterDisplayNames: vote.voterDisplayNames,
            }
          }),
        }
      })
    } catch (error) {
      setGlobalError(getErrorMessage(error))
    } finally {
      setVotingPostId(null)
    }
  }

  function openChallengeModal(postId: string) {
    const existingChallenges = trip?.posts.find((post) => post.id === postId)?.challenges ?? []

    if (existingChallenges.length >= MAX_CHALLENGES_PER_POST) {
      setGlobalError(`Each post can only have ${MAX_CHALLENGES_PER_POST} challenges.`)
      return
    }

    setChallengePostId(postId)
    setChallengeDraft('')
    setChallengeTagUserId('')
    setChallengeError('')
    challengeModal.open()
  }

  function closeChallengeModal() {
    setChallengePostId(null)
    setChallengeDraft('')
    setChallengeTagUserId('')
    setChallengeError('')
    challengeModal.close()
  }

  async function addChallengeToPost() {
    if (!challengePostId) {
      return
    }

    const trimmedChallenge = challengeDraft.trim()

    if (!trimmedChallenge) {
      setChallengeError('Challenge text is required.')
      return
    }

    const existingChallenges = trip?.posts.find((post) => post.id === challengePostId)?.challenges ?? []

    if (existingChallenges.length >= MAX_CHALLENGES_PER_POST) {
      setChallengeError(`You can only add up to ${MAX_CHALLENGES_PER_POST} challenges on this post.`)
      return
    }

    try {
      setIsCreatingChallenge(true)
      setChallengeError('')

      const challenge = await createChallenge(challengePostId, {
        displayName: displayName.trim(),
        challengeText: trimmedChallenge,
        taggedUserId: challengeTagUserId || null,
      })

      setTrip((current) => {
        if (!current) {
          return null
        }

        return {
          ...current,
          posts: current.posts.map((post) => {
            if (post.id !== challengePostId) {
              return post
            }

            return {
              ...post,
              challenges: [...post.challenges, challenge],
            }
          }),
        }
      })

      closeChallengeModal()
    } catch (error) {
      setChallengeError(getErrorMessage(error))
    } finally {
      setIsCreatingChallenge(false)
    }
  }

  async function toggleChallengeCompletion(postId: string, challengeId: string) {
    try {
      setTogglingChallengeId(challengeId)
      const updatedChallenge = await toggleChallenge(postId, challengeId)

      setTrip((current) => {
        if (!current) {
          return null
        }

        return {
          ...current,
          posts: current.posts.map((post) => {
            if (post.id !== postId) {
              return post
            }

            return {
              ...post,
              challenges: post.challenges.map((challenge) => (
                challenge.id === challengeId ? updatedChallenge : challenge
              )),
            }
          }),
        }
      })
    } catch (error) {
      setGlobalError(getErrorMessage(error))
    } finally {
      setTogglingChallengeId(null)
    }
  }

  async function saveDisplayName() {
    const nextName = displayNameDraft.trim()

    if (!nextName) {
      setGlobalError('Display name cannot be empty.')
      return
    }

    try {
      setIsSavingDisplayName(true)
      setGlobalError('')

      const session = await syncSession({ preferredDisplayName: nextName })

      if (!session) {
        return
      }

      if (activeTripId) {
        const refreshed = await fetchTrip(activeTripId)
        setTrip(refreshed)
      }
    } catch (error) {
      setGlobalError(getErrorMessage(error))
    } finally {
      setIsSavingDisplayName(false)
    }
  }

  function openPostDeleteModal(postId: string, title: string) {
    setPendingPostDelete({ id: postId, title })
    postDeleteModal.open()
  }

  function closePostDeleteModal() {
    if (isDeletingPost) {
      return
    }

    setPendingPostDelete(null)
    postDeleteModal.close()
  }

  async function confirmDeletePost() {
    if (!pendingPostDelete) {
      return
    }

    try {
      setIsDeletingPost(true)
      await deletePost(pendingPostDelete.id, userId)

      setTrip((current) => {
        if (!current) {
          return null
        }

        return {
          ...current,
          posts: current.posts.filter((post) => post.id !== pendingPostDelete.id),
        }
      })

      setPendingPostDelete(null)
      postDeleteModal.close()
    } catch (error) {
      setGlobalError(getErrorMessage(error))
    } finally {
      setIsDeletingPost(false)
    }
  }

  async function confirmDeleteTrip() {
    if (!trip) {
      return
    }

    try {
      setIsDeletingTrip(true)
      await deleteTrip(trip.id, userId)

      setTrip(null)
      setActiveTripId(null)
      setView('setup')
      setSelectedDay(1)
      setJoinCodeInput('')
      setGlobalError('')
      tripDeleteModal.close()
      entryModal.open()
      void syncSession()
    } catch (error) {
      setGlobalError(getErrorMessage(error))
    } finally {
      setIsDeletingTrip(false)
    }
  }

  function onDayChange(key: Key) {
    const numeric = Number(String(key).replace('day-', ''))

    if (Number.isInteger(numeric) && numeric >= 1) {
      setSelectedDay(numeric)
    }
  }

  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md border border-border/70 bg-surface/95">
          <Card.Content className="py-8 text-center text-muted">Checking login session...</Card.Content>
        </Card>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md border border-border/70 bg-surface/95">
          <Card.Header>
            <Card.Title className="trip-headline text-2xl">Crew Planner</Card.Title>
            <Card.Description>Login to see trips you have joined and create new ones.</Card.Description>
          </Card.Header>
          {authError && (
            <Card.Content className="pt-0">
              <p className="text-sm text-danger">{authError.message}</p>
              <p className="mt-1 text-xs text-muted">
                Check Auth0 callback URL, logout URL, and allowed web origins for {window.location.origin}.
              </p>
            </Card.Content>
          )}
          <Card.Footer className="justify-end">
            <Button className="bg-accent text-accent-foreground" onPress={() => void loginWithRedirect()}>
              Login With Auth0
            </Button>
          </Card.Footer>
        </Card>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_15%_20%,rgba(50,168,82,0.22),transparent_42%),radial-gradient(circle_at_85%_15%,rgba(225,133,61,0.2),transparent_38%),radial-gradient(circle_at_50%_95%,rgba(26,113,160,0.14),transparent_48%)]" />

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <Card className="fade-in border border-border/70 bg-surface/90 backdrop-blur-sm">
          <Card.Header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="flex flex-col gap-1">
                                              <span className="truncate flex items-center text-sm mb-2 text-muted">{username || user?.email || 'Authenticated User'}</span>

              <Card.Title className="trip-headline text-2xl sm:text-3xl">Crew Planner</Card.Title>
              <Card.Description>
                Plan day-by-day with suggestions, comments, and event times.
              </Card.Description>
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-[320px]">

              <Input
                placeholder="How should your friends see your posts?"
                value={displayNameDraft}
                onChange={(event) => setDisplayNameDraft(event.target.value)}
              />
              <div className="flex justify-end gap-2 items-center-safe">
              <span className="text-xs uppercase tracking-[0.12em] mr-auto ml-2 text-muted">Display Name</span>

                <Button
                  size="sm"
                  isDisabled={!hasUnsavedDisplayName || isSavingDisplayName || isSyncingSession}
                  onPress={saveDisplayName}
                >
                  {isSavingDisplayName ? 'Saving...' : 'Save Name'}
                </Button>
                              <div className="flex items-center justify-between gap-2 text-xs text-muted">
                <Button size="sm" onPress={() => logout({ logoutParams: { returnTo: window.location.origin } })}>
                  Logout
                </Button>
              </div>
              </div>
              
            </div>
          </Card.Header>
        </Card>

        {globalError && (
          <Card className="border border-danger/50 bg-danger/10">
            <Card.Content className="py-4 text-sm text-danger">{globalError}</Card.Content>
          </Card>
        )}

        {view === 'setup' && (
          <Card className="slide-up border border-border/70 bg-surface/95">
            <Card.Header>
              <Card.Title>Create A Trip</Card.Title>
              <Card.Description>Choose the destination and number of days for your board.</Card.Description>
            </Card.Header>

            <Card.Content className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <span className="text-sm text-muted">Trip Name</span>
                <Input value={setupTripName} onChange={(event) => setSetupTripName(event.target.value)} />
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm text-muted">Destination</span>
                <AddressPicker
                  value={setupDestination}
                  onChange={setSetupDestination}
                  placeholder="Search destination"
                />
              </div>

              <div className="flex flex-col gap-2 sm:max-w-[220px]">
                <span className="text-sm text-muted">Start Date</span>
                <Input type="date" value={setupStartDate} onChange={(event) => setSetupStartDate(event.target.value)} />
              </div>

              <div className="flex flex-col gap-2 sm:max-w-[180px]">
                <span className="text-sm text-muted">Days Staying</span>
                <Input
                  type="number"
                  min={DAY_COUNT_MIN}
                  max={DAY_COUNT_MAX}
                  value={setupDayCount}
                  onChange={(event) => setSetupDayCount(event.target.value)}
                />
              </div>
            </Card.Content>

            <Card.Footer className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              {setupError ? <p className="text-sm text-danger">{setupError}</p> : <span className="text-sm text-muted"> </span>}
              <div className="flex gap-2">
                <Button onPress={() => entryModal.open()}>Back</Button>
                <Button className="bg-accent text-accent-foreground" isDisabled={isCreatingTrip} onPress={createTripFromSetup}>
                  {isCreatingTrip ? 'Creating...' : 'Start Planning'}
                </Button>
              </div>
            </Card.Footer>
          </Card>
        )}

        {view === 'dashboard' && (
          <section className="flex flex-col gap-4">
            {!trip && (
              <Card className="border border-border/70 bg-surface/95">
                <Card.Content className="py-8 text-center text-muted">
                  {isLoadingTrip ? 'Loading trip from server...' : 'No active trip yet.'}
                </Card.Content>
              </Card>
            )}

            {trip && (
              <>
                <Card className="border border-border/70 bg-surface/95">
                  <Card.Content className="flex flex-col gap-4  justify-end-safe md:flex-row md:items-center-safe md:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip size='lg'>Group: {trip.tripName}</Chip>
                      <Chip size='lg'>Destination: {trip.destinationName}</Chip>
                      {tripDateRange && (
                        <Chip size='lg'>
                          {formatDateLong(tripDateRange.startDate)} - {formatDateLong(tripDateRange.endDate)}
                        </Chip>
                      )}
                      <Chip size='lg'>Join Code {trip.joinCode}</Chip>
                    </div>

                    <div className="flex flex-nowrap gap-2 items-end-safe ">
                      <Button className={'w-full'}
                        onPress={() => {
                          setView('setup')
                          setSetupError('')
                        }}
                      >
                        New Trip
                      </Button>
                      <Button className={'w-full'} onPress={() => entryModal.open()}>Trip Options</Button>
                      <Button  className="bg-danger w-full text-danger-foreground" onPress={() => tripDeleteModal.open()}>
                        Delete Trip
                      </Button>
                    </div>
                  </Card.Content>
                </Card>

                <Tabs.Root selectedKey={`day-${activeDay}`} onSelectionChange={onDayChange}>
                  <Card className="border border-border/70 bg-surface/95">
                    <Card.Content className="p-0 sm:p-4">
                      <Tabs.ListContainer>
                        <Tabs.List aria-label="Trip days">
                          {dayEntries.map((day) => (
                            <Tabs.Tab id={`day-${day.dayNumber}`} key={`day-tab-${day.dayNumber}`}>
                              <div className="flex flex-col items-center gap-0.5 leading-tight">
                                <span>Day {day.dayNumber}</span>
                                {day.tripDate && <span className="text-[11px] text-muted">{formatDateLabel(day.tripDate)}</span>}
                              </div>
                            </Tabs.Tab>
                          ))}
                        </Tabs.List>
                      </Tabs.ListContainer>
                    </Card.Content>
                  </Card>

                  {dayEntries.map((dayEntry) => (
                    <Tabs.Panel id={`day-${dayEntry.dayNumber}`} key={`day-panel-${dayEntry.dayNumber}`}>
                      <div className="mt-4 grid gap-4 lg:grid-cols-[380px,1fr]">
                        <Card className=" border border-border/70 bg-surface/90">
                          <Card.Header>
                            <Card.Title>Add To Day {dayEntry.dayNumber}</Card.Title>
                            <Card.Description>
                              {dayEntry.tripDate
                                ? `Post ideas for ${formatDateLong(dayEntry.tripDate)}.`
                                : 'Post ideas and events to the feed.'}
                            </Card.Description>
                          </Card.Header>

                          <Card.Content className="flex flex-col gap-3">
                            <div className="flex flex-wrap gap-2">
                              {POST_TYPES.map((type) => (
                                <Button
                                  key={type}
                                  className={
                                    composerType === type
                                      ? 'bg-accent text-accent-foreground'
                                      : 'bg-surface-tertiary text-surface-secondary-foreground'
                                  }
                                  onPress={() => {
                                    setComposerType(type)
                                    setComposerError('')
                                  }}
                                >
                                  {DEFAULT_POST_BY_TYPE[type]}
                                </Button>
                              ))}
                            </div>

                            {composerType === 'SUGGESTION' && (
                              <Input className={'border border-gray-300'}
                                placeholder="Suggestion title"
                                value={composerTitle}
                                onChange={(event) => setComposerTitle(event.target.value)}
                              />
                            )}

                            {composerType === 'EVENT' && (
                              <Input className={'border border-gray-300'}
                                placeholder="Event name"
                                value={composerEventName}
                                onChange={(event) => setComposerEventName(event.target.value)}
                              />
                            )}

                            {(composerType === 'EVENT' || composerType === 'SUGGESTION') && (
                              <div className="grid grid-cols-2 gap-2">
                                <Input
                                  type="time"
                                  value={composerFromTime}
                                  onChange={(event) => setComposerFromTime(event.target.value)}
                                />
                                <Input
                                  type="time"
                                  value={composerToTime}
                                  onChange={(event) => setComposerToTime(event.target.value)}
                                />
                              </div>
                            )}

                            <AddressPicker
                              placeholder="Location (optional)"
                              value={composerLocation}
                              onChange={setComposerLocation}
                            />

                            <div className="space-y-2">
                              <input
                                key={`post-images-${composerImageFieldVersion}`}
                                ref={composerFileInputRef}
                                className="hidden"
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={(event) => {
                                  const files = event.target.files ? Array.from(event.target.files) : []
                                  setComposerImages(files)
                                }}
                              />
                              <button
                                className="flex w-full items-center justify-between rounded-2xl border border-border/70 bg-transparent px-4 py-3 text-left transition-colors hover:bg-surface-secondary/30"
                                type="button"
                                onClick={() => composerFileInputRef.current?.click()}
                              >
                                <div>
                                  <p className="text-sm font-medium">Velg filer</p>
                                  <p className="text-xs text-muted">Upload photos to this post (max 6)</p>
                                </div>
                                <svg aria-hidden="true" className="h-7 w-7 text-muted" fill="none" viewBox="0 0 24 24">
                                  <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
                                  <circle cx="16.5" cy="8" r="1.5" fill="currentColor" />
                                  <path d="M6 17L10 13L13 16L18 11L18 17H6Z" fill="currentColor" />
                                  <path
                                    d="M7.5 10.5V6.5M7.5 6.5L6 8M7.5 6.5L9 8"
                                    stroke="currentColor"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="1.5"
                                  />
                                </svg>
                              </button>
                              {composerImages.length > 0 && (
                                <p className="text-xs text-muted">
                                  {composerImages.length} image{composerImages.length === 1 ? '' : 's'} selected.
                                </p>
                              )}
                            </div>

                            <TextArea
                              placeholder="Add extra notes for your friends..."
                              value={composerBody}
                              onChange={(event) => setComposerBody(event.target.value)}
                              rows={4}
                            />

                            {composerError && <p className="text-sm text-danger">{composerError}</p>}
                          </Card.Content>

                          <Card.Footer className="flex justify-end">
                            <Button className="bg-accent text-accent-foreground" isDisabled={isPosting} onPress={addPost}>
                              {isPosting ? 'Saving...' : `Add ${DEFAULT_POST_BY_TYPE[composerType]}`}
                            </Button>
                          </Card.Footer>
                        </Card>
                                      <div className="text-center flex flex-col text-sm text-black/70">
                                        <span>&#9679;</span>
                                        <span>&#9679;</span>
                                        <span>&#9679;</span>

                                      </div>
                        <Card className="border border-border/70 bg-surface/95 px-2.5">
                          <Card.Header className='pl-2 flex flex-col gap-1'>
                            <Card.Title className='text-lg'>Day {dayEntry.dayNumber} Feed</Card.Title>
                            <Card.Description className='text-gray-500'>
                              {dayEntry.tripDate
                                ? `Share plans for ${formatDateLong(dayEntry.tripDate)}.`
                                : 'Share suggestions and comment on plans for this day.'}
                            </Card.Description>
                          </Card.Header>

                          <Card.Content className="pb-8 ">
                            {postsForSelectedDay.length === 0 ? (
                              <div className="rounded-xl border border-dashed border-border p-6 text-center text-muted">
                                No posts yet for Day {dayEntry.dayNumber}. Start with a suggestion or event.
                              </div>
                            ) : (
                              <ScrollShadow className="max-h-[70vh] space-y-3 pr-0.5 pl-0.5 pb-8 pt-2">
                                {postsForSelectedDay.map((post, index) => (
                                  <div key={post.id} className="space-y-3">
                                    <Card className="border px-3 py-3 border-border/60 bg-surface-secondary/70">
                                    <Card.Header className="flex flex-row items-start justify-between gap-3">
                                      <div>
                                        <Card.Title className="text-base pl-1">{post.title}</Card.Title>
                                        <Card.Description className='pl-1'>
                                          {post.authorName} • {formatDateTime(post.createdAt)}
                                        </Card.Description>
                                      </div>
                                      <div className="flex items-center flex-col md:flex-row gap-2">


                                        {post.postType === 'EVENT' && (
                                          <Button
                                            className="bg-danger text-danger-foreground"
                                            size="sm"
                                            onPress={() => openPostDeleteModal(post.id, post.title)}
                                          >
                                            Delete
                                          </Button>
                                        )}
                                      </div>
                                    </Card.Header>

                                    <Card.Content className="space-y-2 ">
                                      {(post.eventName || post.fromTime || post.toTime) && (
                                        <div className="rounded-lg border border-border/70 bg-surface px-2 py-2 text-sm">
                                          {post.eventName && <span className="font-medium">{post.eventName}</span>}
                                          {(post.fromTime || post.toTime) && (
                                            <div className="text-muted">
                                              {post.fromTime || '--:--'} to {post.toTime || '--:--'}
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {post.locationName && (
                                        <div className="rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm">
                                          <span className="font-medium">Location: </span>
                                          {post.locationName}
                                        </div>
                                      )}

                                      <div className="space-y-2 rounded-lg border border-yellow-300/80 bg-yellow-50/75 px-3 py-2 text-sm">
                                        <div className="flex items-center justify-between gap-2">
                                          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-yellow-900">
                                            Challenges ({post.challenges.length}/{MAX_CHALLENGES_PER_POST})
                                          </p>
                                          <Button
                                            size="sm"
                                            isDisabled={post.challenges.length >= MAX_CHALLENGES_PER_POST}
                                            onPress={() => openChallengeModal(post.id)}
                                          >
                                            Add Challenge
                                          </Button>
                                        </div>

                                        {post.challenges.length === 0 ? (
                                          <p className="text-xs text-yellow-900/80">No challenges yet.</p>
                                        ) : (
                                          <div className="space-y-2">
                                            {post.challenges.map((challenge) => (
                                              <label
                                                key={challenge.id}
                                                className="flex cursor-pointer items-start gap-2 rounded-md border border-yellow-300 bg-yellow-100/80 px-2.5 py-2"
                                              >
                                                <input
                                                  className="mt-0.5"
                                                  type="checkbox"
                                                  checked={challenge.isCompleted}
                                                  disabled={togglingChallengeId === challenge.id}
                                                  onChange={() => toggleChallengeCompletion(post.id, challenge.id)}
                                                />
                                                <div className="min-w-0">
                                                  <p className={challenge.isCompleted ? 'text-sm text-yellow-950/70 line-through' : 'text-sm text-yellow-950'}>
                                                    <span className="font-semibold">{challenge.authorName}:</span> {challenge.challengeText}
                                                  </p>
                                                  {challenge.taggedDisplayName && (
                                                    <p className="text-xs text-yellow-900/90">@{challenge.taggedDisplayName}</p>
                                                  )}
                                                  {challenge.isCompleted && challenge.completedByDisplayName && (
                                                    <p className="text-xs text-yellow-900/80">
                                                      Checked by {challenge.completedByDisplayName}
                                                    </p>
                                                  )}
                                                </div>
                                              </label>
                                            ))}
                                          </div>
                                        )}
                                      </div>

                                      {post.body && <p className="text-sm leading-6">{post.body}</p>}

                                      {post.images.length > 0 && (
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                          {post.images.map((imageUrl, index) => (
                                            <a
                                              key={`${post.id}-image-${index}`}
                                              className="block overflow-hidden rounded-lg border border-border/70"
                                              href={imageUrl}
                                              rel="noreferrer"
                                              style={{ aspectRatio: '4 / 3' }}
                                              target="_blank"
                                            >
                                              <img
                                                alt={`Post image ${index + 1}`}
                                                className="h-full w-full object-cover"
                                                src={imageUrl}
                                              />
                                            </a>
                                          ))}
                                        </div>
                                      )}
                                      <div className='flex flex-wrap justify-end gap-2 flex-row items-center-safe'>
                                                                                {post.voterDisplayNames.length > 0 && (
                                          <div className="flex items-center gap-1 rounded-full border border-border/70 bg-surface px-2 py-1">
                                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/20 text-[10px] font-semibold text-accent">
                                              {getDisplayInitial(post.voterDisplayNames[0])}
                                            </span>
                                            <span className="max-w-[180px] truncate text-sm text-muted">
                                              {formatVoterNames(post.voterDisplayNames)}
                                            </span>
                                          </div>
                                        )}
                                        <span className="text-sm text-muted -ml-0.5"> Tenker det er noe med det{post.voteCount === 1 ? '' : ''}</span>
                                        <Button
                                          className={post.hasVoted ? 'bg-accent text-accent-foreground' : ''}
                                          isDisabled={post.hasVoted || votingPostId === post.id}
                                          size="sm"
                                          onPress={() => upvotePostById(post.id)}
                                        >
                                          {votingPostId === post.id ? 'Voting...' : `↑ ${post.voteCount}`}
                                        </Button>
                                      </div>
                                      <div className="space-y-2 rounded-xl bg-surface border-gray-300/70 border px-2 py-3">
                                        <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted pl-1">Comments</p>

                                        {post.comments.length === 0 && (
                                          <p className="text-sm text-muted pl-1">No comments yet.</p>
                                        )}

                                        {post.comments.map((comment) => (
                                          <div
                                            key={comment.id}
                                            className="rounded-md border border-border/60 bg-surface-secondary px-2.5 py-2 text-sm"
                                          >
                                            <p className="font-medium">{comment.authorName}</p>
                                            <p className="text-muted">{comment.commentBody}</p>
                                          </div>
                                        ))}

                                        <div className="flex flex-row items-center gap-2 sm:flex-row">
                                          <Input
                                            className="flex-1 w-full border border-gray-300/60"
                                            
                                            placeholder="Write a comment"
                                            value={commentDrafts[post.id] ?? ''}
                                            onChange={(event) =>
                                              setCommentDrafts((current) => ({
                                                ...current,
                                                [post.id]: event.target.value,
                                              }))
                                            }
                                          />
                                          <Button isIconOnly className={'bg-accent '} size='sm'
                                            isDisabled={commentSavingPostId === post.id}
                                            onPress={() => addComment(post.id)}
                                          >
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 24" fill="currentColor" className="size-5">
  <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
</svg>



                                          </Button>
                                        </div>
                                      </div>
                                    </Card.Content>
                                    </Card>
                                    {index < postsForSelectedDay.length - 1 && (
                                      <div className="text-center flex flex-col text-sm text-black/70">
                                        <span>&#9679;</span>

                                      </div>
                                    )}
                                  </div>
                                ))}
                              </ScrollShadow>
                            )}
                          </Card.Content>
                        </Card>
                      </div>
                    </Tabs.Panel>
                  ))}
                </Tabs.Root>
              </>
            )}
          </section>
        )}
      </main>

      <Modal.Root state={entryModal}>
        <Modal.Trigger className="sr-only">
          <span>Open trip options</span>
        </Modal.Trigger>

        <Modal.Backdrop isDismissable={false}>
          <Modal.Container placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Trip Access</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>

              <Modal.Body className="space-y-3">
                {isLoadingTrip && <p className="text-sm text-muted">Loading your saved trip...</p>}

                <div className="space-y-2">
                  <p className="text-sm font-medium">Your Trips</p>
                  {isSyncingSession ? (
                    <p className="text-sm text-muted">Loading joined trips...</p>
                  ) : joinedTrips.length === 0 ? (
                    <p className="text-sm text-muted">You have not joined any trips yet.</p>
                  ) : (
                    <div className="max-h-44 space-y-2 overflow-auto pr-1">
                      {joinedTrips.map((joinedTrip) => (
                        <div
                          key={joinedTrip.id}
                          className="flex items-center justify-between rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {joinedTrip.tripName} • {joinedTrip.destinationName}
                            </p>
                            <p className="truncate text-muted">
                              {joinedTrip.dayCount} days • code {joinedTrip.joinCode}
                            </p>
                          </div>
                          <Button size="sm" onPress={() => openJoinedTrip(joinedTrip.id)}>
                            Open
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {trip ? (
                  <div className="space-y-2">
                    <p className="text-sm text-muted">A saved trip board is ready.</p>
                    <div className="rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm">
                      <div className="font-medium">
                        {trip.tripName} • {trip.destinationName}
                      </div>
                      <div className="text-muted">
                        {trip.dayCount} days • Join code {trip.joinCode}
                      </div>
                      {tripDateRange && (
                        <div className="text-muted">
                          {formatDateLong(tripDateRange.startDate)} to {formatDateLong(tripDateRange.endDate)}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted">No saved trip loaded. Create one or join with a code.</p>
                )}

                <div className="h-px bg-separator" />

                <div className="space-y-2">
                  <p className="text-sm font-medium">Join with code</p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter 8-character code"
                      value={joinCodeInput}
                      onChange={(event) => setJoinCodeInput(event.target.value.toUpperCase())}
                    />
                    <Button isDisabled={isJoiningTrip} onPress={joinTripByCode}>
                      {isJoiningTrip ? 'Joining...' : 'Join'}
                    </Button>
                  </div>
                  {joinError && <p className="text-sm text-danger">{joinError}</p>}
                </div>
              </Modal.Body>

              <Modal.Footer className="flex justify-end gap-2">
                {trip && (
                  <Button isDisabled={isLoadingTrip} onPress={useLoadedTrip}>
                    Join This Trip
                  </Button>
                )}
                <Button className="bg-accent text-accent-foreground" onPress={openCreateTrip}>
                  Create Trip
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>

      <Modal.Root state={challengeModal}>
        <Modal.Trigger className="sr-only">
          <span>Add challenge</span>
        </Modal.Trigger>

        <Modal.Backdrop isDismissable>
          <Modal.Container placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Add Challenge</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>

              <Modal.Body className="space-y-3 px-2">
                <p className="text-sm text-muted">
                  Add a custom challenge for this post. Max {MAX_CHALLENGES_PER_POST} challenges per post.
                </p>

                <TextArea className={'w-full'}
                  placeholder="Write a custom challenge"
                  value={challengeDraft}
                  onChange={(event) => setChallengeDraft(event.target.value)}
                  rows={3}
                />

                <div className="space-y-1">
                  <p className="text-sm font-medium">Tag a group member (optional)</p>
                  <select
                    className="w-full rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm"
                    value={challengeTagUserId}
                    onChange={(event) => setChallengeTagUserId(event.target.value)}
                  >
                    <option value="">No tag</option>
                    {challengeTagOptions.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                </div>

                <p className="text-xs text-muted">
                  {(challengePostId ? (trip?.posts.find((post) => post.id === challengePostId)?.challenges.length ?? 0) : 0)}/{MAX_CHALLENGES_PER_POST} used on this post
                </p>

                {challengeError && <p className="text-sm text-danger">{challengeError}</p>}
              </Modal.Body>

              <Modal.Footer className="flex justify-end gap-2">
                <Button onPress={closeChallengeModal}>Cancel</Button>
                <Button
                  className="bg-accent text-accent-foreground"
                  isDisabled={
                    !challengePostId
                    || isCreatingChallenge
                    || (challengePostId ? (trip?.posts.find((post) => post.id === challengePostId)?.challenges.length ?? 0) : 0) >= MAX_CHALLENGES_PER_POST
                  }
                  onPress={addChallengeToPost}
                >
                  {isCreatingChallenge ? 'Adding...' : 'Add Challenge'}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>

      <Modal.Root state={postDeleteModal}>
        <Modal.Trigger className="sr-only">
          <span>Confirm post deletion</span>
        </Modal.Trigger>

        <Modal.Backdrop isDismissable={!isDeletingPost}>
          <Modal.Container placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Delete Event?</Modal.Heading>
                <Modal.CloseTrigger isDisabled={isDeletingPost} />
              </Modal.Header>

              <Modal.Body>
                <p className="text-sm text-muted">
                  {pendingPostDelete
                    ? `Are you sure you want to delete "${pendingPostDelete.title}"?`
                    : 'Are you sure you want to delete this event?'}
                </p>
                <p className="mt-2 text-sm text-muted">This action cannot be undone.</p>
              </Modal.Body>

              <Modal.Footer className="flex justify-end gap-2">
                <Button isDisabled={isDeletingPost} onPress={closePostDeleteModal}>
                  Cancel
                </Button>
                <Button className="bg-danger text-danger-foreground" isDisabled={isDeletingPost} onPress={confirmDeletePost}>
                  {isDeletingPost ? 'Deleting...' : 'Delete Event'}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>

      <Modal.Root state={tripDeleteModal}>
        <Modal.Trigger className="sr-only">
          <span>Confirm trip deletion</span>
        </Modal.Trigger>

        <Modal.Backdrop isDismissable={!isDeletingTrip}>
          <Modal.Container placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Delete Trip?</Modal.Heading>
                <Modal.CloseTrigger isDisabled={isDeletingTrip} />
              </Modal.Header>

              <Modal.Body>
                <p className="text-sm text-muted">
                  This will archive the current trip board and hide all feed posts from the app.
                </p>
                <p className="mt-2 text-sm text-muted">Are you sure you want to continue?</p>
              </Modal.Body>

              <Modal.Footer className="flex justify-end gap-2">
                <Button isDisabled={isDeletingTrip} onPress={() => tripDeleteModal.close()}>
                  Cancel
                </Button>
                <Button className="bg-danger text-danger-foreground" isDisabled={isDeletingTrip} onPress={confirmDeleteTrip}>
                  {isDeletingTrip ? 'Deleting...' : 'Delete Trip'}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>
    </div>
  )
}
