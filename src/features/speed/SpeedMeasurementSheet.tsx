import { useEffect, useMemo, useState } from 'react'
import {
  createManualSpeedSample,
  getSavedSpeedStats,
  loadSpeedSamples,
  saveSpeedSamples,
  SPEED_SAMPLES_UPDATED_EVENT,
  type SpeedSample,
} from './speedTracking'

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)

  return `${minutes}분 ${seconds.toString().padStart(2, '0')}초`
}

function formatDistance(meters: number) {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`
  }

  return `${meters.toFixed(0)} m`
}

function formatRecordedAt(timestamp: number) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

export function SpeedMeasurementSheet() {
  const [isOpen, setIsOpen] = useState(false)
  const [samples, setSamples] = useState<SpeedSample[]>(loadSpeedSamples)
  const [manualCurrentSpeed, setManualCurrentSpeed] = useState<number | null>(
    () => loadSpeedSamples()[0]?.speedMps ?? null,
  )
  const [manualSpeed, setManualSpeed] = useState('')
  const [statusText, setStatusText] = useState(
    '길찾기 중 선택한 경로의 도보 구간에 들어가면 속력이 자동으로 측정됩니다.',
  )

  useEffect(() => {
    const syncSavedSamples = () => {
      setSamples(loadSpeedSamples())
    }

    window.addEventListener(SPEED_SAMPLES_UPDATED_EVENT, syncSavedSamples)
    window.addEventListener('storage', syncSavedSamples)

    return () => {
      window.removeEventListener(SPEED_SAMPLES_UPDATED_EVENT, syncSavedSamples)
      window.removeEventListener('storage', syncSavedSamples)
    }
  }, [])

  const savedStats = useMemo(() => getSavedSpeedStats(samples), [samples])
  const currentSpeedMps = manualCurrentSpeed ?? savedStats.averageSpeed
  const routeAnalysisSamples = useMemo(
    () => samples.filter((sample) => sample.source === 'route-walking-segment').slice(0, 5),
    [samples],
  )

  const saveManualSpeed = () => {
    const sample = createManualSpeedSample(Number(manualSpeed))

    if (!sample) {
      setStatusText('0보다 큰 속력을 m/s 단위로 입력해 주세요.')
      return
    }

    setManualCurrentSpeed(sample.speedMps)
    setSamples((currentSamples) => {
      const nextSamples = [sample, ...currentSamples]
      saveSpeedSamples(nextSamples)

      return nextSamples
    })
    setManualSpeed('')
    setStatusText('직접 입력한 속력을 평균 속력에 반영했습니다.')
  }

  return (
    <>
      <button
        className="speedButton"
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="속력측정"
      >
        <svg
          className="buttonIcon"
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        >
          <path d="M4.4 16.8a8.4 8.4 0 1 1 15.2 0" />
          <path d="M12 16.8 16.8 9" />
          <path d="M7.2 16.8h9.6" />
          <path d="M6.5 12.1h1.2" />
          <path d="M12 8.2v1.2" />
          <path d="M17.5 12.1h-1.2" />
        </svg>
      </button>

      <div className={`sheetBackdrop ${isOpen ? 'open' : ''}`} aria-hidden={!isOpen}>
        <section className="speedSheet" aria-label="속력 측정 통계">
          <div className="sheetHandle" />
          <div className="sheetHeader">
            <div>
              <p className="eyebrow">Walking Speed</p>
              <h2>속력통계</h2>
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

          <p className="sheetStatus">{statusText}</p>

          <div className="speedStatsGrid">
            <article>
              <span>도보 거리</span>
              <strong>{formatDistance(savedStats.totalDistance)}</strong>
            </article>
            <article>
              <span>도보 시간</span>
              <strong>{formatDuration(savedStats.totalDuration)}</strong>
            </article>
            <article>
              <span>평균 속력</span>
              <strong>{currentSpeedMps.toFixed(2)} m/s</strong>
            </article>
          </div>

          <div className="autoMeasureNote">
            <strong>
              속력 입력
              <span>(성인 남자의 평균속력 : 1.39m/s)</span>
            </strong>
            <div className="manualSpeedForm">
              <input
                value={manualSpeed}
                onChange={(event) => setManualSpeed(event.target.value)}
                inputMode="decimal"
                placeholder="예: 1.25"
                aria-label="직접 입력할 도보 속력"
              />
              <button type="button" onClick={saveManualSpeed}>
                등록
              </button>
            </div>
            <p>입력한 속력은 m/s 기준이며, 경로의 도보 소요 시간 계산에 우선 반영됩니다.</p>
          </div>

          <div className="autoMeasureNote">
            <strong>자동 측정 방식</strong>
            <p>
              선택한 경로를 따라 이동할 때 도보 구간 근처에 들어가면 측정을 켜고,
              버스나 지하철 구간으로 넘어가면 자동으로 종료해 평균 속력을 저장합니다.
            </p>
          </div>

          <div className="speedAnalysisPanel" aria-label="5회차 속력분석 자료">
            <strong>5회차 속력분석 자료</strong>
            {routeAnalysisSamples.length > 0 && (
              <ol>
                {routeAnalysisSamples.map((sample, index) => (
                  <li key={sample.id}>
                    <span>{index + 1}회차</span>
                    <div>
                      <b>{sample.speedMps.toFixed(2)} m/s</b>
                      <small>
                        {formatDistance(sample.distanceMeters)} ·{' '}
                        {formatDuration(sample.durationSeconds)} ·{' '}
                        {formatRecordedAt(sample.id)}
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>
    </>
  )
}
