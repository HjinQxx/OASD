const NAVER_MAP_SCRIPT_ID = 'naver-map-sdk'
const NAVER_MAP_CALLBACK_NAME = '__initPersonalMapNaverSdk'

declare global {
  interface Window {
    __initPersonalMapNaverSdk?: () => void
  }
}

export function loadNaverMap() {
  return new Promise<void>((resolve, reject) => {
    if (window.naver?.maps) {
      resolve()
      return
    }

    const existingScript = document.getElementById(NAVER_MAP_SCRIPT_ID)

    if (existingScript) {
      existingScript.addEventListener(
        'load',
        () => {
          if (window.naver?.maps) {
            resolve()
          }
        },
        { once: true },
      )
      existingScript.addEventListener(
        'error',
        () => reject(new Error('네이버 지도 SDK를 불러오지 못했습니다.')),
        { once: true },
      )
      return
    }

    const clientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID

    if (!clientId) {
      reject(new Error('VITE_NAVER_MAP_CLIENT_ID가 설정되지 않았습니다.'))
      return
    }

    window[NAVER_MAP_CALLBACK_NAME] = () => {
      resolve()
      delete window[NAVER_MAP_CALLBACK_NAME]
    }

    const script = document.createElement('script')
    script.id = NAVER_MAP_SCRIPT_ID
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${clientId}&submodules=geocoder&callback=${NAVER_MAP_CALLBACK_NAME}`
    script.async = true
    script.onerror = () => {
      delete window[NAVER_MAP_CALLBACK_NAME]
      reject(new Error('네이버 지도 SDK를 불러오지 못했습니다.'))
    }

    document.head.appendChild(script)
  })
}
