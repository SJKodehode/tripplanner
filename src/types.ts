export type ComposerType = 'SUGGESTION' | 'EVENT' | 'CRAWL'

export interface TripDay {
  dayNumber: number
  label: string
  tripDate: string | null
}

export interface TripSummary {
  id: string
  joinCode: string
  tripName: string
  destinationName: string
  startDate: string | null
  dayCount: number
  updatedAt: string
}

export interface FeedComment {
  id: string
  authorName: string
  commentBody: string
  createdAt: string
}

export interface FeedChallenge {
  id: string
  authorUserId: string
  authorName: string
  challengeText: string
  taggedUserId: string | null
  taggedDisplayName: string | null
  isCompleted: boolean
  completedByUserId: string | null
  completedByDisplayName: string | null
  createdAt: string
}

export interface FeedCrawlLocationChallenge {
  id: string
  authorUserId: string
  authorName: string
  challengeText: string
  isCompleted: boolean
  completedByUserId: string | null
  completedByDisplayName: string | null
  createdAt: string
}

export interface FeedCrawlLocation {
  id: string
  sortOrder: number
  locationName: string
  latitude: string
  longitude: string
  isCompleted: boolean
  images: string[]
  challenges: FeedCrawlLocationChallenge[]
}

export interface FeedPost {
  id: string
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
  authorUserId: string
  authorName: string
  createdAt: string
  voteCount: number
  hasVoted: boolean
  voterDisplayNames: string[]
  images: string[]
  challenges: FeedChallenge[]
  crawlLocations: FeedCrawlLocation[]
  comments: FeedComment[]
}

export interface TripMember {
  userId: string
  displayName: string
}

export interface TripData {
  id: string
  joinCode: string
  tripName: string
  destinationName: string
  startDate: string | null
  dayCount: number
  createdAt: string
  days: TripDay[]
  members: TripMember[]
  posts: FeedPost[]
}
