# Steamverse 기획서 (v0.3 — Steam API 전면 활용)

> Steam이 제공하는 거의 모든 공개 데이터(라이브러리·플레이·업적·스탯·프로필·배지·친구·그룹·위시리스트·가격·뉴스·차트·동시접속자·스크린샷·워크숍·연간 회고)를 모아, 게임·회사·태그·사람 사이의 관계를 **온톨로지(지식 그래프)** 와 다양한 시각화로 탐색하는 **PC 브라우저용 웹앱**
>
> 데스크톱 화면 우선 (최소 너비 1280px 기준 설계)

---

## 1. 한 줄 정의와 목표

**"내 스팀 인생 전체를 하나의 지식 그래프로."**

| 목표 | 설명 |
|---|---|
| 라이브러리 이해 | 보유·플레이·백로그·플랫폼(Deck 포함)·가치를 한눈에 |
| 관계 탐색 | 게임 ↔ 개발사·퍼블리셔·프랜차이즈·태그·친구·그룹을 그래프에서 클릭으로 확장 |
| 시간 복원 | 업적 해금 시각, 친구 맺은 날, 연간 회고, 일일 스냅샷으로 **과거 활동까지 재구성** |
| 맥락 비교 | 전 세계 업적 달성률, 동시접속자, 인기 차트와 내 라이브러리를 비교 |
| 취향 발견 | 장르·태그·회사·플레이 패턴으로 "게이머 페르소나" 도출 |
| 데이터 통제 | RDF/JSON-LD/CSV 내보내기, 계정 삭제 시 즉시 파기 |

**비목표**: 게임 실행·설치 관리, 거래·마켓 자동화, 다른 플랫폼(Epic, GOG) 통합

---

## 2. Steam API 활용 지도

### 2.0 등급 기준

| 표시 | 의미 |
|---|---|
| ✅ | 공식 문서가 있는 Web API. 서버 API 키로 호출 |
| ⚠️ | 동작하지만 공식 문서가 없거나 부실. **PoC에서 응답 형식·접근 조건 검증 필수**. 변경 위험 있음 |
| 🌐 | 스토어/커뮤니티 웹 JSON 엔드포인트 (비공식, 요청 제한 엄격) |
| ⛔ | 사용자 로그인 토큰(access token)이 필요하거나 키 소유자 본인만 가능 → **사용하지 않음** |

> 비공식 엔드포인트 목록 참고: steamapi.xpaw.me (커뮤니티가 정리한 Steam Web API 전체 목록)

### 2.1 사용자 · 프로필 · 성장

| 엔드포인트 | 등급 | 가져오는 데이터 | 활용 |
|---|---|---|---|
| `ISteamUser/ResolveVanityURL` | ✅ | 커스텀 URL → SteamID64 | 로그인 없이 프로필 URL로 조회 |
| `ISteamUser/GetPlayerSummaries` | ✅ | 닉네임, 아바타, **계정 생성일(timecreated)**, 국가, 접속 상태, **현재 플레이 중인 게임**, 대표 그룹, 공개 상태 | 프로필 카드, 계정 나이, "지금 하는 중" 표시, 공개 상태 감지 |
| `IPlayerService/GetSteamLevel` | ✅ | 레벨 | 성장 지표 |
| `IPlayerService/GetBadges` | ✅ | 배지 목록(appid 연결, 레벨, 획득일), XP, 다음 레벨까지 XP | 배지 ↔ 게임 관계, 성장 타임라인 |
| `IPlayerService/GetCommunityBadgeProgress` | ✅ | 커뮤니티 배지 퀘스트 진행도 | 프로필 완성도 |
| `IPlayerService/GetSteamLevelDistribution` | ⚠️ | 레벨 백분위 | "레벨 상위 N%" |
| `IPlayerService/GetFavoriteBadge` | ⚠️ | 대표 배지 | 프로필 카드 |
| `IPlayerService/GetProfileItemsEquipped` | ⚠️ | 프로필 배경, 아바타 프레임, 미니 프로필 | 프로필 카드 꾸미기 재현 |
| `ISteamUser/GetPlayerBans` | ✅ | VAC/게임/커뮤니티/거래 제재 여부, 마지막 제재 후 일수 | **본인 화면에만** 계정 상태로 표시 (친구 정보로는 노출 안 함) |

### 2.2 라이브러리 · 플레이

| 엔드포인트 | 등급 | 가져오는 데이터 | 활용 |
|---|---|---|---|
| `IPlayerService/GetOwnedGames` | ✅ | 보유 게임, 누적·최근 2주 플레이 시간, **플랫폼별(Win/Mac/Linux/Deck) 플레이 시간**, 마지막 플레이 시각. `include_appinfo`, `include_played_free_games`, `include_free_sub`, `include_extended_appinfo`(DLC·워크숍·마켓 보유 여부, 콘텐츠 등급) 옵션 사용 | 라이브러리의 뼈대 |
| `IPlayerService/GetRecentlyPlayedGames` | ✅ | 최근 2주 플레이 | "요즘 나" 섹션 |
| `ISaleFeatureService/GetUserYearInReview` | ⚠️ | 연도별 회고 데이터(월별·게임별 플레이 비중 등) | **과거 플레이 이력 복원**. 사용자가 회고를 공개했을 때만 조회될 가능성 큼 |
| `IFamilyGroupsService/*` (가족 공유 라이브러리) | ⛔ | | 제외 |
| `IPlayerService/ClientGetLastPlayedTimes` | ⛔ | | 제외 (GetOwnedGames의 `rtime_last_played`로 대체) |

