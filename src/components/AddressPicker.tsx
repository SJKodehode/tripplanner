import { useEffect, useRef } from 'react'
import { useMapsLibrary } from '@vis.gl/react-google-maps'

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

export default function AddressPicker({
  value,
  onChange,
  onSelect,
  placeholder = 'Search address',
  className = '',
}: AddressPickerProps) {
  const placesLibrary = useMapsLibrary('places')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const autocompleteRef = useRef<{
    addListener: (eventName: string, callback: () => void) => { remove: () => void }
    getPlace: () => {
      formatted_address?: string
      name?: string
      geometry?: {
        location?: {
          lat?: () => number
          lng?: () => number
        }
      }
    }
  } | null>(null)
  const onChangeRef = useRef(onChange)
  const onSelectRef = useRef(onSelect)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    if (!placesLibrary || !inputRef.current || autocompleteRef.current) {
      return
    }

    const autocompleteCtor = (placesLibrary as unknown as {
      Autocomplete: new (
        input: HTMLInputElement,
        options: {
          fields: string[]
          types: string[]
        },
      ) => {
        addListener: (eventName: string, callback: () => void) => { remove: () => void }
        getPlace: () => {
          formatted_address?: string
          name?: string
          geometry?: {
            location?: {
              lat?: () => number
              lng?: () => number
            }
          }
        }
      }
    }).Autocomplete

    const autocomplete = new autocompleteCtor(inputRef.current, {
      fields: ['formatted_address', 'name', 'geometry'],
      types: ['geocode'],
    })

    autocompleteRef.current = autocomplete

    const listener = autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace()
      const address = place.formatted_address || place.name || inputRef.current?.value || ''
      const lat = place.geometry?.location?.lat?.() ?? null
      const lng = place.geometry?.location?.lng?.() ?? null

      onChangeRef.current(address)
      onSelectRef.current?.({ address, lat, lng })
    })

    return () => {
      listener.remove()
      autocompleteRef.current = null
    }
  }, [placesLibrary])

  return (
    <input
      ref={inputRef}
      className={`w-full rounded-[var(--field-radius)] border border-border bg-field-background px-3 py-2 text-field-foreground outline-none transition-colors placeholder:text-field-placeholder focus:border-focus ${className}`}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
