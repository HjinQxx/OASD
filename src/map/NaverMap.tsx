import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { Coordinates, SavedPlace } from '../types/map'
import {
  fetchTransitRoutes,
  type TransitRoute,
  type TransitRouteStep,
} from '../features/routes/transitRoutes'
import {
  fetchBusArrival,
  fetchSubwayArrival,
  type RealtimeArrivalState,
} from '../features/routes/realtimeTransit'
import {
  createSpeedSample,
  getPreferredWalkingSpeed,
  getWalkStats,
  loadSpeedSamples,
  saveSpeedSamples,
  SPEED_SAMPLES_UPDATED_EVENT,
  type WalkPoint,
} from '../features/speed/speedTracking'
import {
  clampToServiceArea,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  getDistanceMeters,
  isWithinServiceArea,
  MAX_ZOOM,
  MIN_ZOOM,
  parseCoordinateSearch,
  SERVICE_BOUNDS,
} from './mapMath'
import { loadNaverMap } from './loadNaverMap'

type SearchResult = Coordinates & {
  name: string
  address: string
}

type TransitModeFilter = 'all' | 'subway' | 'bus'
type TimeFilter = 'all' | 'under30' | '30to60' | '60to120' | 'over120'
const ARRIVAL_REFRESH_INTERVAL_SECONDS = 60
const DEFAULT_WALKING_SPEED_MPS = 1.39
const AUTO_WALK_START_DISTANCE_METERS = 60
const AUTO_WALK_POINT_MIN_DISTANCE_METERS = 5
const AUTO_WALK_MAX_ACCURACY_METERS = 40

type NaverMapProps = {
  savedPlaces: SavedPlace[]
  isPickingPlace: boolean
  onPickPlaceLocation: (coordinates: Coordinates) => void
}

