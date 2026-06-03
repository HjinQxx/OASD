import http from 'node:http'

const ODSAY_REFERER = 'http://localhost:5173/'

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

type SeoulSubwayArrivalQuery = {
  stationName: string
  lineName: string
  directionHint?: string
}

type JsonResponse = {
  status: number
  body: unknown
}

function fetchJsonOverHttp(url: string) {
  return new Promise<unknown>((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks: Buffer[] = []

      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })

      response.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8')
          resolve(JSON.parse(body) as unknown)
        } catch (error) {
          reject(error)
        }
      })
    })

    request.on('error', reject)
    request.setTimeout(10_000, () => {
      request.destroy(new Error('Subway API request timed out.'))
    })
  })
}

function parseCoordinate(value: string | null) {
  const coordinate = Number(value)

  return Number.isFinite(coordinate) ? coordinate : null
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

function normalizeStationName(value: string) {
  return value.replace(/\([^)]*\)/g, '').replace(/\s/g, '').trim()
}

function normalizeSubwayLineName(value: string) {
  return value.replace(/\s/g, '').toLowerCase()
}

function getLineIdCandidates(lineName: string) {
  const normalized = normalizeSubwayLineName(lineName)
  const mappings: Array<[RegExp, string[]]> = [
    [/1호선/, ['1001']],
    [/2호선/, ['1002']],
    [/3호선/, ['1003']],
    [/4호선/, ['1004']],
    [/5호선/, ['1005']],
    [/6호선/, ['1006']],
    [/7호선/, ['1007']],
    [/8호선/, ['1008']],
    [/9호선/, ['1009']],
    [/공항철도/, ['1065']],
    [/경의중앙/, ['1063']],
    [/경춘/, ['1067']],
    [/신분당/, ['1077']],
    [/수인분당|분당|수인/, ['1075']],
    [/우이신설/, ['1092']],
    [/서해/, ['1093']],
    [/김포골드/, ['1081']],
  ]

  return mappings.find(([pattern]) => pattern.test(normalized))?.[1] ?? []
}

function matchesDirectionHint(item: Record<string, unknown>, directionHint: string) {
  const normalizedHint = normalizeStationName(directionHint)

  if (!normalizedHint) {
    return false
  }

  return [item.trainLineNm, item.arvlMsg2, item.arvlMsg3, item.updnLine]
    .map((value) => normalizeStationName(getString(value)))
    .some((value) => value.includes(normalizedHint))
}

function compareSubwayArrival(left: Record<string, unknown>, right: Record<string, unknown>) {
  const leftSeconds = getNumberOrNull(left.barvlDt)
  const rightSeconds = getNumberOrNull(right.barvlDt)

  if (leftSeconds === null && rightSeconds === null) {
    return 0
  }

  if (leftSeconds === null) {
    return 1
  }

  if (rightSeconds === null) {
    return -1
  }

  return leftSeconds - rightSeconds
}

function formatSubwayArrivalMessage(item: Record<string, unknown>) {
  const message = getString(item.arvlMsg2).trim()
  const arrivalCode = getString(item.arvlCd).trim()

  if (message) {
    return message
  }

  if (arrivalCode === '0') {
    return '진입 중'
  }

  const arrivalSeconds = getNumberOrNull(item.barvlDt)

  if (arrivalSeconds !== null && arrivalSeconds > 0) {
    const minutes = Math.floor(arrivalSeconds / 60)
    const seconds = arrivalSeconds % 60

    return seconds > 0 ? `${minutes}분 ${seconds}초 후` : `${minutes}분 후`
  }

  return '도착 정보 없음'
}

function getSubwayArrivalSeconds(item: Record<string, unknown>) {
  const arrivalSeconds = getNumberOrNull(item.barvlDt)
  const arrivalCode = getString(item.arvlCd).trim()
  const message = getString(item.arvlMsg2).trim()

  if (arrivalSeconds === null) {
    return null
  }

  if (arrivalSeconds > 0) {
    return arrivalSeconds
  }

  if (arrivalCode === '0' || arrivalCode === '1' || arrivalCode === '5') {
    return 0
  }

  if (message.includes('도착') || message.includes('진입')) {
    return 0
  }

  return null
}

