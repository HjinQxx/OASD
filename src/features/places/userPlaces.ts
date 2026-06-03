import type { SavedPlace } from '../../types/map'

export type UserPlace = SavedPlace & {
  id: string
  createdAt: string
}

export const USER_PLACES_KEY = 'personal-map-user-places'

export function loadUserPlaces() {
  try {
    const savedPlaces = window.localStorage.getItem(USER_PLACES_KEY)

    return savedPlaces ? (JSON.parse(savedPlaces) as UserPlace[]) : []
  } catch {
    return []
  }
}

export function saveUserPlaces(places: UserPlace[]) {
  window.localStorage.setItem(USER_PLACES_KEY, JSON.stringify(places))
}

export function createUserPlace(place: Omit<UserPlace, 'id' | 'createdAt'>) {
  return {
    ...place,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
}
