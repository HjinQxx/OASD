export type Coordinates = {
  latitude: number
  longitude: number
}

export type SavedPlace = Coordinates & {
  name: string
  description: string
  aliases?: string[]
}
