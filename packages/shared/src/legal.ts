/**
 * 고지 문구 — 단일 원천. 문구는 docs/STEAM_COMPLIANCE.md §7과 글자 그대로 같아야 한다.
 * 웹 정보 패널과 (앞으로) 데스크톱 앱 정보 창이 같이 쓴다.
 */
export const LEGAL_NOTICE = {
  ko: '이 서비스는 Valve Corporation과 관련이 없으며, Valve나 Steam의 후원·보증을 받지 않습니다. Steam Web API를 사용합니다. Steam 데이터는 있는 그대로 제공되며 정확성을 보장하지 않습니다. 게임 이미지와 이름의 권리는 각 권리자에게 있습니다. Steam과 Steam 로고는 미국 및 기타 국가에서 Valve Corporation의 상표 및/또는 등록상표입니다.',
  en: 'Not affiliated with or endorsed by Valve Corporation. Uses the Steam Web API. Steam data is provided as is. Game images and names belong to their respective owners. Steam and the Steam logo are trademarks and/or registered trademarks of Valve Corporation in the U.S. and/or other countries.',
} as const;

export const DATA_SOURCES: { name: string; url: string; what: string }[] = [
  { name: 'Steam Web API', url: 'https://steamcommunity.com/dev', what: '보유 게임·플레이 시간·업적 수·친구 (공개 프로필만)' },
  { name: 'Steam 상점', url: 'https://store.steampowered.com/', what: '회사·장르·태그·출시년도·가격·게임 이미지' },
  { name: 'SteamSpy', url: 'https://steamspy.com/', what: '상점 태그가 없는 게임의 태그 (표본 추정치)' },
];