function parseSeoulSubwayArrival(data: unknown, query: SeoulSubwayArrivalQuery) {
  if (!isRecord(data) || !isRecord(data.errorMessage)) {
    return null
  }

  const statusCode = getString(data.errorMessage.code)

  if (statusCode && statusCode !== 'INFO-000') {
    return {
      message: getString(data.errorMessage.message) || '지하철 실시간 응답이 올바르지 않습니다.',
    }
  }

  const arrivals = Array.isArray(data.realtimeArrivalList)
    ? data.realtimeArrivalList.filter(isRecord)
    : []

  if (arrivals.length === 0) {
    return {
      message: getString(data.errorMessage.message) || '해당 역의 실시간 도착정보가 없습니다.',
    }
  }

  const normalizedStationName = normalizeStationName(query.stationName)
  const lineIds = getLineIdCandidates(query.lineName)
  const stationMatches = arrivals.filter(
    (item) => normalizeStationName(getString(item.statnNm)) === normalizedStationName,
  )
  const lineMatches =
    lineIds.length > 0
      ? stationMatches.filter((item) => lineIds.includes(getString(item.subwayId)))
      : stationMatches
  const directionMatches =
    query.directionHint && query.directionHint.trim().length > 0
      ? lineMatches.filter((item) => matchesDirectionHint(item, query.directionHint ?? ''))
      : []
  const chosenList = (directionMatches.length > 0 ? directionMatches : lineMatches).sort(
    compareSubwayArrival,
  )
  const [firstArrival, secondArrival] = chosenList

  if (!firstArrival) {
    return {
      message: `${query.stationName}역의 실시간 도착정보를 찾지 못했습니다.`,
    }
  }

  return {
    arrival: {
      routeName: query.lineName,
      firstMessage: formatSubwayArrivalMessage(firstArrival),
      secondMessage: secondArrival ? formatSubwayArrivalMessage(secondArrival) : '',
      firstArrivalSeconds: getSubwayArrivalSeconds(firstArrival),
      secondArrivalSeconds: secondArrival ? getSubwayArrivalSeconds(secondArrival) : null,
      congestion: '',
    },
  }
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

  for (const requestConfig of requests) {
    const odsayUrl = new URL('https://api.odsay.com/v1/api/realtimeStation')

    odsayUrl.searchParams.set('apiKey', apiKey)
    odsayUrl.searchParams.set('stationID', query.stationId)
    odsayUrl.searchParams.set('stationBase', requestConfig.stationBase)
    odsayUrl.searchParams.set('output', 'json')

    if (requestConfig.routeIds) {
      odsayUrl.searchParams.set('routeIDs', requestConfig.routeIds)
    }

    const odsayResponse = await fetch(odsayUrl, {
      headers: {
        Referer: ODSAY_REFERER,
      },
    })
    const responseData = (await odsayResponse.json()) as unknown

    if (!odsayResponse.ok || !isRecord(responseData) || !isRecord(responseData.result)) {
      continue
    }

    if (isRecord(responseData.result.error)) {
      unsupportedMessage = getString(responseData.result.error.msg)
      continue
    }

    const baseLaneItems =
      requestConfig.stationBase === '1' && isRecord(responseData.result.base)
        ? Array.isArray(responseData.result.base.lane)
          ? responseData.result.base.lane
          : []
        : []
    const baseLane = findOdsayBaseLane(baseLaneItems, query)

    if (baseLane) {
      matchedBaseLane = baseLane
    }

    const realtimeItems = Array.isArray(responseData.result.real) ? responseData.result.real : []
    const realtimeItem = findOdsayRealtimeItem(realtimeItems, {
      ...query,
      routeId: getString(baseLane?.busID) || query.routeId,
      busRouteId: getString(baseLane?.busLocalBlID) || query.busRouteId,
      routeName: getString(baseLane?.busNo) || query.routeName,
    })

    if (!realtimeItem) {
      continue
    }

    const firstArrival = isRecord(realtimeItem.arrival1) ? realtimeItem.arrival1 : null
    const secondArrival = isRecord(realtimeItem.arrival2) ? realtimeItem.arrival2 : null

    if (!firstArrival && !secondArrival) {
      matchedRouteNameWithoutArrival = getString(realtimeItem.routeNm) || query.routeName
      continue
    }

    return {
      arrival: {
        routeName: getString(realtimeItem.routeNm) || query.routeName,
        firstMessage: firstArrival ? formatOdsayArrivalMessage(firstArrival) : '도착 정보 없음',
        secondMessage: secondArrival ? formatOdsayArrivalMessage(secondArrival) : '',
        firstArrivalSeconds: firstArrival ? getNumberOrNull(firstArrival.arrivalSec) : null,
        secondArrivalSeconds: secondArrival ? getNumberOrNull(secondArrival.arrivalSec) : null,
        congestion: firstArrival ? String(getNumberOrNull(firstArrival.congestion) ?? '') : '',
      },
    }
  }

  if (matchedRouteNameWithoutArrival) {
    return {
      arrival: {
        routeName: matchedRouteNameWithoutArrival,
        firstMessage: '도착 정보 없음',
        secondMessage: '',
        firstArrivalSeconds: null,
        secondArrivalSeconds: null,
        congestion: '',
      },
    }
  }

  if (matchedBaseLane) {
    const routeName = getString(matchedBaseLane.busNo) || query.routeName
    const busCityCode = getString(matchedBaseLane.busCityCode)

    if (busCityCode && busCityCode !== '1000') {
      return {
        message: `${routeName} 버스는 현재 ODsay 실시간 제공 범위 밖이거나 준비 중입니다.`,
      }
    }

    return {
      arrival: {
        routeName,
        firstMessage: '실시간 도착 정보 없음',
        secondMessage: '',
        firstArrivalSeconds: null,
        secondArrivalSeconds: null,
        congestion: '',
      },
    }
  }

  if (unsupportedMessage) {
    return {
      message: unsupportedMessage,
    }
  }

  return null
}

