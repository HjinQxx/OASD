type RequestLike = {
  method?: string
}

type ResponseLike = {
  status: (code: number) => ResponseLike
  json: (body: unknown) => void
  setHeader?: (name: string, value: string) => void
}

export default async function handler(_request: RequestLike, response: ResponseLike) {
  response.setHeader?.('Content-Type', 'application/json; charset=utf-8')
  response.status(200).json({ ok: true, at: new Date().toISOString() })
}
