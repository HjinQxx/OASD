import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import {
  handleSeoulBusArrivals,
  handleSeoulSubwayArrivals,
  handleTransitRoutes,
} from './server/transitApi'

const TRANSIT_ROUTES_ENDPOINT = '/api/transit-routes'
const SEOUL_BUS_ARRIVALS_ENDPOINT = '/api/seoul-bus-arrivals'
const SEOUL_SUBWAY_ARRIVALS_ENDPOINT = '/api/seoul-subway-arrivals'

function jsonProxy(
  endpoint: string,
  handler: (requestUrl: string, apiKey: string | undefined) => Promise<{ status: number; body: unknown }>,
  apiKey: string | undefined,
): Plugin {
  return {
    name: `proxy:${endpoint}`,
    configureServer(server) {
      server.middlewares.use(endpoint, async (request, response) => {
        response.setHeader('Content-Type', 'application/json; charset=utf-8')

        const requestUrl = (request as { url?: string }).url ?? endpoint
        const result = await handler(requestUrl, apiKey)

        response.statusCode = result.status
        response.end(
          typeof result.body === 'string' ? result.body : JSON.stringify(result.body),
        )
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')

  return {
    plugins: [
      react(),
      jsonProxy(TRANSIT_ROUTES_ENDPOINT, handleTransitRoutes, env.ODSAY_API_KEY),
      jsonProxy(SEOUL_BUS_ARRIVALS_ENDPOINT, handleSeoulBusArrivals, env.ODSAY_API_KEY),
      jsonProxy(
        SEOUL_SUBWAY_ARRIVALS_ENDPOINT,
        handleSeoulSubwayArrivals,
        env.SEOUL_SUBWAY_API_KEY,
      ),
    ],
    server: {
      port: 5173,
      strictPort: true,
    },
  }
})