### 2.3 업적 · 게임 스탯

| 엔드포인트 | 등급 | 가져오는 데이터 | 활용 |
|---|---|---|---|
| `ISteamUserStats/GetSchemaForGame` | ✅ | 업적 목록·아이콘·설명, **게임 스탯 정의** | 업적·스탯 사전 (전 사용자 공유) |
| `ISteamUserStats/GetPlayerAchievements` | ✅ | 업적 달성 여부 + **해금 시각** | 해금 시각으로 **과거 활동 캘린더** 생성 |
| `ISteamUserStats/GetGlobalAchievementPercentagesForApp` | ✅ | 전 세계 달성률 | 희귀 업적, 희귀도 점수 |
| `ISteamUserStats/GetUserStatsForGame` | ✅ | 게임별 상세 스탯 (예: 킬 수, 플레이 횟수 — 게임이 공개한 것만) | 게임 상세 페이지의 "내 기록" |
| `ISteamUserStats/GetGlobalStatsForGame` | ✅ | 전 세계 누적 스탯 (개발사가 집계 허용한 항목만) | 내 기록 vs 전 세계 |
| `ISteamUserStats/GetNumberOfCurrentPlayers` | ✅ | 현재 동시접속자 | "아직 살아있는 게임" 판정 |
| `IPlayerService/GetAchievementsProgress` | ⚠️ | 여러 게임의 달성 수·전체 수·달성률을 **한 번에** | 1,000개 게임 업적 요약을 호출 몇 번으로 해결 |
| `IPlayerService/GetTopAchievementsForGames` | ⚠️ | 게임별 대표(희귀) 업적 | 업적 쇼케이스 |

### 2.4 게임 메타데이터 (공유 지식 베이스)

| 엔드포인트 | 등급 | 가져오는 데이터 | 활용 |
|---|---|---|---|
| `IStoreBrowseService/GetItems` | ⚠️ | 여러 게임 배치 조회. `data_request`로 **개발사·퍼블리셔·프랜차이즈**, 태그+가중치, 출시일, 플랫폼, **Steam Deck 호환 등급**, 리뷰 요약, 가격·할인, 지원 언어, 콘텐츠 등급, 스크린샷·트레일러, 이미지 에셋, 포함 항목, 외부 링크 | **메타데이터 1순위 소스** |
| `IStoreBrowseService/GetDLCForApps` | ⚠️ | 게임별 DLC 목록 | DLC 보유율 ("본편만 산 게임") |
| `IStoreBrowseService/GetStoreCategories` | ⚠️ | 카테고리 사전 | 싱글/멀티/협동/컨트롤러 지원 등 |
| `IStoreService/GetTagList` | ✅ | 태그 ID → 이름 (한국어) | 태그 사전 |
| `IStoreService/GetLocalizedNameForTags` | ✅ | 태그 다국어 이름 | 한/영 전환 |
| `IStoreService/GetAppList` | ✅ | **스팀 전체 앱 카탈로그** + 마지막 변경 시각 | 메타데이터 갱신 대상 판정, 판매 중단 게임 감지 |
| `store.steampowered.com/api/appdetails` | 🌐 | 장르, 카테고리, 메타크리틱, 권장 사양, 업적 수 | GetItems에 없는 항목 보조 (1개씩, 약 200건/5분) |
| `store.steampowered.com/appreviews/{appid}?json=1` | 🌐 | 리뷰 점수, 긍정/부정 수 | 평점 vs 내 플레이시간 분석 |

### 2.5 소셜

| 엔드포인트 | 등급 | 가져오는 데이터 | 활용 |
|---|---|---|---|
| `ISteamUser/GetFriendList` | ✅ | 친구 목록 + **친구 맺은 날** | 친구 그래프, 친구 타임라인 |
| `ISteamUser/GetUserGroupList` | ✅ | 가입한 그룹 | 그룹 노드 (공통 그룹 친구) |
| 친구 각각의 `GetOwnedGames` / `GetPlayerSummaries` | ✅ | 친구 라이브러리 (공개된 친구만) | 겹치는 게임, 친구 기반 추천, 친구 장르 분포 비교 |
| 친구 각각의 `GetPlayerAchievements` | ✅ | 같은 게임 업적 비교 | 1:1 업적 대결 |

### 2.6 위시리스트 · 가격

| 엔드포인트 | 등급 | 가져오는 데이터 | 활용 |
|---|---|---|---|
| `IWishlistService/GetWishlist` | ✅ | 찜 목록 + 추가 일자 + 우선순위 | 위시리스트 분석 |
| `IWishlistService/GetWishlistItemCount` | ✅ | 찜 개수 | KPI |
| GetItems의 가격·할인 정보 | ⚠️ | 현재 가격, 할인율 | **라이브러리 정가 총액**, "지금 할인 중인 찜" |

### 2.7 생태계 맥락 (전 세계 흐름)

| 엔드포인트 | 등급 | 가져오는 데이터 | 활용 |
|---|---|---|---|
| `ISteamChartsService/GetMostPlayedGames` | ⚠️ | 현재 가장 많이 플레이되는 게임 순위 | **메인스트림 지수** (내 게임 중 인기 차트 비율) |
| `ISteamChartsService/GetGamesByConcurrentPlayers` | ⚠️ | 동시접속자 순위 | |
| `ISteamChartsService/GetMostPlayedSteamDeckGames` | ⚠️ | Deck 인기 게임 | Deck 사용자 비교 |
| `ISteamChartsService/GetTopReleasesPages` | ⚠️ | 월별 인기 신작 | "올해 신작 중 내가 한 것" |
| `IStoreTopSellersService/GetWeeklyTopSellers` | ⚠️ | 주간 판매 순위 | 트렌드 비교 |
| `ISteamNews/GetNewsForApp` | ✅ | 게임 뉴스·패치 노트 | **내 게임 뉴스 피드** (많이 한 게임 위주) |