export async function handleTransitRoutes(requestUrl: string, apiKey: string | undefined) {
  if (!apiKey) {
    return {
      status: 500,
      body: { message: 'ODsay API key is not configured.' },
    } satisfies JsonResponse
  }

  const searchParams = new URL(requestUrl, 'http://localhost').searchParams
  const startLatitude = parseCoordinate(searchParams.get('startLatitude'))
  const startLongitude = parseCoordinate(searchParams.get('startLongitude'))
  const endLatitude = parseCoordinate(searchParams.get('endLatitude'))
  const endLongitude = parseCoordinate(searchParams.get('endLongitude'))

  if (
    startLatitude === null ||
    startLongitude === null ||
    endLatitude === null ||
    endLongitude === null
  ) {
    return {
      status: 400,
      body: { message: 'Valid route coordinates are required.' },
    } satisfies JsonResponse
  }

  const odsayUrl = new URL('https://api.odsay.com/v1/api/searchPubTransPathT')
  odsayUrl.searchParams.set('SX', String(startLongitude))
  odsayUrl.searchParams.set('SY', String(startLatitude))
  odsayUrl.searchParams.set('EX', String(endLongitude))
  odsayUrl.searchParams.set('EY', String(endLatitude))
  odsayUrl.searchParams.set('OPT', '0')
  odsayUrl.searchParams.set('SearchType', '0')
  odsayUrl.searchParams.set('SearchPathType', '0')
  odsayUrl.searchParams.set('apiKey', apiKey)

  try {
    const odsayResponse = await fetch(odsayUrl, {
      headers: {
        Referer: ODSAY_REFERER,
      },
    })
    const responseBody = await odsayResponse.text()

    return {
      status: odsayResponse.status,
      body: responseBody,
    }
  } catch {
    return {
      status: 502,
      body: { message: 'Failed to fetch transit routes.' },
    }
  }
}

export async function handleSeoulBusArrivals(requestUrl: string, apiKey: string | undefined) {
  if (!apiKey) {
    return {
      status: 500,
      body: { message: 'ODsay API key is not configured.' },
    } satisfies JsonResponse
  }

  const searchParams = new URL(requestUrl, 'http://localhost').searchParams
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
    return {
      status: 400,
      body: { message: 'Valid routeName and bus arrival query are required.' },
    } satisfies JsonResponse
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
      return {
        status: 200,
        body: { arrival: odsayResult.arrival },
      } satisfies JsonResponse
    }

    if (odsayResult?.message) {
      return {
        status: 404,
        body: { message: odsayResult.message },
      } satisfies JsonResponse
    }

    return {
      status: 404,
      body: { message: `${routeName} 버스 도착정보를 찾지 못했습니다.` },
    } satisfies JsonResponse
  } catch {
    return {
      status: 502,
      body: { message: 'Failed to fetch ODsay bus arrivals.' },
    } satisfies JsonResponse
  }
}

export async function handleSeoulSubwayArrivals(requestUrl: string, apiKey: string | undefined) {
  if (!apiKey) {
    return {
      status: 500,
      body: { message: 'Seoul subway API key is not configured.' },
    } satisfies JsonResponse
  }

  const searchParams = new URL(requestUrl, 'http://localhost').searchParams
  const stationName = searchParams.get('stationName')?.trim()
  const lineName = searchParams.get('lineName')?.trim()
  const directionHint = searchParams.get('directionHint')?.trim() ?? ''

  if (!stationName || !lineName) {
    return {
      status: 400,
      body: { message: 'Valid stationName and lineName are required.' },
    } satisfies JsonResponse
  }

  const apiUrl = `http://swopenAPI.seoul.go.kr/api/subway/${apiKey}/json/realtimeStationArrival/0/20/${encodeURIComponent(
    stationName,
  )}`

  try {
    const responseData = await fetchJsonOverHttp(apiUrl)
    const result = parseSeoulSubwayArrival(responseData, {
      stationName,
      lineName,
      directionHint,
    })

    if (result?.arrival) {
      return {
        status: 200,
        body: { arrival: result.arrival },
      } satisfies JsonResponse
    }

    return {
      status: 404,
      body: {
        message: result?.message ?? '지하철 실시간 도착정보를 찾지 못했습니다.',
      },
    } satisfies JsonResponse
  } catch {
    return {
      status: 502,
      body: { message: 'Failed to fetch Seoul subway arrivals.' },
    } satisfies JsonResponse
  }
}
