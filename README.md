# OASD

open source ai design - 기말과제

## personal_map
 
서울/경기권 이동 경로를 찾고, 버스/지하철 실시간 도착 정보를 확인하고, 도보 속력을 반영해 경로 시간을 보정하는 Vite + React + TypeScript 앱입니다.

## 사용방법

1. https://oasd-seven.vercel.app 링크 접속
2. (선택)
   좌측 하단의 계기판 아이콘 클릭 후 속력통계 확인. 필요하다면 '속력 입력'에 본인의 속력을 입력.
3. 장소등록 버튼을 눌러 장소를 등록. 이름과 메모를 작성 후 '지도에서 위치 선택'을 눌러 지도에서 해당 장소    를 등록.
4. 좌측 상단의 검색창에서 등록해놓은 장소 검색.
5. 우측 하단의 팝업에서 알맞은 필터를 선택 후 길찾기 시작.
6. 길찾기를 실행한 채 이동 시 자동으로 속력이 측정됩니다.


## 참고사항
1. (2)의 속력을 등록하지 않으면 성인 남성의 평균속력 1.39m/s로 시간 산출
2. (3)의 장소등록이 선행되지 않으면 길찾기가 불가능합니다.
3. 앱 제작을 위해 사용한 외부 API는 다음과 같음
   VITE_NAVER_MAP_CLIENT_ID (지도 사용을 위한 네이버 클라우드 플랫폼 지도 API)
   ODSAY_API_KEY (길찾기 경로 및 대중교통 현황을 위한 오디세이 API)
   SEOUL_SUBWAY_API_KEY (지하철 현황을 위한 서울 열린데이터광장 API)

   API의 키는 전부 환경변수로 분리해 적용했습니다.




==========
```bash
npm install
cp .env.example .env.local
npm run dev
```

필수 환경변수:

```env
VITE_NAVER_MAP_CLIENT_ID=
ODSAY_API_KEY=
SEOUL_SUBWAY_API_KEY=
```

## Environment Variables

`.env.example`를 기준으로 `.env.local` 또는 배포 환경변수에 설정합니다.

- `VITE_NAVER_MAP_CLIENT_ID`
  - 네이버 지도 JavaScript SDK 로드용 공개 키
- `ODSAY_API_KEY`
  - 대중교통 경로 검색
  - 버스 실시간 도착 정보
- `SEOUL_SUBWAY_API_KEY`
  - 서울 지하철 실시간 도착 정보

## Deployment

이 프로젝트는 GitHub + Vercel 배포를 기준으로 정리되어 있습니다.

### 1. GitHub에 업로드

```bash
git init
git add .
git commit -m "Initial deployable version"
git branch -M main
git remote add origin <YOUR_GITHUB_REPOSITORY_URL>
git push -u origin main
```

주의:

- `.env.local`은 커밋하지 않습니다.
- `dist/`는 커밋하지 않습니다.

### 2. Vercel 연결

1. Vercel에서 `New Project`
2. GitHub 저장소 연결
3. Framework는 Vite로 감지되면 그대로 진행
4. Build Command: `npm run build`
5. Output Directory: `dist`

### 3. Vercel 환경변수 등록

Vercel 프로젝트 설정의 Environment Variables에 아래를 추가합니다.

```env
VITE_NAVER_MAP_CLIENT_ID=
ODSAY_API_KEY=
SEOUL_SUBWAY_API_KEY=
```

### 4. 배포 구조

로컬 개발에서는 `vite.config.ts` 프록시를 사용하고,
배포 환경에서는 `api/` 서버 함수가 같은 로직을 사용합니다.

사용 중인 엔드포인트:

- `/api/transit-routes`
- `/api/seoul-bus-arrivals`
- `/api/seoul-subway-arrivals`

공용 서버 로직은 `server/transitApi.ts`에 있습니다.

## Project Structure

```text
src/
  features/
  map/
  types/
api/
  transit-routes.ts
  seoul-bus-arrivals.ts
  seoul-subway-arrivals.ts
server/
  transitApi.ts
```

## Notes

- 버스 실시간 정보는 현재 ODsay 제공 범위에 따라 일부 지역 노선이 제한될 수 있습니다.
- 지하철 실시간 정보는 서울 열린데이터광장 API 기준으로 동작합니다.