### 2.8 커뮤니티 콘텐츠

| 엔드포인트 | 등급 | 가져오는 데이터 | 활용 |
|---|---|---|---|
| `IPublishedFileService/GetUserFiles` | ⚠️ | 사용자가 공개한 **스크린샷**, 아트워크, 가이드, 워크숍 아이템 | 게임별 스크린샷 갤러리, 창작 활동 |
| `IPublishedFileService/QueryFiles` | ✅ | 게임별 인기 워크숍 아이템 | 워크숍 활성도 |
| `steamcommunity.com/inventory/{steamid}/{appid}/{contextid}` | 🌐 | 공개 인벤토리 (트레이딩 카드, 아이템) | 3단계 이후 선택 기능 |
| `steamcommunity.com/market/priceoverview` | 🌐 | 마켓 시세 | 요청 제한이 매우 엄격 → 선택 기능 |

### 2.9 사용하지 않는 것

| 대상 | 이유 |
|---|---|
| `IEconService` 거래 내역·제안 | API 키 소유자 본인 데이터만 가능 |
| `IFamilyGroupsService`, `ILoyaltyRewardsService`(포인트), `ICloudService` | 사용자 access token 필요 |
| `IStoreAppSimilarityService` | 토큰 필요 가능성 높음. 자체 유사도 계산으로 대체 |
| 퍼블리셔 전용 API (`ISteamMicroTxn`, `ISteamPublishedItemSearch` 등) | 파트너 키 필요 |

### 2.10 Steam이 주지 않는 정보와 우회 방법

| 없는 정보 | 우회 |
|---|---|
| 구매일 | 없음. 대신 첫 업적 해금 시각을 "처음 플레이한 시점"의 근삿값으로 사용 |
| 과거 플레이 시간 추이 | ① 일일 스냅샷 ② 연간 회고(⚠️) ③ 업적 해금 시각 기반 활동 캘린더 |
| 세션 단위 플레이 기록 | 없음. 스냅샷 간 차이로 "그날 몇 시간"까지만 추정 |
| 내가 쓴 리뷰 | 공식 API 없음 → 범위 밖 |

---

## 3. 기능 모듈

데이터 영역별로 9개 모듈로 나눕니다. 모두 같은 온톨로지 그래프에 연결됩니다.

| 모듈 | 핵심 화면 | 주요 데이터 |
|---|---|---|
| **M1. 라이브러리** | 대시보드, 라이브러리 표, 백로그 | OwnedGames, RecentlyPlayed |
| **M2. 게임 지식** | 게임/회사/프랜차이즈/태그 상세 | GetItems, TagList, appdetails, DLC |
| **M3. 업적·스탯** | 업적 대시보드, 희귀 업적 쇼케이스, 게임별 스탯 | Achievements, Schema, GlobalPercentages, UserStats |
| **M4. 프로필·성장** | 프로필 카드, 레벨·배지 성장, 계정 연대기 | Summaries, Level, Badges, Bans(본인만) |
| **M5. 소셜** | 친구 네트워크, 친구 비교, 그룹 | FriendList, GroupList, 친구 라이브러리 |
| **M6. 위시리스트·가치** | 찜 분석, 할인 알림 표시, 라이브러리 가치 | Wishlist, 가격 |
| **M7. 생태계 맥락** | 인기 차트 대비 나, 살아있는 게임, 뉴스 피드 | Charts, CurrentPlayers, News |
| **M8. 시간 여행** | 연간 회고, 활동 캘린더, 플레이 추이 | 스냅샷, YearInReview, 업적 해금 시각 |
| **M9. 커뮤니티 콘텐츠** | 스크린샷 갤러리, 워크숍 | PublishedFile |

---

## 4. 온톨로지 설계

### 4.1 클래스

```
Agent
 ├─ Player ─────────── 나, 친구
 ├─ Organization
 │   ├─ Developer
 │   └─ Publisher       (역할은 관계로 구분, 한 회사가 둘 다 가능)
 └─ Group ──────────── 스팀 그룹
CreativeWork
 ├─ Game
 ├─ DLC
 ├─ Franchise
 ├─ NewsItem
 └─ UserContent
     ├─ Screenshot
     └─ WorkshopItem
Classification
 ├─ Genre / Tag / Category / ContentDescriptor
 ├─ Language
 ├─ Platform ───────── Windows / macOS / Linux / Steam Deck
 └─ DeckCompatibility ─ Verified / Playable / Unsupported
Progress
 ├─ Achievement ────── (게임 소속, 전 세계 달성률)
 ├─ GameStat ───────── (게임 소속 스탯 정의)
 ├─ Badge
 └─ SteamLevel
Event (시간이 있는 노드)
 ├─ Ownership ──────── Player–Game, 플레이 시간 속성
 ├─ PlaytimeSnapshot
 ├─ AchievementUnlock
 ├─ Friendship ─────── 친구 맺은 날
 ├─ WishlistEntry ──── 추가 일자, 우선순위
 └─ YearInReview
Market
 ├─ PricePoint ─────── 날짜별 가격·할인
 └─ ChartRanking ───── 날짜별 차트 순위, 동시접속자
```

### 4.2 관계

