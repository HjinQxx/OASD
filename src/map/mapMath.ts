import type { Coordinates } from '../types/map'

export const DEFAULT_CENTER: Coordinates = {
  latitude: 37.5665,
  longitude: 126.978,
}

export const SERVICE_BOUNDS = {
  minLatitude: 36.8,
  maxLatitude: 38.35,
  minLongitude: 126.3,
  maxLongitude: 127.95,
}

export const TILE_SIZE = 256
export const TILE_RADIUS = 3
export const DEFAULT_ZOOM = 11
export const MIN_ZOOM = 8
export const MAX_ZOOM = 16

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function isWithinServiceArea(coordinates: Coordinates) {
  return (
    coordinates.latitude >= SERVICE_BOUNDS.minLatitude &&
    coordinates.latitude <= SERVICE_BOUNDS.maxLatitude &&
    coordinates.longitude >= SERVICE_BOUNDS.minLongitude &&
    coordinates.longitude <= SERVICE_BOUNDS.maxLongitude
  )
}

export function clampToServiceArea(coordinates: Coordinates) {
  return {
    latitude: clamp(
      coordinates.latitude,
      SERVICE_BOUNDS.minLatitude,
      SERVICE_BOUNDS.maxLatitude,
    ),
    longitude: clamp(
      coordinates.longitude,
      SERVICE_BOUNDS.minLongitude,
      SERVICE_BOUNDS.maxLongitude,
    ),
  }
}

export function getDistanceMeters(start: Coordinates, end: Coordinates) {
  const earthRadius = 6_371_000
  const startLat = (start.latitude * Math.PI) / 180
  const endLat = (end.latitude * Math.PI) / 180
  const latDelta = ((end.latitude - start.latitude) * Math.PI) / 180
  const lngDelta = ((end.longitude - start.longitude) * Math.PI) / 180
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(lngDelta / 2) ** 2

  return earthRadius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

export function getMapSize(zoom: number) {
  return TILE_SIZE * 2 ** zoom
}

export function longitudeToWorldX(longitude: number, zoom: number) {
  return ((longitude + 180) / 360) * getMapSize(zoom)
}

export function latitudeToWorldY(latitude: number, zoom: number) {
  const latitudeRadians = (clamp(latitude, -85.0511, 85.0511) * Math.PI) / 180

  return (
    ((1 -
      Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) /
        Math.PI) /
      2) *
    getMapSize(zoom)
  )
}

export function worldXToLongitude(worldX: number, zoom: number) {
  return (worldX / getMapSize(zoom)) * 360 - 180
}

export function worldYToLatitude(worldY: number, zoom: number) {
  const normalizedY = 1 - (2 * worldY) / getMapSize(zoom)
  return (Math.atan(Math.sinh(Math.PI * normalizedY)) * 180) / Math.PI
}

export function coordinatesToWorld(coordinates: Coordinates, zoom: number) {
  return {
    x: longitudeToWorldX(coordinates.longitude, zoom),
    y: latitudeToWorldY(coordinates.latitude, zoom),
  }
}

export function worldToCoordinates(world: { x: number; y: number }, zoom: number) {
  const mapSize = getMapSize(zoom)

  return clampToServiceArea({
    latitude: clamp(worldYToLatitude(clamp(world.y, 0, mapSize), zoom), -85, 85),
    longitude: worldXToLongitude(((world.x % mapSize) + mapSize) % mapSize, zoom),
  })
}

export function tileXToLongitude(tileX: number, zoom: number) {
  return (tileX / 2 ** zoom) * 360 - 180
}

export function tileYToLatitude(tileY: number, zoom: number) {
  const normalizedY = Math.PI * (1 - (2 * tileY) / 2 ** zoom)
  return (Math.atan(Math.sinh(normalizedY)) * 180) / Math.PI
}

export function tileIntersectsServiceArea(tileX: number, tileY: number, zoom: number) {
  const west = tileXToLongitude(tileX, zoom)
  const east = tileXToLongitude(tileX + 1, zoom)
  const north = tileYToLatitude(tileY, zoom)
  const south = tileYToLatitude(tileY + 1, zoom)

  return !(
    east < SERVICE_BOUNDS.minLongitude ||
    west > SERVICE_BOUNDS.maxLongitude ||
    north < SERVICE_BOUNDS.minLatitude ||
    south > SERVICE_BOUNDS.maxLatitude
  )
}

export function parseCoordinateSearch(query: string): Coordinates | null {
  const match = query
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/)

  if (!match) {
    return null
  }

  const latitude = Number(match[1])
  const longitude = Number(match[2])
  const coordinates = { latitude, longitude }

  if (
    Number.isNaN(latitude) ||
    Number.isNaN(longitude) ||
    !isWithinServiceArea(coordinates)
  ) {
    return null
  }

  return coordinates
}
