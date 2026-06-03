import type { Coordinates } from '../../types/map'

export type TransitRouteRequest = {
  start: Coordinates
  end: Coordinates
}

export type TransitRouteStep = {
  type: 'walk' | 'bus' | 'subway' | 'transfer'
  label: string
  detail: string
  minutes: number
  distanceMeters: number
  laneColor: string | null
  realtimeQuery:
    | {
        provider: 'seoul-bus'
        arsId: string
        routeName: string
        routeNames: string[]
        stationId: string
        routeId: string
        routeIds: string[]
        stId: string
        busRouteId: string
        busRouteIds: string[]
        ord: string
      }
    | {
        provider: 'seoul-subway'
        stationName: string
        lineName: string
        directionHint: string
      }
    | null
  path: Coordinates[]
}

export type TransitRoute = {
  id: string
  title: string
  totalMinutes: number
  fare: number
  totalWalkMeters: number
  transferCount: number
  firstRideLabel: string
  nextArrivalMinutes: number | null
  path: Coordinates[]
  steps: TransitRouteStep[]
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function getNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function getString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function getCoordinate(longitude: unknown, latitude: unknown): Coordinates | null {
  const parsedLongitude = Number(longitude)
  const parsedLatitude = Number(latitude)

  if (!Number.isFinite(parsedLongitude) || !Number.isFinite(parsedLatitude)) {
    return null
  }

  return {
    latitude: parsedLatitude,
    longitude: parsedLongitude,
  }
}

function getLaneName(lane: unknown) {
  if (!isRecord(lane)) {
    return ''
  }

  return getString(lane.name) || getString(lane.busNo)
}

function getLaneColor(lane: unknown) {
  if (!isRecord(lane)) {
    return null
  }

  const candidates = [
    lane.color,
    lane.laneColor,
    lane.routeColor,
    lane.subwayColor,
    lane.busColor,
  ]

  const color = candidates.find(
    (value): value is string =>
      typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value),
  )

  if (!color) {
    return null
  }

  return color.startsWith('#') ? color : `#${color}`
}

function getPrimaryLaneColor(step: UnknownRecord) {
  if (!Array.isArray(step.lane)) {
    return null
  }

  return step.lane.map(getLaneColor).find((color): color is string => Boolean(color)) ?? null
}

function getRealtimeParam(value: unknown) {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return ''
}

function getFirstRealtimeParam(values: unknown[]) {
  return values.map(getRealtimeParam).find((value) => value.length > 0) ?? ''
}

function getFirstBusLane(step: UnknownRecord) {
  if (!Array.isArray(step.lane)) {
    return null
  }

  return step.lane.find(isRecord) ?? null
}

function getBusLaneQueries(step: UnknownRecord) {
  if (!Array.isArray(step.lane)) {
    return []
  }

  return step.lane
    .filter(isRecord)
    .map((lane) => ({
      routeName: getLaneName(lane).trim(),
      routeId: getFirstRealtimeParam([
        lane.busID,
        lane.busId,
        lane.routeId,
        lane.routeID,
      ]),
      busRouteId: getFirstRealtimeParam([
        lane.busLocalBlID,
        lane.busLocalBlId,
        lane.busRouteId,
        lane.busRouteID,
      ]),
    }))
    .filter((lane) => lane.routeName || lane.routeId || lane.busRouteId)
}

