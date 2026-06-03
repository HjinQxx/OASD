import { handleSeoulBusArrivals } from '../server/transitApi'

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

  const result = await handleSeoulBusArrivals(
    request.url ?? '/api/seoul-bus-arrivals',
    process.env.ODSAY_API_KEY,
  )

  response.status(result.status).json(result.body)
}
