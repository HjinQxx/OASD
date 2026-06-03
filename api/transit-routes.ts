import { handleTransitRoutes } from '../server/transitApi'

type RequestLike = {
  url?: string
}

type ResponseLike = {
  status: (code: number) => ResponseLike
  json: (body: unknown) => void
  send: (body: string) => void
  setHeader?: (name: string, value: string) => void
}

export default async function handler(request: RequestLike, response: ResponseLike) {
  response.setHeader?.('Content-Type', 'application/json; charset=utf-8')

  const result = await handleTransitRoutes(
    request.url ?? '/api/transit-routes',
    process.env.ODSAY_API_KEY,
  )

  response.status(result.status)

  if (typeof result.body === 'string') {
    response.send(result.body)
    return
  }

  response.json(result.body)
}