| 관계 | 도메인 → 범위 | 속성 |
|---|---|---|
| `owns` | Player → Ownership → Game | playtime(전체/2주/플랫폼별), lastPlayed |
| `wishlisted` | Player → WishlistEntry → Game | addedAt, priority |
| `developedBy` / `publishedBy` | Game → Organization | |
| `partOfFranchise` | Game → Franchise | |
| `hasDLC` | Game → DLC | |
| `ownsDLC` | Player → DLC | |
| `hasGenre` / `hasTag` / `hasCategory` | Game → Classification | 태그는 `weight` |
| `supportsLanguage` | Game → Language | 인터페이스/음성/자막 |
| `deckCompatibility` | Game → DeckCompatibility | |
| `hasAchievement` / `hasStat` | Game → Achievement / GameStat | globalPercent |
| `unlocked` | Player → AchievementUnlock → Achievement | unlockedAt |
| `statValue` | Player → GameStat | value |
| `earnedBadge` | Player → Badge (→ Game) | level, earnedAt |
| `friendOf` | Player ↔ Friendship ↔ Player | since |
| `memberOf` | Player → Group | |
| `currentlyPlaying` | Player → Game | 조회 시점 |
| `hasNews` | Game → NewsItem | date |
| `created` | Player → Screenshot/WorkshopItem → Game | |
| `rankedIn` | Game → ChartRanking | rank, concurrent, date |
| `pricedAt` | Game → PricePoint | price, discount, date |

### 4.3 추론(파생) 규칙

그래프에서는 점선 등 다른 스타일로 원본 데이터와 구분해 보여줍니다.

| 파생 개념 | 규칙 |
|---|---|
| `Backlog` / `Tried` / `Played` / `Favorite` | 플레이 0분 / 2시간 미만 / 그 이상 / 상위 5% 또는 100시간 이상 |
| `Completed` | 업적 100% |
| `Dormant` | 많이 했지만 마지막 플레이가 1년 이상 전 |
| `DeadGame` | 현재 동시접속자가 임계값(예: 10명) 미만 |
| `RareHunter` 점수 | 해금한 업적의 (1 − 전 세계 달성률) 합 |
| `MainstreamIndex` | 플레이 시간 기준 인기 차트 상위 100 게임 비중 |
| `favoriteDeveloper` / `favoriteFranchise` | 플레이 시간 합 상위 N |
| `similarTo` | 태그 가중치 벡터 코사인 유사도 + 같은 개발사/프랜차이즈 가산점 |
| `friendRecommends` | 친구 다수가 오래 했고 나는 보유하지 않았거나 미플레이 |
| `firstPlayedApprox` | 해당 게임 첫 업적 해금 시각 |
| `GamerPersona` | 위 지표 조합: "업적 사냥꾼", "백로그 수집가", "한 우물 장인", "인디 탐험가", "멀티플레이 사교가", "Deck 유목민" 등 |

### 4.4 엔티티 정규화

| 대상 | 방법 |
|---|---|
| 회사 이름 변형 (`Valve` / `Valve Corporation`) | 법인 접미사 제거 후 일치 → GetItems가 주는 크리에이터 ID로 병합 → 수동 병합 UI |
| 프랜차이즈 | GetItems의 franchise 정보 우선, 없으면 수동 |
| 태그/장르 중복 (예: 태그 "RPG"와 장르 "RPG") | 매핑 테이블로 `sameAs` 연결 |

### 4.5 표준 포맷

- 네임스페이스 `sv:` 정의, schema.org 매핑 (`schema:VideoGame`, `schema:Organization`, `schema:Person`, `schema:author`, `schema:publisher`, `schema:genre`, `schema:inLanguage`)
- 공유 메타데이터는 공용 named graph, 사용자 데이터는 사용자별 named graph
- 내보내기: Turtle, JSON-LD, GraphML(Gephi용), CSV

---

## 5. 시각화