function getBusRealtimeQuery(step: UnknownRecord) {
  const lane = getFirstBusLane(step)
  const laneQueries = getBusLaneQueries(step)
  const firstPassStop = isRecord(step.passStopList)
    ? Array.isArray(step.passStopList.stations) && isRecord(step.passStopList.stations[0])
      ? step.passStopList.stations[0]
      : null
    : null
  const arsId = getFirstRealtimeParam([
    step.startArsID,
    step.startArsId,
    step.startARSID,
    step.arsID,
    step.arsId,
    firstPassStop?.arsID,
    firstPassStop?.arsId,
  ])
  const stId = getFirstRealtimeParam([
    step.startID,
    step.startId,
    step.startStationID,
    step.startStationId,
    step.startLocalStationID,
    step.startLocalStationId,
    step.stId,
    firstPassStop?.stationID,
    firstPassStop?.stationId,
    firstPassStop?.localStationID,
    firstPassStop?.localStationId,
  ])
  const busRouteId = getFirstRealtimeParam([
    step.busLocalBlID,
    step.busLocalBlId,
    step.busRouteId,
    step.busRouteID,
    lane?.busLocalBlID,
    lane?.busLocalBlId,
    lane?.busRouteId,
    lane?.busRouteID,
  ])
  const ord = getFirstRealtimeParam([
    step.startOrd,
    step.startOrder,
    step.startStationOrd,
    step.startStationOrder,
    step.ord,
    step.stationOrd,
    firstPassStop?.index,
    firstPassStop?.ord,
    firstPassStop?.stationOrd,
  ])
  const routeName = formatTrafficLabel(step).split(',')[0]?.trim() ?? ''
  const stationId = getFirstRealtimeParam([step.startID, step.startId])
  const routeId = getFirstRealtimeParam([lane?.busID, lane?.busId])

  if (!routeName || (!stationId && !arsId && !busRouteId)) {
    return null
  }

  return {
    provider: 'seoul-bus' as const,
    arsId,
    routeName,
    routeNames: laneQueries.map((candidate) => candidate.routeName).filter(Boolean),
    stationId,
    routeId,
    routeIds: laneQueries.map((candidate) => candidate.routeId).filter(Boolean),
    stId,
    busRouteId,
    busRouteIds: laneQueries.map((candidate) => candidate.busRouteId).filter(Boolean),
    ord,
  }
}

function getSubwayRealtimeQuery(step: UnknownRecord) {
  const stationName = getFirstRealtimeParam([step.startName, step.statnNm])
  const lineName = formatTrafficLabel(step).split(',')[0]?.trim() ?? ''
  const directionHint = getFirstRealtimeParam([
    step.way,
    step.wayCode,
    step.endName,
    step.startExitNo,
  ])

  if (!stationName || !lineName) {
    return null
  }

  return {
    provider: 'seoul-subway' as const,
    stationName,
    lineName,
    directionHint,
  }
}

function formatTrafficLabel(step: UnknownRecord) {
  const trafficType = getNumber(step.trafficType)
  const laneNames = Array.isArray(step.lane)
    ? step.lane.map(getLaneName).filter(Boolean)
    : []

  if (trafficType === 1) {
    return laneNames.length > 0 ? laneNames.join(', ') : '지하철'
  }

  if (trafficType === 2) {
    return laneNames.length > 0 ? laneNames.join(', ') : '버스'
  }

  return '도보'
}

function getStepPath(step: UnknownRecord) {
  const path: Coordinates[] = []
  const start = getCoordinate(step.startX, step.startY)
  const passStopList = isRecord(step.passStopList) ? step.passStopList : null
  const stations = Array.isArray(passStopList?.stations) ? passStopList.stations : []
  const end = getCoordinate(step.endX, step.endY)

  if (start) {
    path.push(start)
  }

  stations.forEach((station) => {
    if (!isRecord(station)) {
      return
    }

    const coordinate = getCoordinate(station.x, station.y)

    if (coordinate) {
      path.push(coordinate)
    }
  })

  if (end) {
    path.push(end)
  }

  return path
}

function getNextArrivalMinutes(step: TransitRouteStep, rawStep: UnknownRecord) {
  const candidates = [
    rawStep.waitTime,
    rawStep.arrivalTime,
    rawStep.realtimeArrivalTime,
    rawStep.nextArrivalTime,
  ]
    .map((value) => getNumber(value, Number.NaN))
    .filter(Number.isFinite)

  if (candidates.length > 0) {
    return Math.max(0, Math.min(...candidates))
  }

  if (step.type === 'bus' || step.type === 'subway') {
    return null
  }

  return null
}

