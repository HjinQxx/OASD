import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react'
import type { Coordinates, SavedPlace } from '../types/map'
import {
  clamp,
  clampToServiceArea,
  coordinatesToWorld,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  isWithinServiceArea,
  MAX_ZOOM,
  MIN_ZOOM,
  parseCoordinateSearch,
  SERVICE_BOUNDS,
  TILE_RADIUS,
  TILE_SIZE,
  tileIntersectsServiceArea,
  worldToCoordinates,
} from './mapMath'

type MapTile = {
  key: string
  src: string
  xOffset: number
  yOffset: number
}

type SearchResult = Coordinates & {
  name: string
  address: string
}

type NominatimResult = {
  display_name: string
  lat: string
  lon: string
}

type OSMMapProps = {
  savedPlaces: SavedPlace[]
}

function getSearchUrl(query: string) {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '8',
    countrycodes: 'kr',
    bounded: '1',
    'accept-language': 'ko',
    viewbox: [
      SERVICE_BOUNDS.minLongitude,
      SERVICE_BOUNDS.maxLatitude,
      SERVICE_BOUNDS.maxLongitude,
      SERVICE_BOUNDS.minLatitude,
    ].join(','),
  })

  return `https://nominatim.openstreetmap.org/search?${params.toString()}`
}

