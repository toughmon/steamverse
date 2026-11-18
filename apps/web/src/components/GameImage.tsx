import type { ImgHTMLAttributes } from 'react';
import { steamImage, type SteamImageKind } from '@steamverse/shared';

/** 이미지가 없을 때 쓰는 게임별 고정 색 (appid로 정해져 같은 게임은 늘 같은 색) */
export function gameTint(appid: number, lightness = 30): string {
  const hue = (Math.imul(appid, 2654435761) >>> 0) % 360;
  return `hsl(${hue} 32% ${lightness}%)`;
}

function initials(label?: string): string {
  if (!label) return '';
  const words = label.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return words.length > 1 ? (words[0]![0]! + words[1]![0]!).toUpperCase() : (words[0] ?? '').slice(0, 2).toUpperCase();
}

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  appid: number;
  kind?: SteamImageKind;
  /** 대체 표시에 쓸 게임 이름 (머리글자) */
  label?: string;
  /** tile: 같은 크기의 색 카드, none: 아무것도 그리지 않음 (툴팁 등) */
  fallback?: 'tile' | 'none';
}

/**
 * 게임 이미지. 사용자가 이미지를 껐거나 권리자 요청으로 차단된 게임이면 대체 카드를 그린다.
 * 원본을 바꾸지 않고 잘라서 보여 주기만 한다. (STEAM_COMPLIANCE C1·C7)
 */
export function GameImage({ appid, kind = 'header', label, fallback = 'tile', className, alt = '', ...rest }: Props) {
  const src = steamImage(appid, kind);
  if (src) return <img src={src} alt={alt} className={className} {...rest} />;
  if (fallback === 'none') return null;
  return (
    <div
      aria-hidden
      className={`grid place-items-center overflow-hidden font-mono text-[11px] font-semibold tracking-wider text-white/55 ${className ?? ''}`}
      style={{ background: `linear-gradient(135deg, ${gameTint(appid, 34)}, ${gameTint(appid, 18)})` }}
    >
      {initials(label)}
    </div>
  );
}
