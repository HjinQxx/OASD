import type { Coordinates } from '../types/map'

type NaverMapStatus = 'OK' | 'ERROR' | 'ZERO_RESULT'

type NaverGeocodeAddress = {
  roadAddress?: string
  jibunAddress?: string
  englishAddress?: string
  x: string
  y: string
}

type NaverGeocodeResponse = {
  v2?: {
    addresses: NaverGeocodeAddress[]
  }
}

type NaverLatLng = Coordinates & {
  lat?: () => number
  lng?: () => number
}

type NaverMapClickEvent = {
  coord: NaverLatLng
}

declare global {
  interface Window {
    naver?: {
      maps: {
        Event: {
          addListener: (
            target: unknown,
            eventName: string,
            listener: (event: NaverMapClickEvent) => void,
          ) => unknown
        }
        LatLng: new (latitude: number, longitude: number) => NaverLatLng
        LatLngBounds: new (
          southWest: Coordinates,
          northEast: Coordinates,
        ) => unknown
        Map: new (
          element: HTMLElement,
          options: {
            center: Coordinates
            zoom: number
            minZoom?: number
            maxZoom?: number
            maxBounds?: unknown
            zoomControl?: boolean
            zoomControlOptions?: {
              position: unknown
              style: unknown
            }
          },
        ) => {
          setCenter: (coordinates: Coordinates) => void
          setZoom: (zoom: number) => void
        }
        Marker: new (options: {
          position: Coordinates
          map: unknown
          icon?: unknown
        }) => {
          setMap: (map: unknown | null) => void
          setPosition: (coordinates: Coordinates) => void
        }
        Polyline: new (options: {
          path: Coordinates[]
          map: unknown
          strokeColor?: string
          strokeOpacity?: number
          strokeWeight?: number
          strokeLineCap?: string
          strokeLineJoin?: string
        }) => {
          setMap: (map: unknown | null) => void
          setPath: (path: Coordinates[]) => void
        }
        Position: {
          TOP_RIGHT: unknown
        }
        Service: {
          geocode: (
            options: { query: string },
            callback: (
              status: NaverMapStatus,
              response: NaverGeocodeResponse,
            ) => void,
          ) => void
        }
        ZoomControlStyle: {
          SMALL: unknown
        }
      }
    }
  }
}

export {}
