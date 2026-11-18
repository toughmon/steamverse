import { useEffect, useState } from 'react';
import { DATA_SOURCES, LEGAL_NOTICE } from '@steamverse/shared';
import { PUBLIC_BUILD, clearLocalData, type Settings } from '../lib/settings';
import { Toggle } from './Toggle';

interface Props {
  onClose: () => void;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  /** 시연 모드에서는 이미지가 항상 꺼져 있다 */
  demo: boolean;
}

/**
 * 정보 패널: 비제휴 고지, 데이터 출처, 개인정보 처리 요약, 이미지 설정, 내 데이터 지우기.
 * (STEAM_COMPLIANCE T6·P5·P6·P8·C4·C7) 고지 문구는 packages/shared/src/legal.ts 하나에서 온다.
 */
export function About({ onClose, settings, onSettings, demo }: Props) {
  const [erase, setErase] = useState<'idle' | 'confirm' | 'busy' | 'failed'>('idle');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const eraseAll = async () => {
    setErase('busy');
    try {
      // 서버 캐시(내 라이브러리·친구 정보). 계정이 없거나 서버가 꺼져 있으면 지울 서버 데이터도 없다
      const res = await fetch('/api/library', { method: 'DELETE' }).catch(() => null);
      if (res && !res.ok && res.status !== 400) throw new Error(String(res.status));
      clearLocalData();
      window.location.reload();
    } catch {
      setErase('failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="정보"
        className="sv-scroll max-h-full w-full max-w-[640px] overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#0a0c16] p-7 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="eyebrow">About</div>
            <h2 className="mt-1.5 text-[20px] font-semibold tracking-tight text-white">정보 · 데이터 · 설정</h2>
          </div>
          <button onClick={onClose} className="rounded-full px-2.5 py-1 text-[13px] text-white/45 hover:bg-white/[0.06] hover:text-white" aria-label="닫기">
            ✕
          </button>
        </div>

        <section className="mt-6">
          <h3 className="eyebrow mb-2">고지</h3>
          <p className="text-[12.5px] leading-relaxed text-white/70">{LEGAL_NOTICE.ko}</p>
          <p className="mt-2 text-[11.5px] leading-relaxed text-white/40">{LEGAL_NOTICE.en}</p>
        </section>

        <section className="mt-6">
          <h3 className="eyebrow mb-2">데이터 출처</h3>
          <ul className="flex flex-col gap-1.5 text-[12.5px]">
            {DATA_SOURCES.map((s) => (
              <li key={s.name} className="flex gap-3">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="w-[108px] shrink-0 text-sky-200/80 hover:text-sky-100">
                  {s.name}
                </a>
                <span className="text-white/55">{s.what}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-6">
          <h3 className="eyebrow mb-2">개인정보 처리</h3>
          <ul className="list-disc space-y-1 pl-4 text-[12.5px] leading-relaxed text-white/60">
            <li>Steam 공개 프로필 정보만 씁니다. 비공개로 설정된 정보는 받지 않고, 다른 방법으로 알아내지도 않습니다.</li>
            <li>친구 정보는 닉네임, 친구가 된 날, 나와 같이 가진 게임의 플레이 시간만 받고, 이 화면에서만 보여 줍니다.</li>
            <li>로그인은 Steam 로그인으로만 합니다. 비밀번호는 Steam 페이지에만 입력되고, 이 서비스는 SteamID만 받습니다.</li>
            <li>받은 정보는 서비스 서버 캐시에 저장되고, 20분이 지나거나 로그아웃하면 지워집니다. 누구에게도 제공하지 않습니다.</li>
            <li>로그인 유지에 쿠키 하나(sv_session, 30일)를 쓰며, 광고·추적에는 쓰지 않습니다.</li>
            <li>탐사 기록과 설정은 이 브라우저에만 저장됩니다.</li>
            <li>아래 버튼으로 언제든 모두 지울 수 있습니다.</li>
          </ul>
        </section>

        <section className="mt-6">
          <h3 className="eyebrow mb-2">이미지</h3>
          <div className="flex flex-col gap-1">
            <Toggle
              checked={settings.images && !demo}
              onChange={(v) => onSettings({ images: v })}
              label="게임 이미지 표시"
              hint={demo ? '시연 모드에서는 항상 꺼집니다' : '끄면 이미지 대신 색 카드로 보여 줍니다'}
              color="#8ab4ff"
            />
            {!PUBLIC_BUILD && (
              <Toggle
                checked={settings.voyageCoverArt}
                onChange={(v) => onSettings({ voyageCoverArt: v })}
                label="탐사 행성을 게임 표지로 그리기 (개인용)"
                hint="표지 그림을 도트로 바꿔 그립니다. 공개 빌드에서는 이 옵션이 없습니다"
                color="#b69cff"
              />
            )}
          </div>
        </section>

        <section className="mt-6 border-t border-white/[0.06] pt-5">
          <h3 className="eyebrow mb-2">내 데이터 지우기</h3>
          <p className="text-[12px] leading-relaxed text-white/50">서버 캐시의 내 라이브러리·친구 정보와, 이 브라우저의 탐사 기록·설정을 지웁니다.</p>
          <div className="mt-3 flex items-center gap-3">
            {erase === 'confirm' ? (
              <>
                <button onClick={eraseAll} className="rounded-full bg-rose-500/80 px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-rose-500">
                  정말 지우기
                </button>
                <button onClick={() => setErase('idle')} className="text-[12px] text-white/50 hover:text-white">
                  취소
                </button>
              </>
            ) : (
              <button
                onClick={() => setErase('confirm')}
                disabled={erase === 'busy'}
                className="rounded-full border border-rose-300/30 px-3.5 py-1.5 text-[12px] text-rose-200/90 hover:border-rose-300/60 disabled:opacity-50"
              >
                {erase === 'busy' ? '지우는 중…' : '모두 지우기'}
              </button>
            )}
            {erase === 'failed' && <span className="text-[11.5px] text-amber-200/80">서버 캐시를 지우지 못했습니다. 서버가 켜져 있는지 확인해 주세요.</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