| # | 뷰 | 형태 | 답하는 질문 | 모듈 |
|---|---|---|---|---|
| 1 | 대시보드 | KPI 카드 + Top 10 | 전체 현황 | M1 |
| 2 | **지식 그래프 탐색기** | WebGL 포스 그래프, 클릭으로 확장, 노드 유형 필터 | 무엇이 무엇과 연결돼 있나 | 전체 |
| 3 | 트리맵 | 장르 → 개발사 → 게임 (면적 = 플레이 시간) | 내 시간은 어디에 | M1·M2 |
| 4 | 선버스트 | 퍼블리셔 → 개발사 → 프랜차이즈 → 게임 | 회사 계층별 비중 | M2 |
| 5 | 생키 | 퍼블리셔 → 장르 → 플레이 구간 | 어느 회사 게임을 사고 안 하나 | M1·M2 |
| 6 | 파레토 | 게임별 누적 플레이 비율 | 상위 몇 개가 시간 대부분인가 | M1 |
| 7 | 히트맵 | 출시 연도 × 장르 | 선호 시대·장르 | M2 |
| 8 | 산점도 | 리뷰 점수 × 내 플레이 시간 | 평단과 내 취향의 차이 | M2 |
| 9 | 플랫폼 도넛 + Deck 호환 막대 | Win/Mac/Linux/Deck 플레이 비중 | Deck을 얼마나 쓰나 | M1·M2 |
| 10 | **업적 활동 캘린더** | GitHub 잔디 형태 (업적 해금 시각) | 언제 열심히 했나 (과거 포함) | M3·M8 |
| 11 | 희귀 업적 쇼케이스 | 카드 갤러리 (달성률 낮은 순) | 자랑할 만한 업적 | M3 |
| 12 | 업적 완료율 분포 | 히스토그램 + 게임별 진행 바 | 끝까지 한 게임은 | M3 |
| 13 | 게임 스탯 비교 | 막대 (내 값 vs 전 세계) | 이 게임에서 나는 어느 정도 | M3 |
| 14 | **계정 연대기** | 가로 타임라인: 계정 생성, 친구 맺은 날, 배지, 첫 업적, 레벨업 | 내 스팀 역사 | M4·M8 |
| 15 | 레벨·배지 성장 | 배지 그리드 + 레벨 백분위 게이지 | 프로필 성장 | M4 |
| 16 | **친구 네트워크** | 나–친구–게임 이분 그래프, 친구 맺은 연도별 색 | 누구와 무엇을 공유하나 | M5 |
| 17 | 친구 비교 | 레이더(장르 분포) + 공통 게임 벤 다이어그램 | 친구와 취향 차이 | M5 |
| 18 | 위시리스트 분석 | 태그 분포 + 가격·할인 표 | 무엇을 사고 싶어 하나, 지금 싼 것 | M6 |
| 19 | 라이브러리 가치 | 정가 총액, 장르별 금액 트리맵 | 내 라이브러리의 값어치 | M6 |
| 20 | 메인스트림 지수 | 게이지 + 인기 차트와의 겹침 목록 | 나는 대세파인가 | M7 |
| 21 | 살아있는 라이브러리 | 버블 (크기 = 현재 동시접속, 색 = 내 플레이) | 지금 해도 사람 있는 게임 | M7 |
| 22 | 뉴스 피드 | 내 상위 게임 뉴스·패치 노트 목록 | 내 게임 소식 | M7 |
| 23 | 연간 회고 | 월별 누적 영역 차트 | 올해 무엇을 했나 | M8 |
| 24 | 플레이 추이 | 스냅샷 기반 일별 플레이 | 최근 흐름 | M8 |
| 25 | 스크린샷 갤러리 | 게임별 메이슨리 그리드 | 내가 남긴 장면 | M9 |
| 26 | **게이머 페르소나 카드** | 공유용 이미지 카드 | 나는 어떤 게이머인가 | 전체 |

### 지식 그래프 탐색기 와이어프레임

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [검색: 게임/회사/태그/친구…]  노드: ☑게임 ☑회사 ☐태그 ☐장르 ☑친구 ☐그룹  │
├────────────┬─────────────────────────────────────────────┬───────────────┤
│ 필터       │                                             │ 상세 패널     │
│ 플레이시간 │      (Valve)━━━━ Half-Life 2 ┄┄┄ [similar]  │ ▣ Valve       │
│ ▭▭▭▭▬▬▬   │        ┃   ╲                                │ 유형: 개발사  │
│ 출시연도   │     Portal 2   Counter-Strike 2 ●live 1.2M  │ 보유 14 · 미플│
│ ▭▭▬▬▬▬▬   │        ┆            ┃      ╲                 │ 레이 3        │
│ 상태       │    (Puzzle)       (FPS)   (친구: A, B)      │ 총 1,240시간  │
│ ☑백로그    │                                             │ 업적 평균 62% │
│ ☑완료      │  노드 크기 = 플레이 시간                    │ 최근 뉴스 2건 │
│ ☑Deck 호환 │  점선 = 추론 관계 · ● = 현재 동시접속       │ [관련 펼치기] │
│ 레이아웃   │                                             │ [이 노드만]   │
│ ◉포스 ○방사│                                             │               │
├────────────┴─────────────────────────────────────────────┴───────────────┤
│ 노드 312 · 엣지 1,048 · 마지막 동기화 5분 전                  [내보내기] │
└──────────────────────────────────────────────────────────────────────────┘
```

전체를 한 번에 그리지 않고 회사·장르 단위 요약 그래프에서 시작해 클릭으로 펼치는 방식이 기본입니다.

---

## 6. 화면 구성 (IA)

```
랜딩 (소개 + 예시 그래프 데모)
온보딩 (Steam 로그인 또는 프로필 URL → 공개 설정 확인 → 첫 동기화 진행률)
└─ 메인
   ├─ 홈 대시보드
   ├─ 라이브러리 (표/그리드, 정렬·필터·검색, 백로그)
   ├─ 그래프 탐색기
   ├─ 분석 (트리맵·선버스트·생키·히트맵·산점도·플랫폼)
   ├─ 업적 (캘린더·쇼케이스·완료율)
   ├─ 시간 여행 (계정 연대기·연간 회고·플레이 추이)
   ├─ 친구 (네트워크·비교·그룹)
   ├─ 위시리스트·가치
   ├─ 세계 속의 나 (메인스트림 지수·살아있는 게임·뉴스)
   ├─ 갤러리 (스크린샷·워크숍)
   ├─ 질의 (쿼리 빌더 → SPARQL 편집기)
   ├─ 상세: 게임 / 회사 / 프랜차이즈 / 태그 / 친구
   └─ 설정 (동기화, 언어, 테마, 내보내기, 공개 프로필 링크, 계정·데이터 삭제)
