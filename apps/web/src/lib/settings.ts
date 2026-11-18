import { useState } from 'react';

/**
 * 공개 빌드(웹 공개·앱 배포)인지. `VITE_PUBLIC_BUILD=1 npm run build` 로 켠다.
 * 공개 빌드에서는 개인용 옵션(탐사 뷰의 표지 행성)을 숨기고 끈다. (STEAM_COMPLIANCE C4)
 */
export const PUBLIC_BUILD = import.meta.env.VITE_PUBLIC_BUILD === '1';

export interface Settings {
  /** 게임 이미지 표시 (끄면 모든 화면이 대체 카드·점으로) */
  images: boolean;
  /** 탐사 뷰 행성을 게임 표지로 그리기 — 표지를 변형하므로 개인용, 기본 꺼짐 */
  voyageCoverArt: boolean;
}

const KEY = 'steamverse.settings';
const DEFAULTS: Settings = { images: true, voyageCoverArt: false };

function read(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return { ...DEFAULTS, ...raw };
  } catch {
    return DEFAULTS;
  }
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(read);
  const update = (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* 저장 못 해도 이번 화면에는 반영된다 */
      }
      return next;
    });
  };
  return [settings, update];
}

/** 이 앱이 브라우저에 남긴 것(설정·데이터 출처·탐사 기록) 전부 지우기 */
export function clearLocalData() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('steamverse.')) localStorage.removeItem(k);
  } catch {
    /* 접근이 막혀 있으면 지울 것도 없다 */
  }
}
