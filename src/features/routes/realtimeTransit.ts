import type { TransitRouteStep } from './transitRoutes'

export type TransitArrival = {
  routeName: string
  firstMessage: string
  secondMessage: string
  firstArrivalSeconds: number | null
  secondArrivalSeconds: number | null
  congestion: string
}

export type RealtimeArrivalState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'available'; arrival: TransitArrival }
  | { status: 'unavailable'; message: string }

function getNumber(value: unknown) {
  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

export async function fetchBusArrival(step: TransitRouteStep) {
  if (step.realtimeQuery?.provider !== 'seoul-bus') {
    return null
  }

  const searchParams = new URLSearchParams({
    arsId: step.realtimeQuery.arsId,
    routeName: step.realtimeQuery.routeName,
    routeNames: step.realtimeQuery.routeNames.join(','),
    stationId: step.realtimeQuery.stationId,
    routeId: step.realtimeQuery.routeId,
    routeIds: step.realtimeQuery.routeIds.join(','),
    stId: step.realtimeQuery.stId,
    busRouteId: step.realtimeQuery.busRouteId,
    busRouteIds: step.realtimeQuery.busRouteIds.join(','),
    ord: step.realtimeQuery.ord,
  })
  const response = await fetch(`/api/seoul-bus-arrivals?${searchParams.toString()}`)

  if (!response.ok) {
    throw new Error('버스 실시간 도착정보를 불러오지 못했습니다.')
  }

  const data = (await response.json()) as {
    arrival?: TransitArrival
    message?: string
  }

  if (!data.arrival) {
    throw new Error(data.message ?? '해당 노선의 실시간 도착정보가 없습니다.')
  }

  return {
    ...data.arrival,
    firstArrivalSeconds: getNumber(data.arrival.firstArrivalSeconds),
    secondArrivalSeconds: getNumber(data.arrival.secondArrivalSeconds),
  }
}

export async function fetchSubwayArrival(step: TransitRouteStep) {
  if (step.realtimeQuery?.provider !== 'seoul-subway') {
    return null
  }

  const searchParams = new URLSearchParams({
    stationName: step.realtimeQuery.stationName,
    lineName: step.realtimeQuery.lineName,
    directionHint: step.realtimeQuery.directionHint,
  })
  const response = await fetch(`/api/seoul-subway-arrivals?${searchParams.toString()}`)

  if (!response.ok) {
    throw new Error('지하철 실시간 도착정보를 불러오지 못했습니다.')
  }

  const data = (await response.json()) as {
    arrival?: TransitArrival
    message?: string
  }

  if (!data.arrival) {
    throw new Error(data.message ?? '해당 역의 실시간 도착정보가 없습니다.')
  }

  return {
    ...data.arrival,
    firstArrivalSeconds: getNumber(data.arrival.firstArrivalSeconds),
    secondArrivalSeconds: getNumber(data.arrival.secondArrivalSeconds),
  }
}