공개 프로필 (/u/:id) — 사용자가 켠 경우에만, 페르소나 카드·요약 그래프
```

---

## 7. 기술 구조

### 7.1 권장 스택 — TypeScript 풀스택

| 영역 | 선택 | 이유 |
|---|---|---|
| 프론트엔드 | React + TypeScript + Vite (SPA) | 로그인 후 쓰는 대시보드형 앱, SSR 불필요 |
| 그래프 렌더링 (2D) | Sigma.js v3 + graphology (WebGL) + `@sigma/node-image`, `@sigma/edge-curve` | 수천 노드도 부드러움, 게임 이미지 노드·곡선 엣지, ForceAtlas2를 Web Worker로 |
| 그래프 렌더링 (3D) | react-force-graph-3d (three.js) | "우주 뷰" 전용 쇼케이스 |
| 차트 | Apache ECharts + 자체 테마 | 트리맵·선버스트·생키·히트맵·캘린더 모두 지원, 대용량에 강함 |
| 맞춤 시각화 | D3 (계산만) + React SVG | 계정 연대기 등 정형 차트로 안 되는 화면 |
| UI | Tailwind CSS + shadcn/ui + Motion | 일관된 디자인 시스템, 화면 전환·노드 확장 애니메이션 |
| 폰트 | Pretendard | 한글 가독성 |
| 상태/페칭 | TanStack Query + Zustand | |
| 백엔드 API | Node.js + Fastify | |
| ORM | Drizzle ORM | |
| DB | PostgreSQL | 공유 메타데이터 + 사용자별 데이터, 원본 응답은 JSONB로 보관 |
| 작업 큐 | pg-boss | 큐·재시도·cron을 Postgres 하나로 |
| 로그인 | Steam OpenID 2.0 + HttpOnly 세션 쿠키 | |
| RDF | `n3`, `jsonld` | 내보내기 |
| SPARQL | Oxigraph | 3단계 |
| 이미지 카드 | Satori + resvg | 페르소나 카드 PNG 생성 |

### 7.1.1 TypeScript 스택에서 온톨로지 구현

온톨로지를 세 계층으로 나누면 이 스택으로 충분합니다.

| 계층 | 담당 | 구현 |
|---|---|---|
| **정의** | 클래스·관계·라벨(한/영)·색·모양·아이콘·RDF IRI | `packages/shared/ontology.ts` **한 파일이 단일 원천**. 여기서 API 타입, 그래프 스타일, 범례·필터 UI, RDF 어휘(.ttl)를 모두 생성 |
| **저장·질의** | 사실 데이터, 2~3단계 관계 탐색, 파생 규칙 | PostgreSQL (조인, 재귀 CTE, 머티리얼라이즈드 뷰). 관계 탐색이 복잡해지면 Apache AGE 확장(Postgres 안에서 Cypher)을 검토 |
| **의미 웹 호환** | RDF 내보내기, SPARQL, 검증 | `n3`, `jsonld`, `oxigraph`(npm, WASM), SHACL 검증은 `rdf-validate-shacl` |

**한계**: OWL DL 자동 추론기(HermiT, Pellet 등)는 JS 쪽에 쓸 만한 것이 없습니다. 하지만 이 앱의 추론 규칙(4.3)은 임계값·집계·유사도 계산이라 OWL 추론기보다 SQL·TS 코드가 더 적합합니다. 나중에 정식 OWL 추론이 필요해지면 Python(owlready2) 마이크로서비스를 붙이면 됩니다.

### 7.1.2 비주얼 원칙

| 원칙 | 내용 |
|---|---|
| **클래스 = 시각 언어** | 온톨로지 클래스마다 색·모양·아이콘을 고정하고 그래프·차트·범례·상세 페이지 전체에서 똑같이 사용. 예: 게임=게임 이미지 원형, 개발사=육각형, 퍼블리셔=다이아몬드, 태그=작은 점, 친구=아바타 |
| **게임 아트 활용** | GetItems의 이미지 에셋(캡슐, 라이브러리 히어로, 로고)을 노드·카드·상세 페이지 배경에 사용. 스팀 아트만으로도 화면 밀도가 크게 올라감 |
| **줌 단계별 표현** | 멀리서는 장르·회사 군집(색 영역), 가까이 가면 게임 이미지와 라벨, 더 가까이 가면 플레이 시간·업적 링 표시 |
| **관계 강조** | 마우스를 올리면 이웃만 밝게, 나머지는 흐리게. 클릭 시 이웃 노드가 애니메이션으로 펼쳐짐 |
| **원본과 추론 구분** | 원본 관계는 실선, 추론 관계(유사, 추천)는 점선·반투명 |
| **다크 테마 기본** | 게임 아트와 발광 효과가 잘 보이는 어두운 배경 + 라이트 테마 지원 |
| **"우주" 메타포** | 앱 이름에 맞춰 3D 우주 뷰 제공: 장르 = 은하, 게임 = 별(크기 = 플레이 시간, 밝기 = 최근 플레이), 친구 = 이웃 은하. 분석은 2D 탐색기, 감상·공유는 3D 뷰로 역할 분리 |

대안: 정식 OWL 추론이 핵심 요구가 되면 Python(FastAPI + rdflib/pyoxigraph + owlready2) 백엔드를 고려합니다.

### 7.2 구조

```
┌─────────────────── 브라우저 (React SPA) ─────────────────────┐
└──────────────▲──────────────────────────▲───────────────────┘
               │ REST/JSON                │ SSE (진행률·알림)
┌──────────────┴──────────── API 서버 (Fastify) ───────────────┐
│ Auth · Library · Graph · Achievements · Social · Market ·     │
│ Timeline · Query(SPARQL) · Export · PersonaCard               │
└──────────────┬────────────────────────────────────────────────┘
               │ 작업 등록
