const ODSAY_REFERER = 'http://localhost:5173/'

type RequestLike = {
  url?: string
}

type ResponseLike = {
  status: (code: number) => ResponseLike
  json: (body: unknown) => void
  setHeader?: (name: string, value: string) => void
}

type SeoulBusArrivalQuery = {
  routeName: string
  routeNames?: string[]
  arsId?: string
  stationId?: string
  routeId?: string
  routeIds?: string[]
  stId?: string
  busRouteId?: string
  busRouteIds?: string[]
  ord?: string
}

function normalizeBusName(value: string) {
  return value.replace(/\s/g, '').toLowerCase()
}

function normalizeComparableBusName(value: string) {
  return normalizeBusName(value).replace(/^0+(?=\d)/, '')
}

function isSameBusName(left: string, right: string) {
  const normalizedLeft = normalizeBusName(left)
  const normalizedRight = normalizeBusName(right)
  const comparableLeft = normalizeComparableBusName(left)
  const comparableRight = normalizeComparableBusName(right)

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft) ||
    comparableLeft === comparableRight ||
    comparableLeft.includes(comparableRight) ||
    comparableRight.includes(comparableLeft)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getString(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return ''
}

function getNumberOrNull(value: unknown) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function formatOdsayArrivalMessage(arrival: Record<string, unknown>) {
  const arrivalSeconds = getNumberOrNull(arrival.arrivalSec)
  const leftStation = getNumberOrNull(arrival.leftStation)
  const waitStatus = getString(arrival.waitStatus)

  if (arrivalSeconds !== null && arrivalSeconds > 0) {
    const minutes = Math.floor(arrivalSeconds / 60)
    const seconds = arrivalSeconds % 60
    const stationText = leftStation !== null ? `[${leftStation}번째 전]` : ''

    return `${minutes}분 ${seconds}초후${stationText}`
  }

  if (waitStatus === '0') {
    return '도착 정보 없음'
  }

  return '출발대기'
}

function findOdsayRealtimeItem(items: unknown[], query: SeoulBusArrivalQuery) {
  const routeIds = [query.routeId, ...(query.routeIds ?? [])].filter(Boolean)
  const localRouteIds = [query.busRouteId, ...(query.busRouteIds ?? [])].filter(Boolean)
  const routeNames = [query.routeName, ...(query.routeNames ?? [])].filter(Boolean)
  const routeIdMatches = items.find((item): item is Record<string, unknown> => {
    if (!isRecord(item)) {
      return false
    }

    const routeId = getString(item.routeId)
    const localRouteId = getString(item.localRouteId)

    return routeIds.includes(routeId) || localRouteIds.includes(localRouteId)
  })

  if (routeIdMatches) {
    return routeIdMatches
  }

  return (
    items.find((item): item is Record<string, unknown> => {
      if (!isRecord(item)) {
        return false
      }

      return routeNames.some((routeName) => isSameBusName(getString(item.routeNm), routeName))
    }) ?? null
  )
}

function findOdsayBaseLane(lanes: unknown[], query: SeoulBusArrivalQuery) {
  const routeIds = [query.routeId, ...(query.routeIds ?? [])].filter(Boolean)
  const localRouteIds = [query.busRouteId, ...(query.busRouteIds ?? [])].filter(Boolean)
  const routeNames = [query.routeName, ...(query.routeNames ?? [])].filter(Boolean)

  return (
    lanes.find((lane): lane is Record<string, unknown> => {
      if (!isRecord(lane)) {
        return false
      }

      const busId = getString(lane.busID)
      const localBusId = getString(lane.busLocalBlID)
      const busNo = getString(lane.busNo)

      return (
        routeIds.includes(busId) ||
        localRouteIds.includes(localBusId) ||
        routeNames.some((routeName) => isSameBusName(busNo, routeName))
      )
    }) ?? null
  )
}

