import { useEffect, useState, type FormEvent } from 'react'
import type { Coordinates } from '../../types/map'
import {
  createUserPlace,
  loadUserPlaces,
  saveUserPlaces,
  type UserPlace,
} from './userPlaces'

type PlaceBookmarkSheetProps = {
  pickedLocation: Coordinates | null
  isPickingPlace: boolean
  onPlacesChange: (places: UserPlace[]) => void
  onStartPicking: () => void
}

const DEFAULT_LOCATION: Coordinates = {
  latitude: 37.5665,
  longitude: 126.978,
}

export function PlaceBookmarkSheet({
  pickedLocation,
  isPickingPlace,
  onPlacesChange,
  onStartPicking,
}: PlaceBookmarkSheetProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [places, setPlaces] = useState<UserPlace[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedLocation, setSelectedLocation] = useState<Coordinates>(DEFAULT_LOCATION)
  const [statusText, setStatusText] = useState('')

  useEffect(() => {
    const loadedPlaces = loadUserPlaces()
    setPlaces(loadedPlaces)
    onPlacesChange(loadedPlaces)
  }, [onPlacesChange])

  useEffect(() => {
    if (!pickedLocation) {
      return
    }

    setIsOpen(true)
    setSelectedLocation(pickedLocation)
    setStatusText('지도에서 선택한 위치가 입력되었습니다.')
  }, [pickedLocation])

  const persistPlaces = (nextPlaces: UserPlace[]) => {
    setPlaces(nextPlaces)
    saveUserPlaces(nextPlaces)
    onPlacesChange(nextPlaces)
  }

  const handlePickFromMap = () => {
    setIsOpen(false)
    setStatusText('지도에서 저장할 위치를 클릭해 주세요.')
    onStartPicking()
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!name.trim()) {
      setStatusText('장소 이름을 입력해 주세요.')
      return
    }

    const nextPlace = createUserPlace({
      name: name.trim(),
      description: description.trim() || '내가 저장한 장소',
      aliases: [],
      latitude: selectedLocation.latitude,
      longitude: selectedLocation.longitude,
    })
    const nextPlaces = [nextPlace, ...places]

    persistPlaces(nextPlaces)
    setName('')
    setDescription('')
    setStatusText(`${nextPlace.name}을(를) 내 장소에 저장했습니다.`)
  }

  const deletePlace = (id: string) => {
    persistPlaces(places.filter((place) => place.id !== id))
  }

  return (
    <>
      <button className="bookmarkButton" type="button" onClick={() => setIsOpen(true)}>
        장소등록
      </button>

      {isPickingPlace && (
        <div className="pickHint" role="status">
          지도에서 저장할 위치를 클릭해 주세요
        </div>
      )}

      <div className={`placeSheetBackdrop ${isOpen ? 'open' : ''}`} aria-hidden={!isOpen}>
        <section className="placeSheet" aria-label="내 장소 등록">
          <div className="sheetHandle" />
          <div className="sheetHeader">
            <div>
              <p className="eyebrow">My Places</p>
              <h2>장소 등록</h2>
            </div>
            <button
              className="closeSheetButton"
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="닫기"
            >
              ×
            </button>
          </div>

          {statusText && <p className="sheetStatus">{statusText}</p>}

          <form className="placeForm" onSubmit={handleSubmit}>
            <label>
              장소 이름
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="예: 집, 불광역, 단골 카페"
              />
            </label>
            <label>
              메모
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="예: 버스 타는 곳, 자주 가는 환승지"
              />
            </label>
            <button className="mapPickButton" type="button" onClick={handlePickFromMap}>
              지도에서 위치 선택
            </button>
            <button className="primaryAction" type="submit">
              저장
            </button>
          </form>

          {places.length > 0 && (
            <div className="savedPlaceList">
              {places.map((place) => (
                <article key={place.id}>
                  <div>
                    <strong>{place.name}</strong>
                    <span>{place.description}</span>
                  </div>
                  <button type="button" onClick={() => deletePlace(place.id)}>
                    삭제
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )
}