function normalizeStep(step: unknown): TransitRouteStep | null {
  if (!isRecord(step)) {
    return null
  }

  const trafficType = getNumber(step.trafficType)
  const minutes = getNumber(step.sectionTime)
  const startName = getString(step.startName)
  const endName = getString(step.endName)
  const distance = getNumber(step.distance)

  if (trafficType === 1 || trafficType === 2) {
    return {
      type: trafficType === 1 ? 'subway' : 'bus',
      label: formatTrafficLabel(step),
      detail: [startName, endName].filter(Boolean).join(' → '),
      minutes,
      distanceMeters: distance,
      laneColor: getPrimaryLaneColor(step),
      realtimeQuery: trafficType === 2 ? getBusRealtimeQuery(step) : getSubwayRealtimeQuery(step),
      path: getStepPath(step),
    }
  }

  if (trafficType === 3) {
    return {
      type: 'walk',
      label: '도보',
      detail: distance > 0 ? `${distance}m 이동` : '도보 이동',
      minutes,
      distanceMeters: distance,
      laneColor: null,
      realtimeQuery: null,
      path: getStepPath(step),
    }
  }

  return null
}

function normalizeRoute(route: unknown, index: number): TransitRoute | null {
  if (!isRecord(route) || !isRecord(route.info)) {
    return null
  }

  const steps = Array.isArray(route.subPath)
    ? route.subPath.map(normalizeStep).filter((step): step is TransitRouteStep => step !== null)
    : []
  const totalMinutes = getNumber(route.info.totalTime)
  const busCount = getNumber(route.info.busTransitCount)
  const subwayCount = getNumber(route.info.subwayTransitCount)
  const transferCount = Math.max(0, busCount + subwayCount - 1)
  const firstVehicle = steps.find((step) => step.type !== 'walk')
  const rawFirstVehicle = Array.isArray(route.subPath)
    ? route.subPath.find(
        (step) =>
          isRecord(step) &&
          (getNumber(step.trafficType) === 1 || getNumber(step.trafficType) === 2),
      )
    : null
  const path = steps.flatMap((step) => step.path)

  return {
    id: `route-${index}`,
    title: firstVehicle ? `${firstVehicle.label} 이용` : `경로 ${index + 1}`,
    totalMinutes,
    fare: getNumber(route.info.payment),
    totalWalkMeters: getNumber(route.info.totalWalk),
    transferCount,
    firstRideLabel: firstVehicle?.label ?? '대중교통',
    nextArrivalMinutes:
      firstVehicle && isRecord(rawFirstVehicle)
        ? getNextArrivalMinutes(firstVehicle, rawFirstVehicle)
        : null,
    path,
    steps,
  }
}

function normalizeRoutes(data: unknown) {
  if (!isRecord(data)) {
    throw new Error('대중교통 경로 응답 형식이 올바르지 않습니다.')
  }

  if (Array.isArray(data.error)) {
    const firstError = data.error.find(isRecord)
    const message = getString(firstError?.message, '대중교통 경로를 불러오지 못했습니다.')

    throw new Error(message)
  }

  if (!isRecord(data.result) || !Array.isArray(data.result.path)) {
    return []
  }

  return data.result.path
    .map(normalizeRoute)
    .filter((route): route is TransitRoute => route !== null)
}

export async function fetchTransitRoutes({ start, end }: TransitRouteRequest) {
  const searchParams = new URLSearchParams({
    startLatitude: String(start.latitude),
    startLongitude: String(start.longitude),
    endLatitude: String(end.latitude),
    endLongitude: String(end.longitude),
  })

  const response = await fetch(`/api/transit-routes?${searchParams.toString()}`)

  if (!response.ok) {
    throw new Error('대중교통 경로를 불러오지 못했습니다.')
  }

  return normalizeRoutes(await response.json())
}