async function fetchOdsayBusArrival(apiKey: string, query: SeoulBusArrivalQuery) {
  if (!query.stationId) {
    return null
  }

  let unsupportedMessage = ''
  let matchedRouteNameWithoutArrival = ''
  let matchedBaseLane: Record<string, unknown> | null = null
  const routeIds = [query.routeId, ...(query.routeIds ?? [])].filter(Boolean)
  const requests = [
    { stationBase: '1', routeIds: routeIds.join(',') },
    { stationBase: '1', routeIds: '' },
    { stationBase: '0', routeIds: routeIds.join(',') },
    { stationBase: '0', routeIds: '' },
  ].filter(
    (request, index, allRequests) =>
      allRequests.findIndex(
        (candidate) =>
          candidate.stationBase === request.stationBase &&
          candidate.routeIds === request.routeIds,
      ) === index,
  )

  for (const request of requests) {
    const odsayUrl = new URL('https://api.odsay.com/v1/api/realtimeStation')
    odsayUrl.searchParams.set('apiKey', apiKey)
    odsayUrl.searchParams.set('stationID', query.stationId)
    odsayUrl.searchParams.set('stationBase', request.stationBase)
    odsayUrl.searchParams.set('output', 'json')
    if (request.routeIds) {
      odsayUrl.searchParams.set('routeIDs', request.routeIds)
    }

    const odsayResponse = await fetch(odsayUrl, {
      headers: {
        Referer: ODSAY_REFERER,
      },
    })

    if (!odsayResponse.ok) {
      continue
    }

    const responseData = (await odsayResponse.json()) as unknown
    if (!isRecord(responseData) || !isRecord(responseData.result)) {
      continue
    }

    const error = isRecord(responseData.error) ? responseData.error : null
    if (error) {
      const errorMessage = getString(error.msg) || getString(error.message)
      if (errorMessage) {
        unsupportedMessage = errorMessage
      }
      continue
    }

    const result = responseData.result
    const baseLanes = isRecord(result.base) && Array.isArray(result.base.lane) ? result.base.lane : []
    const realtimeItems = Array.isArray(result.real) ? result.real : []

    const baseLane = findOdsayBaseLane(baseLanes, query)
    if (baseLane) {
      matchedBaseLane = baseLane
      const busCityCode = getString(baseLane.busCityCode)
      if (busCityCode && busCityCode !== '1000') {
        unsupportedMessage = `${query.routeName} 버스는 현재 ODsay 실시간 제공 범위 밖이거나 준비 중입니다.`
      }
    }

    const matchedRealtime = findOdsayRealtimeItem(realtimeItems, query)
    if (matchedRealtime) {
      const routeName = getString(matchedRealtime.routeNm) || query.routeName
      const firstArrival = isRecord(matchedRealtime.arrival1) ? matchedRealtime.arrival1 : null
      const secondArrival = isRecord(matchedRealtime.arrival2) ? matchedRealtime.arrival2 : null

      if (!firstArrival && !secondArrival) {
        matchedRouteNameWithoutArrival = routeName
        continue
      }

      return {
        arrival: {
          routeName,
          firstMessage: firstArrival ? formatOdsayArrivalMessage(firstArrival) : '도착 정보 없음',
          secondMessage: secondArrival ? formatOdsayArrivalMessage(secondArrival) : '',
          firstArrivalSeconds: firstArrival ? getNumberOrNull(firstArrival.arrivalSec) : null,
          secondArrivalSeconds: secondArrival ? getNumberOrNull(secondArrival.arrivalSec) : null,
          congestion: firstArrival ? String(getNumberOrNull(firstArrival.congestion) ?? '') : '',
        },
      }
    }

    if (baseLane) {
      matchedRouteNameWithoutArrival = getString(baseLane.busNo) || query.routeName
    }
  }

  if (matchedRouteNameWithoutArrival) {
    return {
      message: `${matchedRouteNameWithoutArrival} 버스의 실시간 도착정보가 없습니다.`,
    }
  }

  if (unsupportedMessage) {
    return {
      message: unsupportedMessage,
    }
  }

  if (matchedBaseLane) {
    return {
      message: `${query.routeName} 버스의 실시간 도착정보가 없습니다.`,
    }
  }

  return null
}

export default async function handler(request: RequestLike, response: ResponseLike) {
  response.setHeader?.('Content-Type', 'application/json; charset=utf-8')

  const apiKey = process.env.ODSAY_API_KEY

  if (!apiKey) {
    response.status(500).json({ message: 'ODsay API key is not configured.' })
    return
  }

  const searchParams = new URL(
    request.url ?? '/api/seoul-bus-arrivals',
    'http://localhost',
  ).searchParams
  const arsId = searchParams.get('arsId')?.trim()
  const routeName = searchParams.get('routeName')?.trim()
  const routeNames = searchParams
    .get('routeNames')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const routeIds = searchParams
    .get('routeIds')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const stationId = searchParams.get('stationId')?.trim()
  const routeId = searchParams.get('routeId')?.trim()
  const stId = searchParams.get('stId')?.trim()
  const busRouteId = searchParams.get('busRouteId')?.trim()
  const busRouteIds = searchParams
    .get('busRouteIds')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const ord = searchParams.get('ord')?.trim()

  if (!routeName || (!stationId && !arsId && !busRouteId)) {
    response
      .status(400)
      .json({ message: 'Valid routeName and bus arrival query are required.' })
    return
  }

  const query = {
    routeName,
    routeNames,
    arsId,
    stationId,
    routeId,
    routeIds,
    stId,
    busRouteId,
    busRouteIds,
    ord,
  }

  try {
    const odsayResult = await fetchOdsayBusArrival(apiKey, query)

    if (odsayResult?.arrival) {
      response.status(200).json({ arrival: odsayResult.arrival })
      return
    }

    if (odsayResult?.message) {
      response.status(404).json({ message: odsayResult.message })
      return
    }

    response.status(404).json({ message: `${routeName} 버스 도착정보를 찾지 못했습니다.` })
  } catch {
    response.status(502).json({ message: 'Failed to fetch ODsay bus arrivals.' })
  }
}
