import { useMemo, useState } from 'react'
import { PlaceBookmarkSheet } from './features/places/PlaceBookmarkSheet'
import type { UserPlace } from './features/places/userPlaces'
import { SpeedMeasurementSheet } from './features/speed/SpeedMeasurementSheet'
import { NaverMap } from './map/NaverMap'
import type { Coordinates } from './types/map'

function App() {
  const [userPlaces, setUserPlaces] = useState<UserPlace[]>([])
  const [isPickingPlace, setIsPickingPlace] = useState(false)
  const [pickedLocation, setPickedLocation] = useState<Coordinates | null>(null)
  const searchablePlaces = useMemo(() => [...userPlaces], [userPlaces])

  return (
    <main className="app">
      <NaverMap
        savedPlaces={searchablePlaces}
        isPickingPlace={isPickingPlace}
        onPickPlaceLocation={(coordinates) => {
          setPickedLocation(coordinates)
          setIsPickingPlace(false)
        }}
      />
      <SpeedMeasurementSheet />
      <PlaceBookmarkSheet
        pickedLocation={pickedLocation}
        isPickingPlace={isPickingPlace}
        onPlacesChange={setUserPlaces}
        onStartPicking={() => setIsPickingPlace(true)}
      />
    </main>
  )
}

export default App
