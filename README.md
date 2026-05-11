# CJ대한통운 글로벌 LMD 역량 비교

협업 편집 가능한 단일 페이지. 6개국(한국·베트남·대만·미국·일본·중국) 21개 지표 역량을 탭으로 전환하며 비교.

## 구조

```
.
├── index.html          # 메인 (6개 섹션 + 탭 네비 통합)
├── shared/
│   ├── editor.js       # 셀 편집/저장/육각형 자동 갱신
│   └── editor.css      # 편집 영역 표시
├── api/
│   └── data.js         # Vercel KV 백엔드 (GET/POST)
├── build_index.ps1     # 원본 6파일 → index.html 빌드
├── package.json
├── vercel.json
└── cj_*_1page*.html    # 원본 (참고용, 배포 안 됨)
```

## 작동 방식

- **편집**: 모든 셀이 contenteditable. 클릭하면 바로 수정 가능.
- **점수 (1~5)**: 입력 시 색상 자동 변경 + 하단 육각형 SVG 좌표 자동 갱신.
- **CJ대한통운 데이터 동기화**: 어느 탭에서 CJ 점수/내용을 바꾸든 다른 5개 탭의 CJ 컬럼도 즉시 반영.
- **저장**: blur 시 자동 저장. localStorage(즉시) + Vercel KV(서버) 양쪽으로.
- **다중 사용자**: 5초마다 서버에서 변경분 풀링. 다른 사용자 수정이 5초 내 자기 화면에 반영됨.
- **인증 없음**: URL 아는 누구나 수정 가능 (사내 공유용).

## 데이터 네임스페이스

| 키 | 내용 | 적용 범위 |
|---|---|---|
| `shared` | CJ대한통운 데이터 (21개 점수·내용, 지표명, 축명) | 6개 탭 모두 |
| `page:korea` | 한국 탭 고유 (시장 stats, 인사이트, 출처) | 한국 탭만 |
| `page:vietnam` | 베트남 탭 고유 (시장 stats, Viettel·SPX 점수/내용 등) | 베트남 탭만 |
| `page:taiwan` 등 | 동일 패턴 | 각 탭만 |

## Vercel 배포

### 1) GitHub 푸시

```powershell
cd C:\Users\User\cj-lmd-report
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

### 2) Vercel 프로젝트 생성

1. https://vercel.com 로그인
2. **Add New → Project** → GitHub 저장소 선택 → Import
3. Framework Preset: **Other** (정적 + Serverless 자동 인식)
4. Deploy

### 3) Vercel KV 연결

1. 배포 후 프로젝트 대시보드 → **Storage** 탭
2. **Create Database** → **KV** 선택
3. 데이터베이스 생성 후 **Connect Project** → 현재 프로젝트 선택
4. 환경변수 (`KV_REST_API_URL`, `KV_REST_API_TOKEN` 등) 자동 주입됨
5. 자동 재배포 후 동작

### 4) 사용

배포 URL을 사내에 공유. 인증 없이 누구나 편집 가능.

## 로컬 개발

```powershell
# Vercel CLI 설치 (한 번만)
npm i -g vercel

# 의존성 설치
npm install

# 로컬 dev 서버 (KV 환경변수는 vercel link 이후 자동)
vercel link    # 첫 실행 시
vercel env pull
npm run dev
```

`vercel dev` 없이 그냥 `index.html`을 브라우저로 열어도 작동 (단, localStorage만 사용 → 사용자 간 공유 X).

## 원본 → index.html 재빌드

원본 6개 HTML 파일 내용을 갱신하고 index.html을 다시 만들고 싶을 때:

```powershell
powershell -ExecutionPolicy Bypass -File .\build_index.ps1
```

## 키보드 단축키

- `Ctrl+Shift+R`: 현재 탭의 로컬 캐시 초기화 (서버 데이터는 유지)
- `Enter` (점수 셀에서): 포커스 해제 + 저장

## 점수 변경 시 자동 갱신

각 탭 하단 6축 육각형 (라스트마일 역량 비교):
- 한국 탭: CJ대한통운 1개 폴리곤
- 비교 탭 (베트남·대만·미국·일본·중국): CJ(골드) + 경쟁사1(네이비) + 경쟁사2(다크레드) 3개 폴리곤

축 평균은 21개 점수를 6축으로 그룹핑(인프라 4 / 자동화 3 / 시장재무 5 / 운영 4 / 사업서비스 2 / 고객 3)하여 자동 계산.
