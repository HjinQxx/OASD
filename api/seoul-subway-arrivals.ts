type RequestLike = {
  url?: string
}

type ResponseLike = {
  status: (code: number) => ResponseLike
  json: (body: unknown) => void
  setHeader?: (name: string, value: string) => void
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

export default async function handler(request: RequestLike, response: ResponseLike) {
  response.setHeader?.('Content-Type', 'application/json; charset=utf-8')

  const apiKey = process.env.SEOUL_SUBWAY_API_KEY

  if (!apiKey) {
    response.status(500).json({ message: 'Seoul subway API key is not configured.' })
    return
  }

  const searchParams = new URL(
    request.url ?? '/api/seoul-subway-arrivals',
    'http://localhost',
  ).searchParams
  const stationName = searchParams.get('stationName')?.trim()
  const lineName = searchParams.get('lineName')?.trim()
  const directionHint = searchParams.get('directionHint')?.trim() ?? ''

  if (!stationName || !lineName) {
    response.status(400).json({ message: 'Valid stationName and lineName are required.' })
    return
  }

  const apiUrl = new URL(
    `https://swopenAPI.seoul.go.kr/api/subway/${apiKey}/json/realtimeStationArrival/0/20/${encodeURIComponent(
      stationName,
    )}`,
  )

  try {
    const subwayResponse = await fetch(apiUrl)
    const responseData = (await subwayResponse.json()) as unknown

    if (!isRecord(responseData) || !isRecord(responseData.errorMessage)) {
      response.status(502).json({ message: '지하철 실시간 응답이 올바르지 않습니다.' })
      return
    }

    const statusCode = getString(responseData.errorMessage.code)
    if (statusCode && statusCode !== 'INFO-000') {
      response
        .status(subwayResponse.ok ? 404 : subwayResponse.status)
        .json({
          message:
            getString(responseData.errorMessage.message) ||
            '지하철 실시간 도착정보를 찾지 못했습니다.',
        })
      return
    }

    const arrivals = Array.isArray(responseData.realtimeArrivalList)
      ? responseData.realtimeArrivalList.filter(isRecord)
      : []

    if (arrivals.length === 0) {
      response.status(404).json({ message: '해당 역의 실시간 도착정보가 없습니다.' })
      return
    }

    const normalizedStationName = normalizeStationName(stationName)
    const lineIds = getLineIdCandidates(lineName)
    const stationMatches = arrivals.filter(
      (item) => normalizeStationName(getString(item.statnNm)) === normalizedStationName,
    )
    const lineMatches =
      lineIds.length > 0
        ? stationMatches.filter((item) => lineIds.includes(getString(item.subwayId)))
        : stationMatches
    const directionMatches =
      directionHint && directionHint.trim().length > 0
        ? lineMatches.filter((item) => matchesDirectionHint(item, directionHint))
        : []
    const chosenList = (directionMatches.length > 0 ? directionMatches : lineMatches).sort(
      compareSubwayArrival,
    )
    const [firstArrival, secondArrival] = chosenList

    if (!firstArrival) {
      response.status(404).json({ message: `${stationName}역의 실시간 도착정보를 찾지 못했습니다.` })
      return
    }

    response.status(200).json({
      arrival: {
        routeName: lineName,
        firstMessage: formatSubwayArrivalMessage(firstArrival),
        secondMessage: secondArrival ? formatSubwayArrivalMessage(secondArrival) : '',
        firstArrivalSeconds: getNumberOrNull(firstArrival.barvlDt),
        secondArrivalSeconds: secondArrival ? getNumberOrNull(secondArrival.barvlDt) : null,
        congestion: '',
      },
    })
  } catch {
    response.status(502).json({ message: 'Failed to fetch Seoul subway arrivals.' })
  }
}