export function OSMMap({ savedPlaces }: OSMMapProps) {
  const [center, setCenter] = useState<Coordinates>(DEFAULT_CENTER)
  const [currentLocation, setCurrentLocation] = useState<Coordinates | null>(null)
  const [selectedPlace, setSelectedPlace] = useState<SavedPlace | null>(null)
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [searchSuggestions, setSearchSuggestions] = useState<SearchResult[]>([])
  const [alertMessage, setAlertMessage] = useState('')
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [query, setQuery] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    centerWorldX: number
    centerWorldY: number
  } | null>(null)

  const centerWorld = useMemo(() => coordinatesToWorld(center, zoom), [center, zoom])

  const requestCurrentLocation = () => {
    if (!navigator.geolocation) {
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }
        const nextCenter = isWithinServiceArea(nextLocation)
          ? nextLocation
          : DEFAULT_CENTER

        setCenter(nextCenter)
        setCurrentLocation(isWithinServiceArea(nextLocation) ? nextLocation : null)
        setSelectedPlace(null)
      },
      (error) => {
        console.warn(error)
        setCenter(DEFAULT_CENTER)
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30_000,
        timeout: 10_000,
      },
    )
  }

  useEffect(() => {
    requestCurrentLocation()
  }, [])

  const tiles = useMemo(() => {
    const baseTileX = Math.floor(centerWorld.x / TILE_SIZE)
    const baseTileY = Math.floor(centerWorld.y / TILE_SIZE)
    const maxTile = 2 ** zoom
    const tileItems: MapTile[] = []

    for (let yOffset = -TILE_RADIUS; yOffset <= TILE_RADIUS; yOffset += 1) {
      for (let xOffset = -TILE_RADIUS; xOffset <= TILE_RADIUS; xOffset += 1) {
        const rawX = baseTileX + xOffset
        const rawY = baseTileY + yOffset

        if (
          rawY < 0 ||
          rawY >= maxTile ||
          !tileIntersectsServiceArea(rawX, rawY, zoom)
        ) {
          continue
        }

        const wrappedX = ((rawX % maxTile) + maxTile) % maxTile

        tileItems.push({
          key: `${zoom}-${rawX}-${rawY}`,
          src: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${rawY}.png`,
          xOffset: rawX * TILE_SIZE - centerWorld.x,
          yOffset: rawY * TILE_SIZE - centerWorld.y,
        })
      }
    }

    return tileItems
  }, [centerWorld, zoom])

  const placeMarkers = useMemo(
    () =>
      savedPlaces.map((place) => {
        const placeWorld = coordinatesToWorld(place, zoom)

        return {
          ...place,
          xOffset: placeWorld.x - centerWorld.x,
          yOffset: placeWorld.y - centerWorld.y,
        }
      }),
    [centerWorld, savedPlaces, zoom],
  )

  const currentLocationMarker = useMemo(() => {
    if (!currentLocation) {
      return null
    }

    const locationWorld = coordinatesToWorld(currentLocation, zoom)

    return {
      xOffset: locationWorld.x - centerWorld.x,
      yOffset: locationWorld.y - centerWorld.y,
    }
  }, [centerWorld, currentLocation, zoom])

  const searchMarker = useMemo(() => {
    if (!searchResult) {
      return null
    }

    const resultWorld = coordinatesToWorld(searchResult, zoom)

    return {
      ...searchResult,
      xOffset: resultWorld.x - centerWorld.x,
      yOffset: resultWorld.y - centerWorld.y,
    }
  }, [centerWorld, searchResult, zoom])

  const moveTo = (coordinates: Coordinates, nextZoom = zoom) => {
    setCenter(clampToServiceArea(coordinates))
    setZoom(clamp(nextZoom, MIN_ZOOM, MAX_ZOOM))
  }

  const zoomBy = (amount: number) => {
    setZoom((value) => clamp(value + amount, MIN_ZOOM, MAX_ZOOM))
  }

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedQuery = query.trim()

    if (!trimmedQuery || isSearching) {
      return
    }

    const normalizedQuery = trimmedQuery.toLowerCase()
    const coordinateResult = parseCoordinateSearch(trimmedQuery)
    const placeResult = savedPlaces.find((place) =>
      [place.name, place.description, ...(place.aliases ?? [])].some((keyword) =>
        keyword.toLowerCase().replace(/\s/g, '').includes(
          normalizedQuery.replace(/\s/g, ''),
        ),
      ),
    )

    if (coordinateResult) {
      setSelectedPlace(null)
      setSearchSuggestions([
        {
          ...coordinateResult,
          name: trimmedQuery,
          address: '입력한 좌표',
        },
      ])
      setAlertMessage('')
      return
    }

    if (placeResult) {
      setSearchSuggestions([{
        name: placeResult.name,
        address: placeResult.description,
        latitude: placeResult.latitude,
        longitude: placeResult.longitude,
      }])
      setAlertMessage('')
      return
    }

    setIsSearching(true)

    try {
      const response = await fetch(getSearchUrl(trimmedQuery))

      if (!response.ok) {
        throw new Error('Search request failed')
      }

      const results = (await response.json()) as NominatimResult[]
      const serviceAreaResults = results
        .map((result) => ({
          latitude: Number(result.lat),
          longitude: Number(result.lon),
          name: result.display_name.split(',')[0] || trimmedQuery,
          address: result.display_name,
        }))
        .filter((result) => isWithinServiceArea(result))

      if (serviceAreaResults.length === 0) {
        setSearchSuggestions([])
        setAlertMessage('현재 지원하지 않는 장소입니다')
        return
      }

      setSearchSuggestions(serviceAreaResults)
      setAlertMessage('')
    } catch (error) {
      console.warn(error)
    } finally {
      setIsSearching(false)
    }
  }

  const selectSearchResult = (result: SearchResult) => {
    setSelectedPlace(null)
    setSearchResult(result)
    setSearchSuggestions([])
    setQuery(result.name)
    setAlertMessage('')
    moveTo(result, Math.max(zoom, 13))
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      centerWorldX: centerWorld.x,
      centerWorldY: centerWorld.y,
    }
    setIsDragging(true)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
      return
    }

    const deltaX = event.clientX - dragRef.current.startX
    const deltaY = event.clientY - dragRef.current.startY

    setCenter(
      worldToCoordinates(
        {
          x: dragRef.current.centerWorldX - deltaX,
          y: dragRef.current.centerWorldY - deltaY,
        },
        zoom,
      ),
    )
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
      setIsDragging(false)
    }
  }

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    zoomBy(event.deltaY > 0 ? -1 : 1)
  }

  return (
    <section className="mapShell" aria-label="OpenStreetMap 지도">
      <form className="searchBar" onSubmit={handleSearch}>
        <div className="searchInputRow">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="서울·경기 장소 검색"
            aria-label="서울과 경기도 장소 검색"
          />
          <button type="submit" aria-label="검색" disabled={isSearching}>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m16 16 4 4" />
            </svg>
          </button>
        </div>

        {searchSuggestions.length > 0 && (
          <div className="searchSuggestions">
            {searchSuggestions.map((result) => (
              <button
                key={`${result.name}-${result.latitude}-${result.longitude}`}
                type="button"
                onClick={() => selectSearchResult(result)}
              >
                <strong>{result.name}</strong>
                <span>{result.address}</span>
              </button>
            ))}
          </div>
        )}
      </form>

      <div
        className={`mapViewport ${isDragging ? 'dragging' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <div
          className="tileGrid"
          style={
            {
              '--tile-size': `${TILE_SIZE}px`,
            } as CSSProperties
          }
        >
          {tiles.map((tile) => (
            <img
              key={tile.key}
              src={tile.src}
              alt=""
              draggable="false"
              style={{
                transform: `translate(${tile.xOffset}px, ${tile.yOffset}px)`,
              }}
            />
          ))}
        </div>

        {placeMarkers.map((place) => (
          <button
            className={`placeMarker ${
              selectedPlace?.name === place.name ? 'selected' : ''
            }`}
            key={place.name}
            type="button"
            onClick={() => {
              setSelectedPlace(place)
              moveTo(place)
            }}
            style={{
              transform: `translate(${place.xOffset}px, ${place.yOffset}px)`,
            }}
            aria-label={`${place.name} 보기`}
          >
            <span />
          </button>
        ))}

        {searchMarker && (
          <div
            className="searchMarker"
            style={{
              transform: `translate(${searchMarker.xOffset}px, ${searchMarker.yOffset}px)`,
            }}
            aria-label={`${searchMarker.name} 검색 결과`}
          />
        )}

        {currentLocationMarker && (
          <div
            className="currentMarker"
            style={{
              transform: `translate(${currentLocationMarker.xOffset}px, ${currentLocationMarker.yOffset}px)`,
            }}
            aria-label="현재 위치"
          >
            <span />
          </div>
        )}
      </div>

      <div className="zoomControls" aria-label="지도 확대 축소">
        <button type="button" onClick={() => zoomBy(1)} aria-label="확대">
          +
        </button>
        <button type="button" onClick={() => zoomBy(-1)} aria-label="축소">
          -
        </button>
      </div>

      <button className="locateButton" type="button" onClick={requestCurrentLocation}>
        현재 위치
      </button>

      {alertMessage && (
        <div className="mapAlert" role="alert">
          <span>{alertMessage}</span>
          <button type="button" onClick={() => setAlertMessage('')} aria-label="닫기">
            ×
          </button>
        </div>
      )}

      <a
        className="attribution"
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
      >
        © OpenStreetMap contributors
      </a>
    </section>
  )
}
