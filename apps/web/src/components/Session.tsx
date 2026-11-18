import { useEffect, useState } from 'react';

/**
 * Valve가 제3자 사이트용으로 제공하는 "Sign in through Steam" 버튼 이미지.
 * Steam 로그인 페이지로 가는 링크에만 쓰고, 그림은 고치지 않는다 (Steamworks 인증 문서 · STEAM_COMPLIANCE A2)
 */
const SIGN_IN_IMAGE = 'https://shared.akamai.steamstatic.com/community_assets/images/steamworks_docs/english/sits_small.png';

export function SignInThroughSteam() {
  return (
    <a href="/api/auth/steam/login" title="Steam으로 로그인 — 비밀번호는 Steam 페이지에만 입력됩니다" className="shrink-0 opacity-90 transition hover:opacity-100">
      <img src={SIGN_IN_IMAGE} alt="Sign in through Steam" />
    </a>
  );
}

export interface Me {
  steamid: string;
  name?: string;
}

const LOGIN_ERROR_TEXT: Record<string, string> = {
  cancel: 'Steam 로그인을 취소했습니다',
  state: '로그인 요청이 만료되었거나 다른 창에서 시작되었습니다. 다시 시도해 주세요',
  verify: 'Steam이 로그인을 확인해 주지 않았습니다. 다시 시도해 주세요',
  'verify-unreachable': 'Steam에 연결하지 못해 로그인을 확인하지 못했습니다',
};

/** 로그인 상태 + Steam에서 돌아올 때 붙은 실패 이유(?login=…) */
export function useSession(demo: boolean) {
  const [me, setMe] = useState<Me | null>(null);
  const [loginError, setLoginError] = useState<string | null>(() => {
    const reason = new URLSearchParams(window.location.search).get('login');
    return reason ? (LOGIN_ERROR_TEXT[reason] ?? 'Steam 로그인에 실패했습니다') : null;
  });

  useEffect(() => {
    // 주소창에서 실패 이유를 지운다 (새로고침해도 다시 뜨지 않게)
    if (window.location.search.includes('login=')) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  useEffect(() => {
    if (demo) return setMe(null);
    fetch('/api/auth/me')
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, [demo]);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.reload();
  };

  return { me, loginError, dismissLoginError: () => setLoginError(null), logout };
}
