/// <reference types="google.maps" />

import { useContext, useEffect, useRef, useState } from 'react'
import { APIProviderContext, Map, Marker, useApiIsLoaded, useMapsLibrary } from '@vis.gl/react-google-maps'

interface AddressPickerSelection {
  address: string
  lat: number | null
  lng: number | null
}

interface AddressPickerProps {
  value: string
  onChange: (value: string) => void
  onSelect?: (selection: AddressPickerSelection) => void
  placeholder?: string
  className?: string
}

interface AddressSuggestion {
  id: string
  primaryText: string
  secondaryText: string
  placePrediction: google.maps.places.PlacePrediction
}

const DEFAULT_MAP_CENTER: google.maps.LatLngLiteral = {
  lat: 39.8283,
  lng: -98.5795,
}

export default function AddressPicker({
  value,
  onChange,
  onSelect,
  placeholder = 'Search address',
  className = '',
}: AddressPickerProps) {
  const apiProviderContext = useContext(APIProviderContext)
  const apiIsLoaded = useApiIsLoaded()
  const placesLibrary = useMapsLibrary('places')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const onChangeRef = useRef(onChange)
  const onSelectRef = useRef(onSelect)
  const geocoderRef = useRef<google.maps.Geocoder | null>(null)
  const autocompleteRequestIdRef = useRef<number>(0)
  const geocodeRequestIdRef = useRef<number>(0)
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null)
  const suppressAutocompleteRef = useRef<boolean>(false)
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState<boolean>(false)
  const [mapCenter, setMapCenter] = useState<google.maps.LatLngLiteral | null>(null)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node

      if (rootRef.current?.contains(target)) {
        return
      }

      setIsSuggestionsOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)

    return () => {
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [])

  useEffect(() => {
    if (!placesLibrary) {
      return
    }

    const query = value.trim()

    if (query.length < 3) {
      sessionTokenRef.current = null
      suppressAutocompleteRef.current = false
      return
    }

    if (suppressAutocompleteRef.current) {
      suppressAutocompleteRef.current = false
      return
    }

    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new placesLibrary.AutocompleteSessionToken()
    }

    const requestId = ++autocompleteRequestIdRef.current
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await placesLibrary.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          sessionToken: sessionTokenRef.current ?? undefined,
        })

        if (requestId !== autocompleteRequestIdRef.current) {
          return
        }

        const nextSuggestions = response.suggestions
          .map((suggestion, index) => {
            const placePrediction = suggestion.placePrediction

            if (!placePrediction) {
              return null
            }

            return {
              id: placePrediction.placeId || `${query}-${index}`,
              primaryText: placePrediction.mainText?.text || placePrediction.text.text,
              secondaryText: placePrediction.secondaryText?.text ?? '',
              placePrediction,
            }
          })
          .filter((suggestion): suggestion is AddressSuggestion => suggestion !== null)

        setSuggestions(nextSuggestions)
        setIsSuggestionsOpen(nextSuggestions.length > 0)
      } catch {
        if (requestId !== autocompleteRequestIdRef.current) {
          return
        }

        setSuggestions([])
        setIsSuggestionsOpen(false)
      }
    }, 250)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [placesLibrary, value])

  useEffect(() => {
    if (value.trim()) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setMapCenter(null)
      setSuggestions([])
      setIsSuggestionsOpen(false)
      sessionTokenRef.current = null
      suppressAutocompleteRef.current = false
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [value])

  useEffect(() => {
    if (!apiIsLoaded) {
      return
    }

    const query = value.trim()

    if (!query) {
      return
    }

    const requestId = ++geocodeRequestIdRef.current
    const timeoutId = window.setTimeout(async () => {
      if (!geocoderRef.current) {
        geocoderRef.current = new google.maps.Geocoder()
      }

      try {
        const result = await geocoderRef.current.geocode({ address: query })

        if (requestId !== geocodeRequestIdRef.current) {
          return
        }

        const location = result.results[0]?.geometry?.location

        if (!location) {
          return
        }

        const lat = location.lat()
        const lng = location.lng()

        setMapCenter({ lat, lng })
        onSelectRef.current?.({ address: query, lat, lng })
      } catch {
        // Ignore geocode failures while the user is typing.
      }
    }, 500)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [apiIsLoaded, value])

  async function handleSuggestionSelect(suggestion: AddressSuggestion) {
    try {
      const place = suggestion.placePrediction.toPlace()
      await place.fetchFields({
        fields: ['formattedAddress', 'displayName', 'location'],
      })

      const address = place.formattedAddress || place.displayName || suggestion.primaryText || value.trim()
      const lat = place.location?.lat() ?? null
      const lng = place.location?.lng() ?? null

      onChangeRef.current(address)
      onSelectRef.current?.({ address, lat, lng })
      setMapCenter(lat != null && lng != null ? { lat, lng } : null)
      setSuggestions([])
      setIsSuggestionsOpen(false)
      suppressAutocompleteRef.current = true
      sessionTokenRef.current = placesLibrary ? new placesLibrary.AutocompleteSessionToken() : null
    } catch {
      setIsSuggestionsOpen(false)
    }
  }

  const previewCenter = mapCenter ?? DEFAULT_MAP_CENTER
  const previewZoom = mapCenter ? 14 : 3
  const canRenderMap = Boolean(apiProviderContext) && apiIsLoaded

  return (
    <div ref={rootRef} className="space-y-2">
      <div className="overflow-hidden rounded-[var(--field-radius)] border border-border bg-surface-secondary/30">
        {canRenderMap ? (
          <Map
            center={previewCenter}
            zoom={previewZoom}
            disableDefaultUI
            clickableIcons={false}
            gestureHandling="cooperative"
            style={{ width: '100%', height: '220px' }}
          >
            {mapCenter && <Marker position={mapCenter} />}
          </Map>
        ) : (
          <div className="flex h-[220px] items-center justify-center px-3 text-center text-xs text-muted">
            Add `VITE_GOOGLE_MAPS_API_KEY` to enable map preview.
          </div>
        )}
      </div>

      <div className="relative">
        <input
          className={`w-full rounded-[var(--field-radius)] border border-border bg-field-background px-3 py-2 text-field-foreground outline-none transition-colors placeholder:text-field-placeholder focus:border-focus ${className}`}
          placeholder={placeholder}
          value={value}
          onFocus={() => {
            if (suggestions.length > 0) {
              setIsSuggestionsOpen(true)
            }
          }}
          onChange={(event) => {
            const nextValue = event.target.value
            const trimmedValue = nextValue.trim()
            onChange(nextValue)

            if (trimmedValue.length < 3) {
              setSuggestions([])
              setIsSuggestionsOpen(false)
              sessionTokenRef.current = null
            }

            if (!trimmedValue) {
              setMapCenter(null)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setIsSuggestionsOpen(false)
              return
            }

            if (event.key === 'Enter' && isSuggestionsOpen && suggestions.length > 0) {
              event.preventDefault()
              void handleSuggestionSelect(suggestions[0])
            }
          }}
        />

        {Boolean(placesLibrary) && value.trim().length >= 3 && isSuggestionsOpen && suggestions.length > 0 && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-[var(--field-radius)] border border-border bg-surface shadow-lg">
            <ul className="max-h-56 overflow-y-auto py-1">
              {suggestions.map((suggestion) => (
                <li key={suggestion.id}>
                  <button
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-surface-secondary/60"
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void handleSuggestionSelect(suggestion)}
                  >
                    <span className="text-sm text-field-foreground">{suggestion.primaryText}</span>
                    {suggestion.secondaryText && <span className="text-xs text-muted">{suggestion.secondaryText}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
