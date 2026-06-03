import { handleSeoulSubwayArrivals } from './_transitApi'

type RequestLike = {
  url?: string
}

type ResponseLike = {
  status: (code: number) => ResponseLike
  json: (body: unknown) => void
  setHeader?: (name: string, value: string) => void
}

export default async function handler(request: RequestLike, response: ResponseLike) {
  response.setHeader?.('Content-Type', 'application/json; charset=utf-8')

  const result = await handleSeoulSubwayArrivals(
    request.url ?? '/api/seoul-subway-arrivals',
    process.env.SEOUL_SUBWAY_API_KEY,
  )

  response.status(result.status).json(result.body)
}
