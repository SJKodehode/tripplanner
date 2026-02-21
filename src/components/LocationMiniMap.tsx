import { useContext, useMemo } from 'react'
import { APIProviderContext, Map, Marker, useApiIsLoaded } from '@vis.gl/react-google-maps'

interface LocationMiniMapProps {
  latitude: string
  longitude: string
  className?: string
}

function parseCoordinate(rawValue: string, min: number, max: number): number | null {
  const parsed = Number(rawValue)

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return null
  }

  return parsed
}

export default function LocationMiniMap({ latitude, longitude, className = '' }: LocationMiniMapProps) {
  const apiProviderContext = useContext(APIProviderContext)
  const apiIsLoaded = useApiIsLoaded()

  const center = useMemo(() => {
    const lat = parseCoordinate(latitude, -90, 90)
    const lng = parseCoordinate(longitude, -180, 180)

    if (lat == null || lng == null) {
      return null
    }

    return { lat, lng }
  }, [latitude, longitude])

  const containerClassName = `mt-2 overflow-hidden rounded-md border border-border/70 bg-surface-secondary/30 ${className}`.trim()

  if (!center) {
    return (
      <div className={containerClassName}>
        <div className="flex h-[140px] items-center justify-center px-3 text-center text-xs text-muted">
          No map coordinates set for this stop.
        </div>
      </div>
    )
  }

  if (!apiProviderContext || !apiIsLoaded) {
    return (
      <div className={containerClassName}>
        <div className="flex h-[140px] items-center justify-center px-3 text-center text-xs text-muted">
          Map preview unavailable.
        </div>
      </div>
    )
  }

  return (
    <div className={containerClassName}>
      <Map
        center={center}
        zoom={14}
        disableDefaultUI
        clickableIcons={false}
        gestureHandling="cooperative"
        style={{ width: '100%', height: '140px' }}
      >
        <Marker position={center} />
      </Map>
    </div>
  )
}
