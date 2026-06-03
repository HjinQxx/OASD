const ODSAY_REFERER = 'http://localhost:5173/'

type RequestLike = {
  url?: string
}

type ResponseLike = {
  status: (code: number) => ResponseLike
  json: (body: unknown) => void
  send: (body: string) => void
  setHeader?: (name: string, value: string) => void
}

function parseCoordinate(value: string | null) {
  const coordinate = Number(value)
  return Number.isFinite(coordinate) ? coordinate : null
}

export default async function handler(request: RequestLike, response: ResponseLike) {
  response.setHeader?.('Content-Type', 'application/json; charset=utf-8')

  const apiKey = process.env.ODSAY_API_KEY

  if (!apiKey) {
    response.status(500).json({ message: 'ODsay API key is not configured.' })
    return
  }

  const searchParams = new URL(request.url ?? '/api/transit-routes', 'http://localhost').searchParams
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
    response.status(400).json({ message: 'Valid route coordinates are required.' })
    return
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

    response.status(odsayResponse.status)

    if (typeof responseBody === 'string') {
      response.send(responseBody)
      return
    }

    response.json(responseBody)
  } catch {
    response.status(502).json({ message: 'Failed to fetch transit routes.' })
  }
}
