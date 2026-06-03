import { getDistanceMeters } from '../../map/mapMath'
import type { Coordinates } from '../../types/map'

export type WalkPoint = Coordinates & {
  timestamp: number
}

export type SpeedSample = {
  id: number
  distanceMeters: number
  durationSeconds: number
  speedMps: number
  source: 'route-walking-segment' | 'manual-test'
  routeLabel?: string
}

export const SPEED_SAMPLES_KEY = 'personal-map-speed-samples'
export const SPEED_SAMPLES_UPDATED_EVENT = 'personal-map-speed-samples-updated'

export function loadSpeedSamples() {
  try {
    const savedSamples = window.localStorage.getItem(SPEED_SAMPLES_KEY)

    return savedSamples ? (JSON.parse(savedSamples) as SpeedSample[]) : []
  } catch {
    return []
  }
}

export function saveSpeedSamples(samples: SpeedSample[]) {
  window.localStorage.setItem(SPEED_SAMPLES_KEY, JSON.stringify(samples))
  window.dispatchEvent(new Event(SPEED_SAMPLES_UPDATED_EVENT))
}

export function getWalkStats(points: WalkPoint[]) {
  const distanceMeters = points.reduce((total, point, index) => {
    if (index === 0) {
      return total
    }

    return total + getDistanceMeters(points[index - 1], point)
  }, 0)
  const durationSeconds =
    points.length > 1
      ? (points[points.length - 1].timestamp - points[0].timestamp) / 1000
      : 0
  const speedMps = durationSeconds > 0 ? distanceMeters / durationSeconds : 0

  return { distanceMeters, durationSeconds, speedMps }
}

export function createSpeedSample(
  points: WalkPoint[],
  source: SpeedSample['source'],
  routeLabel?: string,
) {
  const stats = getWalkStats(points)

  if (stats.distanceMeters < 10 || stats.durationSeconds < 10) {
    return null
  }

  return {
    id: Date.now(),
    distanceMeters: stats.distanceMeters,
    durationSeconds: stats.durationSeconds,
    speedMps: stats.speedMps,
    source,
    routeLabel,
  }
}

export function createManualSpeedSample(speedMps: number): SpeedSample | null {
  if (!Number.isFinite(speedMps) || speedMps <= 0) {
    return null
  }

  return {
    id: Date.now(),
    distanceMeters: speedMps * 60,
    durationSeconds: 60,
    speedMps,
    source: 'manual-test',
    routeLabel: '직접 입력 속력',
  }
}

export function getSavedSpeedStats(samples: SpeedSample[]) {
  const totalDistance = samples.reduce((sum, sample) => sum + sample.distanceMeters, 0)
  const totalDuration = samples.reduce((sum, sample) => sum + sample.durationSeconds, 0)
  const averageSpeed = totalDuration > 0 ? totalDistance / totalDuration : 0
  const bestSpeed = samples.reduce((best, sample) => Math.max(best, sample.speedMps), 0)

  return {
    averageSpeed,
    bestSpeed,
    totalDistance,
    totalDuration,
    sampleCount: samples.length,
  }
}

export function getPreferredWalkingSpeed(samples: SpeedSample[]) {
  const latestManualSpeed = samples.find(
    (sample) => sample.source === 'manual-test' && sample.speedMps > 0,
  )?.speedMps
  const latestMeasuredSpeed = samples.find(
    (sample) => sample.source === 'route-walking-segment' && sample.speedMps > 0,
  )?.speedMps

  return latestManualSpeed ?? latestMeasuredSpeed ?? null
}