export function NaverMap({
  savedPlaces,
  isPickingPlace,
  onPickPlaceLocation,
}: NaverMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<InstanceType<NonNullable<typeof window.naver>['maps']['Map']> | null>(
    null,
  )
  const currentMarkerRef = useRef<
    InstanceType<NonNullable<typeof window.naver>['maps']['Marker']> | null
  >(null)
  const searchMarkerRef = useRef<
    InstanceType<NonNullable<typeof window.naver>['maps']['Marker']> | null
  >(null)
  const pickedPlaceMarkerRef = useRef<
    InstanceType<NonNullable<typeof window.naver>['maps']['Marker']> | null
  >(null)
  const routePolylineRefs = useRef<
    InstanceType<NonNullable<typeof window.naver>['maps']['Polyline']>[]
  >([])
  const routeWalkWatchIdRef = useRef<number | null>(null)
  const routeWalkPointsRef = useRef<WalkPoint[]>([])
  const routeWalkLabelRef = useRef<string | null>(null)
  const isPickingPlaceRef = useRef(isPickingPlace)
  const onPickPlaceLocationRef = useRef(onPickPlaceLocation)
  const [query, setQuery] = useState('')
  const [searchSuggestions, setSearchSuggestions] = useState<SearchResult[]>([])
  const [alertMessage, setAlertMessage] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false)
  const [isMapReady, setIsMapReady] = useState(false)
  const [mapStatusText, setMapStatusText] = useState('네이버 지도를 불러오는 중입니다.')
  const [currentLocation, setCurrentLocation] = useState<Coordinates | null>(null)
  const [selectedDestination, setSelectedDestination] = useState<SearchResult | null>(null)
  const [transitRoutes, setTransitRoutes] = useState<TransitRoute[]>([])
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [routeFetchedAt, setRouteFetchedAt] = useState<number | null>(null)
  const [realtimeFetchedAt, setRealtimeFetchedAt] = useState<number | null>(null)
  const [currentTime, setCurrentTime] = useState(Date.now())
  const [walkingSpeedMps, setWalkingSpeedMps] = useState<number | null>(null)
  const [routeWalkPoints, setRouteWalkPoints] = useState<WalkPoint[]>([])
  const [routeWalkLabel, setRouteWalkLabel] = useState<string | null>(null)
  const [realtimeArrival, setRealtimeArrival] = useState<RealtimeArrivalState>({
    status: 'idle',
  })
  const [routeStatusText, setRouteStatusText] = useState('')
  const [transitModeFilter, setTransitModeFilter] = useState<TransitModeFilter>('all')
  const [maxTransferCount, setMaxTransferCount] = useState(5)
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')

  const savedPlaceResults = useMemo(
    () =>
      savedPlaces.map((place) => ({
        name: place.name,
        address: place.description,
        latitude: place.latitude,
        longitude: place.longitude,
        aliases: place.aliases ?? [],
      })),
    [savedPlaces],
  )

  const adjustedTransitRoutes = useMemo(() => {
    const effectiveWalkingSpeedMps = walkingSpeedMps ?? DEFAULT_WALKING_SPEED_MPS

    return transitRoutes.map((route) => {
      let totalWalkTimeDelta = 0
      const steps = route.steps.map((step) => {
        if (step.type !== 'walk' || step.distanceMeters <= 0) {
          return step
        }

        const adjustedMinutes = Math.max(
          1,
          Math.ceil(step.distanceMeters / effectiveWalkingSpeedMps / 60),
        )

        totalWalkTimeDelta += adjustedMinutes - step.minutes

        return {
          ...step,
          minutes: adjustedMinutes,
          detail: `${step.distanceMeters}m 이동`,
        }
      })

      return {
        ...route,
        totalMinutes: Math.max(1, route.totalMinutes + totalWalkTimeDelta),
        steps,
      }
    })
  }, [transitRoutes, walkingSpeedMps])

  const filteredTransitRoutes = useMemo(
    () =>
      adjustedTransitRoutes.filter((route) => {
        const hasSubway = route.steps.some((step) => step.type === 'subway')
        const hasBus = route.steps.some((step) => step.type === 'bus')
        const matchesMode =
          transitModeFilter === 'all' ||
          (transitModeFilter === 'subway' && hasSubway && !hasBus) ||
          (transitModeFilter === 'bus' && hasBus && !hasSubway)
        const matchesTransfer = route.transferCount <= maxTransferCount
        const matchesTime =
          timeFilter === 'all' ||
          (timeFilter === 'under30' && route.totalMinutes <= 30) ||
          (timeFilter === '30to60' &&
            route.totalMinutes > 30 &&
            route.totalMinutes <= 60) ||
          (timeFilter === '60to120' &&
            route.totalMinutes > 60 &&
            route.totalMinutes <= 120) ||
          (timeFilter === 'over120' && route.totalMinutes > 120)

        return matchesMode && matchesTransfer && matchesTime
      }),
    [
      maxTransferCount,
      timeFilter,
      transitModeFilter,
      adjustedTransitRoutes,
    ],
  )
  const routeWalkStats = useMemo(() => getWalkStats(routeWalkPoints), [routeWalkPoints])

  const formatTrackingDistance = (meters: number) =>
    meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(0)} m`

  useEffect(() => {
    isPickingPlaceRef.current = isPickingPlace
    onPickPlaceLocationRef.current = onPickPlaceLocation
  }, [isPickingPlace, onPickPlaceLocation])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCurrentTime(Date.now())
    }, 1_000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(
    () => () => {
      if (routeWalkWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(routeWalkWatchIdRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    const syncWalkingSpeed = () => {
      setWalkingSpeedMps(getPreferredWalkingSpeed(loadSpeedSamples()))
    }

    syncWalkingSpeed()
    window.addEventListener(SPEED_SAMPLES_UPDATED_EVENT, syncWalkingSpeed)
    window.addEventListener('storage', syncWalkingSpeed)

    return () => {
      window.removeEventListener(SPEED_SAMPLES_UPDATED_EVENT, syncWalkingSpeed)
      window.removeEventListener('storage', syncWalkingSpeed)
    }
  }, [])

  const syncLatestWalkingSpeed = () => {
    const nextWalkingSpeed = getPreferredWalkingSpeed(loadSpeedSamples())

    setWalkingSpeedMps(nextWalkingSpeed)

    return nextWalkingSpeed
  }

  const getRemainingArrivalSeconds = (seconds: number | null) => {
    const baseFetchedAt = realtimeFetchedAt ?? routeFetchedAt

    if (seconds === null || baseFetchedAt === null) {
      return null
    }

    const elapsedSeconds = Math.floor((currentTime - baseFetchedAt) / 1_000)

    return Math.max(0, seconds - elapsedSeconds)
  }

  const formatCountdown = (seconds: number | null) => {
    if (seconds === null) {
      return null
    }

    if (seconds <= 0) {
      return '곧 도착'
    }

    const minutes = Math.floor(seconds / 60)
    const remainderSeconds = seconds % 60

    if (minutes <= 0) {
      return `${remainderSeconds}초`
    }

    return `${minutes}분 ${remainderSeconds.toString().padStart(2, '0')}초`
  }

  const finalizeRouteWalkingSegment = () => {
    const sample = createSpeedSample(
      routeWalkPointsRef.current,
      'route-walking-segment',
      routeWalkLabelRef.current ?? undefined,
    )

    routeWalkPointsRef.current = []
    routeWalkLabelRef.current = null
    setRouteWalkPoints([])
    setRouteWalkLabel(null)

    if (!sample) {
      return
    }

    saveSpeedSamples([sample, ...loadSpeedSamples()])
  }

  const finishRouteWalkingSpeedTracking = () => {
    if (routeWalkWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(routeWalkWatchIdRef.current)
      routeWalkWatchIdRef.current = null
    }

    finalizeRouteWalkingSegment()
  }

  const getClosestRouteStep = (
    route: TransitRoute,
    point: Coordinates,
  ): { step: TransitRouteStep; distanceMeters: number } | null => {
    let closestRouteStep: TransitRouteStep | null = null
    let closestDistance = Number.POSITIVE_INFINITY

    route.steps.forEach((step, index) => {
      const previousPath = route.steps[index - 1]?.path ?? []
      const nextPath = route.steps[index + 1]?.path ?? []
      const candidatePath =
        step.type === 'walk' && step.path.length < 2
          ? [
              previousPath[previousPath.length - 1],
              nextPath[0],
            ].filter((coordinate): coordinate is Coordinates => Boolean(coordinate))
          : step.path

      candidatePath.forEach((coordinate) => {
        const distance = getDistanceMeters(point, coordinate)

        if (distance < closestDistance) {
          closestDistance = distance
          closestRouteStep = step
        }
      })
    })

    return closestRouteStep
      ? { step: closestRouteStep, distanceMeters: closestDistance }
      : null
  }

  const startRouteWalkingSpeedTracking = (route: TransitRoute) => {
    finishRouteWalkingSpeedTracking()

    if (!navigator.geolocation) {
      return
    }

    routeWalkWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const nextPoint = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timestamp: position.timestamp,
        }

        setCurrentLocation(nextPoint)
        const closestStep = getClosestRouteStep(route, nextPoint)
        const nearestStep = closestStep ? closestStep.step : null
        const isWalkStepNearby =
          nearestStep !== null &&
          nearestStep.type === 'walk' &&
          closestStep !== null &&
          closestStep.distanceMeters <= AUTO_WALK_START_DISTANCE_METERS
        const walkSegmentLabel =
          nearestStep !== null && nearestStep.type === 'walk'
            ? `${route.title} · ${nearestStep.detail || '도보 구간'}`
            : null

        if (!isWalkStepNearby || !walkSegmentLabel) {
          if (routeWalkLabelRef.current) {
            finalizeRouteWalkingSegment()
          }
        } else {
          if (routeWalkLabelRef.current !== walkSegmentLabel) {
            if (routeWalkLabelRef.current) {
              finalizeRouteWalkingSegment()
            }

            routeWalkPointsRef.current = []
            routeWalkLabelRef.current = walkSegmentLabel
            setRouteWalkPoints([])
            setRouteWalkLabel(walkSegmentLabel)
          }

          const lastPoint = routeWalkPointsRef.current[routeWalkPointsRef.current.length - 1]
          const movedDistance = lastPoint ? getDistanceMeters(lastPoint, nextPoint) : Infinity

          if (
            position.coords.accuracy <= AUTO_WALK_MAX_ACCURACY_METERS &&
            (routeWalkPointsRef.current.length === 0 ||
              movedDistance >= AUTO_WALK_POINT_MIN_DISTANCE_METERS)
          ) {
            routeWalkPointsRef.current = [...routeWalkPointsRef.current, nextPoint]
            setRouteWalkPoints(routeWalkPointsRef.current)
          }
        }

        const naver = window.naver

        if (naver?.maps && mapRef.current && isWithinServiceArea(nextPoint)) {
          const markerPosition = new naver.maps.LatLng(
            nextPoint.latitude,
            nextPoint.longitude,
          )

          if (!currentMarkerRef.current) {
            currentMarkerRef.current = new naver.maps.Marker({
              position: markerPosition,
              map: mapRef.current,
            })
          } else {
            currentMarkerRef.current.setPosition(markerPosition)
            currentMarkerRef.current.setMap(mapRef.current)
          }
        }

      },
      (error) => {
        console.warn(error)
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1_000,
        timeout: 10_000,
      },
    )
  }

  const moveTo = (coordinates: Coordinates, zoom = 13) => {
    const nextCenter = clampToServiceArea(coordinates)
    const naver = window.naver

    if (!naver?.maps || !mapRef.current) {
      return
    }

    const position = new naver.maps.LatLng(nextCenter.latitude, nextCenter.longitude)

    mapRef.current.setCenter(position)
    mapRef.current.setZoom(zoom)
  }

  const setSearchMarker = (result: SearchResult) => {
    const naver = window.naver

    if (!naver?.maps || !mapRef.current) {
      return
    }

    const position = new naver.maps.LatLng(result.latitude, result.longitude)

    if (!searchMarkerRef.current) {
      searchMarkerRef.current = new naver.maps.Marker({
        position,
        map: mapRef.current,
      })
      return
    }

    searchMarkerRef.current.setPosition(position)
    searchMarkerRef.current.setMap(mapRef.current)
  }

  const setPickedPlaceMarker = (coordinates: Coordinates) => {
    const naver = window.naver

    if (!naver?.maps || !mapRef.current) {
      return
    }

    const position = new naver.maps.LatLng(coordinates.latitude, coordinates.longitude)

    if (!pickedPlaceMarkerRef.current) {
      pickedPlaceMarkerRef.current = new naver.maps.Marker({
        position,
        map: mapRef.current,
      })
      return
    }

    pickedPlaceMarkerRef.current.setPosition(position)
    pickedPlaceMarkerRef.current.setMap(mapRef.current)
  }

  const getStepStrokeColor = (step: TransitRouteStep) => {
    if (step.laneColor) {
      return step.laneColor
    }

    if (step.type === 'walk') {
      return '#6b7280'
    }

    if (step.type === 'bus') {
      if (/광역|M\d|G\d|빨강|직행/i.test(step.label)) {
        return '#d6393a'
      }

      if (/마을|초록|지선/i.test(step.label)) {
        return '#2f9e44'
      }

      if (/공항|리무진/i.test(step.label)) {
        return '#8b5cf6'
      }

      return '#2563eb'
    }

    const subwayLineColors: Array<[RegExp, string]> = [
      [/1호선|Line 1/i, '#0052a4'],
      [/2호선|Line 2/i, '#00a84d'],
      [/3호선|Line 3/i, '#ef7c1c'],
      [/4호선|Line 4/i, '#00a5de'],
      [/5호선|Line 5/i, '#996cac'],
      [/6호선|Line 6/i, '#cd7c2f'],
      [/7호선|Line 7/i, '#747f00'],
      [/8호선|Line 8/i, '#e6186c'],
      [/9호선|Line 9/i, '#bdb092'],
      [/경의중앙/i, '#77c4a3'],
      [/분당|수인/i, '#f5a200'],
      [/신분당/i, '#d4003b'],
      [/공항철도/i, '#0090d2'],
      [/우이신설/i, '#b7c452'],
      [/서해/i, '#81a914'],
      [/경춘/i, '#0c8e72'],
    ]

    return subwayLineColors.find(([pattern]) => pattern.test(step.label))?.[1] ?? '#111827'
  }

  const clearRoutePolyline = () => {
    routePolylineRefs.current.forEach((polyline) => polyline.setMap(null))
    routePolylineRefs.current = []
  }

  const loadRealtimeArrival = async (route: TransitRoute) => {
    const firstBusStep = route.steps.find(
      (step) => step.type === 'bus' && step.realtimeQuery?.provider === 'seoul-bus',
    )
    const firstSubwayStep = route.steps.find(
      (step) => step.type === 'subway' && step.realtimeQuery?.provider === 'seoul-subway',
    )

    if (!firstBusStep && !firstSubwayStep) {
      setRealtimeArrival({
        status: 'unavailable',
        message: '실시간 조회에 필요한 버스 또는 지하철 정보가 없습니다.',
      })
      return
    }

    setRealtimeArrival({ status: 'loading' })
    setRealtimeFetchedAt(null)

    try {
      const arrival = firstBusStep
        ? await fetchBusArrival(firstBusStep)
        : firstSubwayStep
          ? await fetchSubwayArrival(firstSubwayStep)
          : null

      if (arrival) {
        setRealtimeFetchedAt(Date.now())
        setRealtimeArrival({ status: 'available', arrival })
      } else {
        setRealtimeArrival({
          status: 'unavailable',
          message: firstBusStep
            ? '해당 버스의 실시간 도착정보가 없습니다.'
            : '해당 지하철의 실시간 도착정보가 없습니다.',
        })
      }
    } catch (error) {
      setRealtimeFetchedAt(null)
      setRealtimeArrival({
        status: 'unavailable',
        message:
          error instanceof Error
            ? error.message
            : firstBusStep
              ? '버스 실시간 도착정보를 불러오지 못했습니다.'
              : '지하철 실시간 도착정보를 불러오지 못했습니다.',
      })
    }
  }

  const drawRoutePolyline = (route: TransitRoute) => {
    const naver = window.naver

    clearRoutePolyline()

    if (!naver?.maps || !mapRef.current) {
      return
    }

    route.steps.forEach((step, index) => {
      const previousPath = route.steps[index - 1]?.path ?? []
      const nextPath = route.steps[index + 1]?.path ?? []
      const fallbackPath =
        step.type === 'walk' && step.path.length < 2
          ? [
              previousPath[previousPath.length - 1],
              nextPath[0],
            ].filter((coordinate): coordinate is Coordinates => Boolean(coordinate))
          : step.path

      if (fallbackPath.length < 2) {
        return
      }

      const path = fallbackPath.map(
        (coordinate) => new naver.maps.LatLng(coordinate.latitude, coordinate.longitude),
      )
      const polyline = new naver.maps.Polyline({
        path,
        map: mapRef.current,
        strokeColor: getStepStrokeColor(step),
        strokeOpacity: step.type === 'walk' ? 0.72 : 0.94,
        strokeWeight: step.type === 'walk' ? 5 : 7,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
      })

      routePolylineRefs.current.push(polyline)
    })
  }

  const getCurrentCoordinates = () =>
    new Promise<Coordinates>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('이 브라우저에서는 현재 위치를 사용할 수 없습니다.'))
        return
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          })
        },
        reject,
        {
          enableHighAccuracy: true,
          maximumAge: 30_000,
          timeout: 10_000,
        },
      )
    })

  const updateCurrentLocation = (coordinates: Coordinates) => {
    const nextCenter = isWithinServiceArea(coordinates) ? coordinates : DEFAULT_CENTER
    const naver = window.naver

    setCurrentLocation(coordinates)

    if (!naver?.maps || !mapRef.current) {
      return
    }

    const markerPosition = new naver.maps.LatLng(
      nextCenter.latitude,
      nextCenter.longitude,
    )

    moveTo(nextCenter, 13)

    if (!isWithinServiceArea(coordinates)) {
      return
    }

    if (!currentMarkerRef.current) {
      currentMarkerRef.current = new naver.maps.Marker({
        position: markerPosition,
        map: mapRef.current,
      })
      return
    }

    currentMarkerRef.current.setPosition(markerPosition)
    currentMarkerRef.current.setMap(mapRef.current)
  }

  const requestCurrentLocation = () => {
    getCurrentCoordinates().then(updateCurrentLocation).catch((error) => {
      console.warn(error)
      moveTo(DEFAULT_CENTER, DEFAULT_ZOOM)
    })
  }

  const loadRoutesToDestination = async (
    destination: SearchResult,
    options: { forceCurrentLocation?: boolean; autoSelectBestRoute?: boolean } = {},
  ) => {
    if (isLoadingRoutes) {
      return
    }

    setIsLoadingRoutes(true)
    finishRouteWalkingSpeedTracking()
    syncLatestWalkingSpeed()
    setTransitRoutes([])
    setSelectedRouteId(null)
    setRealtimeArrival({ status: 'idle' })
    setRouteFetchedAt(null)
    setRealtimeFetchedAt(null)
    clearRoutePolyline()
    setRouteStatusText('현재 위치에서 대중교통 경로를 찾는 중입니다.')

    try {
      const start =
        options.forceCurrentLocation || !currentLocation
          ? await getCurrentCoordinates()
          : currentLocation

      updateCurrentLocation(start)
      const routes = await fetchTransitRoutes({ start, end: destination })

      setTransitRoutes(routes)
      setRouteFetchedAt(Date.now())

      if (options.autoSelectBestRoute && routes[0]) {
        setSelectedRouteId(routes[0].id)
        drawRoutePolyline(routes[0])
        startRouteWalkingSpeedTracking(routes[0])
        void loadRealtimeArrival(routes[0])
      }

      setRouteStatusText(
        routes.length > 0
          ? `${destination.name}까지 갈 수 있는 경로 ${routes.length}개를 찾았습니다.`
          : '대중교통 경로를 찾지 못했습니다.',
      )
    } catch (error) {
      console.warn(error)
      setRouteStatusText(
        error instanceof Error ? error.message : '대중교통 경로를 불러오지 못했습니다.',
      )
    } finally {
      setIsLoadingRoutes(false)
    }
  }

  useEffect(() => {
    const initializeMap = async () => {
      if (!mapElementRef.current) {
        return
      }

      await loadNaverMap()
      await new Promise((resolve) => requestAnimationFrame(resolve))

      const naver = window.naver

      if (!naver?.maps || !mapElementRef.current) {
        return
      }

      if (mapElementRef.current.clientWidth === 0 || mapElementRef.current.clientHeight === 0) {
        throw new Error('지도 영역의 크기를 계산하지 못했습니다.')
      }

      mapRef.current = new naver.maps.Map(mapElementRef.current, {
        center: new naver.maps.LatLng(DEFAULT_CENTER.latitude, DEFAULT_CENTER.longitude),
        zoom: DEFAULT_ZOOM,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        maxBounds: new naver.maps.LatLngBounds(
          new naver.maps.LatLng(
            SERVICE_BOUNDS.minLatitude,
            SERVICE_BOUNDS.minLongitude,
          ),
          new naver.maps.LatLng(
            SERVICE_BOUNDS.maxLatitude,
            SERVICE_BOUNDS.maxLongitude,
          ),
        ),
      })

      naver.maps.Event.addListener(mapRef.current, 'click', (event) => {
        if (!isPickingPlaceRef.current) {
          return
        }

        const pickedLocation = {
          latitude:
            typeof event.coord.lat === 'function'
              ? event.coord.lat()
              : event.coord.latitude,
          longitude:
            typeof event.coord.lng === 'function'
              ? event.coord.lng()
              : event.coord.longitude,
        }

        if (!isWithinServiceArea(pickedLocation)) {
          setAlertMessage('현재 지원하지 않는 장소입니다')
          return
        }

        setPickedPlaceMarker(pickedLocation)
        onPickPlaceLocationRef.current(pickedLocation)
        moveTo(pickedLocation, 14)
      })

      setIsMapReady(true)
      setMapStatusText('')
      getCurrentCoordinates()
        .then((coordinates) => {
          const nextCenter = isWithinServiceArea(coordinates) ? coordinates : DEFAULT_CENTER

          setCurrentLocation(coordinates)

          if (!window.naver?.maps || !mapRef.current) {
            return
          }

          const markerPosition = new window.naver.maps.LatLng(
            nextCenter.latitude,
            nextCenter.longitude,
          )

          mapRef.current.setCenter(markerPosition)
          mapRef.current.setZoom(13)

          if (!isWithinServiceArea(coordinates)) {
            return
          }

          if (!currentMarkerRef.current) {
            currentMarkerRef.current = new window.naver.maps.Marker({
              position: markerPosition,
              map: mapRef.current,
            })
            return
          }

          currentMarkerRef.current.setPosition(markerPosition)
          currentMarkerRef.current.setMap(mapRef.current)
        })
        .catch((error) => {
          console.warn(error)
          moveTo(DEFAULT_CENTER, DEFAULT_ZOOM)
        })
    }

    initializeMap().catch((error) => {
      console.warn(error)
      setMapStatusText('네이버 지도를 불러오지 못했습니다.')
      setAlertMessage('네이버 지도를 불러오지 못했습니다.')
    })
  }, [])

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedQuery = query.trim()

    if (!trimmedQuery || isSearching) {
      return
    }

    setSelectedDestination(null)
    setTransitRoutes([])
    setSelectedRouteId(null)
    setRealtimeArrival({ status: 'idle' })
    setRouteFetchedAt(null)
    setRealtimeFetchedAt(null)
    finishRouteWalkingSpeedTracking()
    clearRoutePolyline()
    setRouteStatusText('')

    const coordinateResult = parseCoordinateSearch(trimmedQuery)
    const normalizedQuery = trimmedQuery.toLowerCase()
    const localResults = savedPlaceResults.filter((place) =>
      [place.name, place.address, ...place.aliases].some((keyword) =>
        keyword.toLowerCase().replace(/\s/g, '').includes(
          normalizedQuery.replace(/\s/g, ''),
        ),
      ),
    )

    if (coordinateResult) {
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

    if (localResults.length > 0) {
      setSearchSuggestions(localResults)
      setAlertMessage('')
      return
    }

    if (!window.naver?.maps.Service) {
      setAlertMessage('장소 검색을 아직 사용할 수 없습니다.')
      return
    }

    setIsSearching(true)

    window.naver.maps.Service.geocode({ query: trimmedQuery }, (status, response) => {
      setIsSearching(false)

      if (status !== 'OK') {
        setSearchSuggestions([])
        setAlertMessage('현재 지원하지 않는 장소입니다')
        return
      }

      const results =
        response.v2?.addresses
          .map((address) => ({
            latitude: Number(address.y),
            longitude: Number(address.x),
            name:
              address.roadAddress ||
              address.jibunAddress ||
              address.englishAddress ||
              trimmedQuery,
            address:
              address.jibunAddress ||
              address.roadAddress ||
              address.englishAddress ||
              trimmedQuery,
          }))
          .filter((result) => isWithinServiceArea(result)) ?? []

      if (results.length === 0) {
        setSearchSuggestions([])
        setAlertMessage('현재 지원하지 않는 장소입니다')
        return
      }

      setSearchSuggestions(results)
      setAlertMessage('')
    })
  }

  const selectSearchResult = (result: SearchResult) => {
    setQuery(result.name)
    setSearchSuggestions([])
    setAlertMessage('')
    setSelectedDestination(result)
    setSearchMarker(result)
    moveTo(result, 14)
    void loadRoutesToDestination(result)
  }

  const refreshRoutesFromCurrentLocation = () => {
    if (!selectedDestination) {
      return
    }

    void loadRoutesToDestination(selectedDestination, {
      forceCurrentLocation: true,
      autoSelectBestRoute: true,
    })
  }

  const selectTransitRoute = (route: TransitRoute) => {
    finishRouteWalkingSpeedTracking()
    setSelectedRouteId(route.id)
    drawRoutePolyline(route)
    startRouteWalkingSpeedTracking(route)
    void loadRealtimeArrival(route)

    if (route.path.length > 0) {
      moveTo(route.path[Math.floor(route.path.length / 2)], 13)
    }
  }

  return (
    <section className="mapShell" aria-label="네이버 지도">
      <form className="searchBar" onSubmit={handleSearch}>
        <div className="searchInputRow">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="서울·경기 장소 검색"
            aria-label="서울과 경기도 장소 검색"
          />
          <button type="submit" aria-label="검색" disabled={isSearching || !isMapReady}>
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

      <div ref={mapElementRef} className="naverMapCanvas" />

      {mapStatusText && <div className="mapLoading">{mapStatusText}</div>}

      <button className="locateButton" type="button" onClick={requestCurrentLocation}>
        <svg
          className="buttonIcon"
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2" />
          <path d="M12 3v2" />
          <path d="M12 19v2" />
          <path d="M3 12h2" />
          <path d="M19 12h2" />
        </svg>
        <span className="visuallyHidden">현재 위치</span>
      </button>

      {selectedDestination && (
        <aside className="routePanel" aria-live="polite">
          <div className="routePanelHeader">
            <div>
              <span>이동 경로</span>
              <strong>{selectedDestination.name}</strong>
            </div>
            <div className="routePanelControls">
              {isLoadingRoutes && <small>검색 중</small>}
              <button
                type="button"
                onClick={refreshRoutesFromCurrentLocation}
                disabled={isLoadingRoutes}
                aria-label="현재 위치 기준 경로 새로고침"
              >
                <svg
                  className="buttonIcon"
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                >
                  <path d="M21 12a9 9 0 0 1-15.3 6.4" />
                  <path d="M3 12A9 9 0 0 1 18.3 5.6" />
                  <path d="M18 2v4h-4" />
                  <path d="M6 22v-4h4" />
                </svg>
              </button>
            </div>
          </div>

          {routeStatusText && <p>{routeStatusText}</p>}
          <p className="walkingSpeedNotice">
            {walkingSpeedMps
              ? `내 도보 속력 ${walkingSpeedMps.toFixed(2)} m/s 기준으로 계산 중`
              : `기본 도보 속력 ${DEFAULT_WALKING_SPEED_MPS.toFixed(2)} m/s 기준으로 계산 중`}
          </p>

          {transitRoutes.length > 0 && (
            <div className="routeFilters" aria-label="대중교통 경로 필터">
              <div className="segmentedControl">
                <button
                  type="button"
                  className={transitModeFilter === 'all' ? 'active' : ''}
                  onClick={() => setTransitModeFilter('all')}
                >
                  둘 다
                </button>
                <button
                  type="button"
                  className={transitModeFilter === 'subway' ? 'active' : ''}
                  onClick={() => setTransitModeFilter('subway')}
                >
                  지하철만
                </button>
                <button
                  type="button"
                  className={transitModeFilter === 'bus' ? 'active' : ''}
                  onClick={() => setTransitModeFilter('bus')}
                >
                  버스만
                </button>
              </div>

              <div className="routeFilterRow">
                <label>
                  <span>환승 횟수</span>
                  <strong>{maxTransferCount}회 이하</strong>
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="1"
                    value={maxTransferCount}
                    onChange={(event) => setMaxTransferCount(Number(event.target.value))}
                    aria-label="최대 환승 횟수"
                  />
                </label>
              </div>

              <select
                className="timeFilterSelect"
                value={timeFilter}
                aria-label="소요 시간 범위"
                onChange={(event) => setTimeFilter(event.target.value as TimeFilter)}
              >
                <option value="all">전체 소요 시간</option>
                <option value="under30">30분 이내</option>
                <option value="30to60">30분~1시간</option>
                <option value="60to120">1시간~2시간</option>
                <option value="over120">2시간 이상</option>
              </select>
            </div>
          )}

          {adjustedTransitRoutes.length > 0 && (
            <div className="routeList">
              {filteredTransitRoutes.map((route) => (
                <article
                  className={selectedRouteId === route.id ? 'selected' : ''}
                  key={route.id}
                >
                  <button
                    className="routePreviewButton"
                    type="button"
                    onClick={() => selectTransitRoute(route)}
                    aria-expanded={selectedRouteId === route.id}
                  >
                    <strong>{route.totalMinutes}분</strong>
                    <span>
                      {route.title} · 환승 {route.transferCount}회 · 도보{' '}
                      {route.totalWalkMeters}m · {route.fare.toLocaleString()}원
                    </span>
                  </button>

                  {selectedRouteId === route.id && (
                    <div className="routeDetail">
                      {(() => {
                        const firstArrivalCountdown =
                          realtimeArrival.status === 'available'
                            ? formatCountdown(
                                getRemainingArrivalSeconds(
                                  realtimeArrival.arrival.firstArrivalSeconds,
                                ),
                              )
                            : null
                        const secondArrivalCountdown =
                          realtimeArrival.status === 'available'
                            ? formatCountdown(
                                getRemainingArrivalSeconds(
                                  realtimeArrival.arrival.secondArrivalSeconds,
                                ),
                              )
                            : null

                        return (
                          <>
                      <div className="arrivalStatus">
                        <span>{route.firstRideLabel} 도착까지</span>
                        <strong>
                          {route.firstRideLabel === '도보'
                            ? `${route.totalMinutes}분`
                            : realtimeArrival.status === 'loading'
                            ? '조회 중'
                            : realtimeArrival.status === 'available'
                              ? firstArrivalCountdown ?? realtimeArrival.arrival.firstMessage
                              : route.nextArrivalMinutes === null
                            ? '실시간 정보 없음'
                            : formatCountdown(
                                Math.max(
                                  0,
                                  route.nextArrivalMinutes * 60 -
                                    Math.floor(
                                      (currentTime - (routeFetchedAt ?? currentTime)) / 1_000,
                                    ),
                                ),
                              ) ?? '실시간 정보 없음'}
                        </strong>
                      </div>
                      {route.firstRideLabel !== '도보' && realtimeArrival.status === 'available' && (
                        <div className="realtimeArrivalDetail">
                          <span>{realtimeArrival.arrival.routeName}</span>
                          <strong>
                            {secondArrivalCountdown ??
                              (realtimeArrival.arrival.secondMessage || '다음 차 정보 없음')}
                          </strong>
                        </div>
                      )}
                      {route.firstRideLabel !== '도보' && realtimeArrival.status === 'unavailable' && (
                        <small className="refreshHint">{realtimeArrival.message}</small>
                      )}
                      {routeWalkLabel && selectedRouteId === route.id && (
                        <div className="walkTrackingStatus">
                          <span>GPS 측정 도보 속력</span>
                          <strong>
                            {routeWalkStats.speedMps > 0
                              ? `${routeWalkStats.speedMps.toFixed(2)} m/s`
                              : '측정 중'}
                          </strong>
                          <small>
                            {formatTrackingDistance(routeWalkStats.distanceMeters)} · 분석 저장용
                          </small>
                        </div>
                      )}
                      <small className="refreshHint">
                        도착 정보는 선택한 경로에서 약{' '}
                        {ARRIVAL_REFRESH_INTERVAL_SECONDS}초 간격 갱신 권장
                      </small>
                      <ol>
                        {route.steps.map((step, index) => (
                          <li key={`${route.id}-${index}`}>
                            <b>
                              <span
                                className="routeStepColor"
                                style={{ backgroundColor: getStepStrokeColor(step) }}
                                aria-hidden="true"
                              />
                              {step.label}
                            </b>
                            <span>
                              {step.detail}
                              {step.minutes > 0 ? ` · ${step.minutes}분` : ''}
                            </span>
                          </li>
                        ))}
                      </ol>
                          </>
                        )
                      })()}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}

          {adjustedTransitRoutes.length > 0 && filteredTransitRoutes.length === 0 && (
            <p>조건에 맞는 경로가 없습니다.</p>
          )}
        </aside>
      )}

      {alertMessage && (
        <div className="mapAlert" role="alert">
          <span>{alertMessage}</span>
          <button type="button" onClick={() => setAlertMessage('')} aria-label="닫기">
            ×
          </button>
        </div>
      )}
    </section>
  )
}
