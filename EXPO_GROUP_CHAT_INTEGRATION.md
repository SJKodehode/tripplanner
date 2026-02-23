# Expo Integration Guide: Trip Group Messages

This guide shows how to use the new group chat endpoints from an Expo app.

## Endpoints

- `GET /api/trips/:tripId/messages`
- `POST /api/trips/:tripId/messages`

Both endpoints require:

- `Authorization: Bearer <Auth0 access token>`
- User must already be an active member of the trip

## Request/Response Contract

`GET /api/trips/:tripId/messages?limit=50&before=<ISO_DATETIME>`

- `limit` optional, default `50`, min `1`, max `200`
- `before` optional ISO datetime cursor (example: `2026-02-23T21:25:00.000Z`)
- Response:

```json
{
  "messages": [
    {
      "id": "5f4b4b73-6fe8-4f29-86aa-b95d23664593",
      "tripId": "63842ea8-0fb0-4afc-89bf-94890d6712fd",
      "authorUserId": "8b29ea56-7f55-48c3-b457-2f6ceaf14f00",
      "authorName": "Jorge",
      "messageBody": "Landing at 7:30, meet at baggage claim",
      "createdAt": "2026-02-23T21:20:19.000Z"
    }
  ],
  "hasMore": true
}
```

Note: each page is returned in ascending time order (oldest -> newest for that page).

`POST /api/trips/:tripId/messages`

- Body:

```json
{
  "messageBody": "Dinner at 8?",
  "displayName": "Jorge"
}
```

- `displayName` is optional.
- `messageBody` is required, trimmed server-side, max `2000` chars.
- Response:

```json
{
  "message": {
    "id": "e4f20d75-66d2-48ff-aec0-9b463ee8cfec",
    "tripId": "63842ea8-0fb0-4afc-89bf-94890d6712fd",
    "authorUserId": "8b29ea56-7f55-48c3-b457-2f6ceaf14f00",
    "authorName": "Jorge",
    "messageBody": "Dinner at 8?",
    "createdAt": "2026-02-23T21:25:02.000Z"
  }
}
```

## Expo Setup

Add your API base URL:

```env
EXPO_PUBLIC_API_BASE_URL=https://your-api-domain.com
```

Use any Auth0 Expo flow you already have. The only requirement here is getting a valid API access token with your configured audience.

## TypeScript Models

```ts
export type TripMessage = {
  id: string
  tripId: string
  authorUserId: string
  authorName: string
  messageBody: string
  createdAt: string
}

export type GetTripMessagesResponse = {
  messages: TripMessage[]
  hasMore: boolean
}

export type SendTripMessageResponse = {
  message: TripMessage
}
```

## API Helper (Expo)

```ts
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL!

async function apiRequest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Request failed: ${response.status}`)
  }

  return (await response.json()) as T
}

export async function getTripMessages(
  tripId: string,
  token: string,
  options?: { limit?: number; before?: string },
) {
  const params = new URLSearchParams()
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.before) params.set('before', options.before)

  const query = params.toString()
  const path = `/api/trips/${tripId}/messages${query ? `?${query}` : ''}`
  return apiRequest<GetTripMessagesResponse>(path, token)
}

export async function sendTripMessage(
  tripId: string,
  token: string,
  input: { messageBody: string; displayName?: string },
) {
  return apiRequest<SendTripMessageResponse>(`/api/trips/${tripId}/messages`, token, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
```

## Pagination Pattern

1. Load latest page: `getTripMessages(tripId, token, { limit: 50 })`
2. Save cursor as the oldest loaded message timestamp:
`const oldest = messages[0]?.createdAt`
3. Load older page:
`getTripMessages(tripId, token, { limit: 50, before: oldest })`
4. Prepend older messages:
`setMessages((prev) => [...olderPage.messages, ...prev])`

## Send + Reconcile Pattern

1. On send, call `sendTripMessage(...)`.
2. Append `response.message` to local state immediately.
3. Use polling to catch messages from other users (for example every 3-5 seconds while the screen is focused).

Minimal merge helper:

```ts
function mergeById(current: TripMessage[], incoming: TripMessage[]) {
  const map = new Map<string, TripMessage>()
  for (const message of current) map.set(message.id, message)
  for (const message of incoming) map.set(message.id, message)
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
}
```

## Common Errors

- `400` invalid `limit`, invalid `before`, or missing `messageBody`
- `401` missing/invalid token
- `403` user is not an active trip member
- `500` server/database error

## Quick Manual Test

```bash
curl -H "Authorization: Bearer <TOKEN>" \
  "https://your-api-domain.com/api/trips/<TRIP_ID>/messages?limit=20"
```

```bash
curl -X POST -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"messageBody":"hello from expo"}' \
  "https://your-api-domain.com/api/trips/<TRIP_ID>/messages"
```