┌──────────────┴──────────── 워커 ──────────────────────────────┐
│ SteamClient   : 엔드포인트별 어댑터 + 요청 제한(토큰 버킷)     │
│                 + 응답 스키마 검증(zod) + 원본 JSONB 저장       │
│ 사용자 작업   : UserSync, AchievementSync, SocialSync, ...      │
│ 공유 작업     : MetadataSync, CatalogSync, ChartSync, NewsSync  │
│ 정기 작업     : DailySnapshot, PriceWatch, CurrentPlayers       │
│ OntologyBuild : 파생 규칙 계산, 그래프 캐시 갱신                │
└──────────────┬────────────────────────────────────────────────┘
               ▼
          PostgreSQL (+ 3단계: Oxigraph)
```

**원칙**
- **어댑터 격리**: ⚠️·🌐 엔드포인트는 하나씩 독립 어댑터로 만들고, 응답이 바뀌거나 막히면 해당 기능만 "일시 사용 불가"로 표시합니다. 앱 전체는 계속 동작합니다.
- **원본 보관**: 모든 응답을 JSONB로 저장해 두면, 나중에 쓰지 않던 필드를 활용할 때 다시 호출할 필요가 없습니다.
- **공유와 분리**: 게임·회사·태그·업적 정의·차트·뉴스는 전체 사용자가 공유하고, 보유·플레이·업적 해금·친구는 사용자별로 저장합니다.

### 7.3 동기화 전략

**변경 감지로 호출 줄이기**: 게임별 데이터(업적, 스탯)는 `playtime_forever`가 지난번보다 늘어난 게임만 다시 가져옵니다. 1,000개 게임을 가진 사용자도 평소에는 몇 개만 갱신하면 됩니다.

| 데이터 | 범위 | 주기 | 비고 |
|---|---|---|---|
| 보유 게임·플레이 | 사용자 | 매일 + 수동(쿨다운 10분) | 스냅샷 저장 |
| 최근 플레이·현재 플레이 | 사용자 | 접속 시 | |
| 업적·게임 스탯 | 사용자 | 플레이 시간 변동 시 | 첫 동기화는 GetAchievementsProgress(⚠️)로 요약부터 |
| 프로필·레벨·배지 | 사용자 | 매일 | |
| 친구·그룹 | 사용자 | 매일 | |
| 친구 라이브러리 | 사용자 | 친구 화면 열 때, 7일 캐시 | 호출이 많으므로 요청 시에만 |
| 위시리스트 | 사용자 | 매일 | |
| 연간 회고 | 사용자 | 연 1회 + 지난 연도 1회 | ⚠️ |
| 스크린샷·워크숍 | 사용자 | 주 1회 | ⚠️ |
| 게임 메타데이터 | 공유 | 카탈로그 변경 시각 기준, 최대 30일 | GetItems 배치 |
| 업적 정의·전 세계 달성률 | 공유 | 7일 | |
| 가격 | 공유 | 매일 (위시리스트·보유 게임만) | |
| 동시접속자 | 공유 | 매시간 (사용자들 상위 게임만) | |
| 차트·판매 순위 | 공유 | 매일 | |
| 뉴스 | 공유 | 6시간 (사용자들 상위 게임만) | |

**첫 동기화 순서** (먼저 볼 수 있는 것부터):

```
1. Summaries·Level            → 프로필 카드 즉시 표시
2. OwnedGames                 → 대시보드·라이브러리 표시
3. GetItems (공유 캐시 미적중분) → 그래프·트리맵 표시
4. AchievementsProgress       → 업적 요약
5. 친구·위시리스트·배지        → 각 화면 활성화
6. 게임별 업적 상세(해금 시각)  → 활동 캘린더 (백그라운드, 오래 걸림)
7. appdetails·리뷰 보조 수집    → 산점도 등 (백그라운드)
```

**호출량 관리**: Web API는 키당 하루 약 10만 건 제한(Steam Web API 약관)이 있습니다. 엔드포인트별 호출 수를 기록하는 대시보드를 두고, 한도의 70%에 도달하면 경보를 보내고 우선순위 낮은 작업(뉴스, 스크린샷)부터 멈춥니다. 사용자가 늘면 공유 캐시 적중률이 올라가므로 사용자 1인당 호출 수는 줄어듭니다.

### 7.4 배포

| 규모 | 구성 |
|---|---|
| 개인/소규모 | VPS 1대 + Docker Compose (Caddy + API + 워커 + Postgres) |
| 관리형 | 프론트: Cloudflare Pages / Vercel · API·워커: Fly.io / Railway · DB: Neon / Supabase |

### 7.5 PostgreSQL 스키마 초안

```sql
-- 계정
app_user(steamid PK, created_at, last_login_at, public_profile, deleted_at)
session(id PK, steamid, expires_at)
api_call_log(day, endpoint, count)
raw_response(id PK, endpoint, key, fetched_at, body JSONB)

-- 공유 지식 베이스
game(appid PK, name, type, release_date, review_score, review_count, metacritic,
     deck_compat, is_free, is_delisted, has_workshop, has_market,
     meta_fetched_at, catalog_modified_at)
organization(id PK, name, normalized_name, creator_id, merged_into)
game_org(appid, org_id, role)                 -- developer | publisher
franchise(id PK, name);          game_franchise(appid, franchise_id)
dlc(appid PK, parent_appid, name)
genre / tag / category / language / content_descriptor (id PK, name)
game_genre, game_tag(weight), game_category, game_language(kind), game_content_descriptor
achievement(appid, api_name, display_name, icon, hidden, global_percent, PK(appid, api_name))
game_stat(appid, name, display_name)
badge_def(badge_id, appid, level, name)
price_point(appid, date, price, discount_pct, currency)
chart_ranking(chart, date, rank, appid, concurrent)
current_players(appid, captured_at, count)
news_item(gid PK, appid, title, url, author, date, feed)

-- 사용자별
player(steamid PK, persona_name, avatar, country, time_created, level,
       level_percentile, xp, profile_visibility, updated_at)
ownership(steamid, appid, playtime_forever, playtime_2weeks,
          playtime_win, playtime_mac, playtime_linux, playtime_deck, last_played)
playtime_snapshot(steamid, appid, captured_on, minutes)
dlc_ownership(steamid, dlc_appid)
achievement_unlock(steamid, appid, api_name, unlocked_at)
achievement_progress(steamid, appid, unlocked, total)
user_stat(steamid, appid, name, value, captured_at)
player_badge(steamid, badge_id, appid, level, xp, earned_at)
friendship(steamid, friend_steamid, since)
group_membership(steamid, group_id)
wishlist_entry(steamid, appid, added_at, priority)
year_in_review(steamid, year, data JSONB)
user_content(steamid, file_id, kind, appid, title, preview_url, created_at)
player_ban(steamid, vac, game_bans, community, economy, days_since_last)  -- 본인 화면 전용
```

---

## 8. 개발 로드맵

| 단계 | 기간 (1인 기준 추정) | 내용 | 완료 기준 |
|---|---|---|---|
| **0. API 탐색** | 1~2주 | 2장의 **모든 엔드포인트를 내 계정으로 호출**하는 스크립트 작성 → 응답 샘플 저장, ⚠️ 항목의 동작 여부·접근 조건·요청 제한 실측 → "API 가용성 표" 확정 | 표의 모든 ⚠️가 ✅ 또는 ⛔로 결정됨 |
| **1. MVP** | 5~6주 | 모노레포(web/api/worker/shared), Steam 로그인, 스키마, 어댑터 구조, 동기화 워커 + 진행률, **M1·M2** (대시보드·라이브러리·그래프 탐색기·트리맵), 배포 | 처음 온 사람이 로그인 후 10분 안에 자기 그래프를 봄 |
| **2. 업적·시간** | 4주 | **M3·M8**: 업적 대시보드·희귀 업적·활동 캘린더·게임 스탯, 일일 스냅샷, 연간 회고, 계정 연대기 | 과거 활동이 캘린더에 보임 |
| **3. 사람·돈·세상** | 4주 | **M4·M5·M6·M7**: 프로필 성장, 친구 네트워크·비교, 위시리스트·가치, 메인스트림 지수·살아있는 게임·뉴스 | 시각화 20종 이상 |
| **4. 온톨로지 심화** | 3주 | 추론 규칙 전체, 엔티티 병합 UI, Oxigraph + SPARQL 편집기(예제 질의 포함), TTL/JSON-LD/GraphML 내보내기 | Protégé·Gephi에서 열림 |
| **5. 공유·확장** | 3주~ | **M9** 갤러리, 게이머 페르소나 카드, 공개 프로필 페이지, 유사 게임 추천, 자연어 질의(선택) | |

---

## 9. 차별화 포인트

1. **Steam 데이터 전체를 한 그래프로**: 라이브러리만 보는 기존 서비스와 달리 업적·배지·친구·그룹·위시리스트·뉴스·차트까지 같은 그래프에 연결
2. **잃어버린 시간 복원**: 업적 해금 시각 + 연간 회고 + 스냅샷으로 Steam이 보여주지 않는 과거 활동 재구성
3. **세상 속의 나**: 전 세계 달성률, 동시접속자, 인기 차트와 비교한 상대적 위치
4. **진짜 온톨로지**: RDF 내보내기와 SPARQL 질의가 가능한 개인 게임 지식 그래프
5. **설치 없이 링크 하나로**: 로그인만 하면 바로 쓰고, 페르소나 카드로 공유

---

## 10. 위험 요소

| 위험 | 영향 | 완화 |
|---|---|---|
| ⚠️·🌐 엔드포인트 변경·차단 | 일부 기능 중단 | 어댑터 격리, 기능별 상태 표시, 원본 JSONB 보관, 0단계에서 대체 경로 확보 |
| Web API 일일 한도 | 동기화 지연 | 변경 감지, 공유 캐시, 우선순위별 작업 중단, 호출량 경보 |
| 대형 라이브러리·많은 친구 | 첫 동기화가 김 | 단계별 표시, 친구 라이브러리는 요청 시에만 |
| 사용자 데이터 서버 저장 | 신뢰·법적 문제 | 최소 수집, 처리방침, 원클릭 삭제, 제재 정보는 본인만 |
| 친구 데이터 노출 | 친구 동의 없는 분석 | 친구 정보는 본인 화면에서만, 공개 프로필에는 집계만 표시 |
| SPARQL 남용 | 서버 과부하 | 읽기 전용, named graph 범위 제한, 타임아웃·결과 수 제한 |
| 상표 | 배포 시 문제 | 이름·로고에 Steam 상표를 쓰지 않음, "Steam 데이터를 사용함" 정도로만 표기 (Valve 가이드라인 확인) |

---

## 11. 결정이 필요한 사항

1. **공개 범위**: 누구나 가입하는 공개 서비스인가, 나와 지인만 쓰는 비공개 배포인가?
2. **백엔드 언어**: TypeScript(권장) 또는 Python
3. **친구 데이터 범위**: 친구 라이브러리까지 수집할 것인가? (호출량과 프라이버시 부담이 가장 큰 기능)
4. **인벤토리·마켓 기능**: 🌐 엔드포인트라 불안정함. 넣을 것인가?
5. **LLM 기능**: 자연어 질의·페르소나 설명문 생성을 넣을 것인가?
