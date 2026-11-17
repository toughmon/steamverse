import { bayer, hexRgb } from './sprites';
import type { World } from './world';

/**
 * 미니맵. 저해상도(MW×MH)로 그려 CSS로 키운다.
 * 바뀌지 않는 부분(섹터 성운·행성 점)은 세계가 바뀔 때 한 번만 그리고,
 * 매 프레임에는 탐사선·시야·목표만 덧그린다.
 */
export const MW = 120;
export const MH = 84;
const PAD = 5;

export interface Minimap {
  base: HTMLCanvasElement;
  toMap: (x: number, y: number) => { x: number; y: number };
  toWorld: (mx: number, my: number) => { x: number; y: number };
  scale: number;
}

export function buildMinimap(world: World): Minimap {
  const { x0, y0, x1, y1 } = world.bounds;
  const bw = Math.max(1, x1 - x0);
  const bh = Math.max(1, y1 - y0);
  const scale = Math.min((MW - PAD * 2) / bw, (MH - PAD * 2) / bh);
  // 남는 여백을 양쪽에 고르게
  const offX = (MW - bw * scale) / 2;
  const offY = (MH - bh * scale) / 2;
  const toMap = (x: number, y: number) => ({ x: (x - x0) * scale + offX, y: (y - y0) * scale + offY });
  const toWorld = (mx: number, my: number) => ({ x: (mx - offX) / scale + x0, y: (my - offY) / scale + y0 });

  const base = document.createElement('canvas');
  base.width = MW;
  base.height = MH;
  const ctx = base.getContext('2d')!;
  ctx.fillStyle = '#05060d';
  ctx.fillRect(0, 0, MW, MH);

  // 섹터: 성운처럼 디더링한 원
  for (const s of world.sectors) {
    const c = toMap(s.x, s.y);
    const r = s.r * scale;
    const [cr, cg, cb] = hexRgb(s.color);
    for (let y = Math.floor(c.y - r); y <= Math.ceil(c.y + r); y++) {
      for (let x = Math.floor(c.x - r); x <= Math.ceil(c.x + r); x++) {
        const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) / r;
        if (d > 1) continue;
        const density = 0.55 * (1 - d * d);
        if (bayer(x, y) < density) {
          ctx.fillStyle = `rgba(${cr},${cg},${cb},0.28)`;
          ctx.fillRect(x, y, 1, 1);
        }
        // 테두리 1px
        if (d > 0.9 && (x + y) % 2 === 0) {
          ctx.fillStyle = `rgba(${cr},${cg},${cb},0.45)`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  return { base, toMap, toWorld, scale };
}

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  map: Minimap,
  world: World,
  visited: Set<string>,
  state: {
    ship: { x: number; y: number; angle: number };
    view: { w: number; h: number; cx: number; cy: number };
    target?: { x: number; y: number };
    highlight?: { x: number; y: number };
    now: number;
  },
) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(map.base, 0, 0);

  // 행성: 큰 행성(많이 한 게임)은 2×2. 가 본 행성은 밝게, 안 가 본 행성은 흐리게, 안개 행성은 회색
  for (const p of world.planets) {
    const m = map.toMap(p.x, p.y);
    const big = p.r >= 16;
    const seen = visited.has(p.id);
    if (p.backlog && !seen) ctx.fillStyle = '#59627a';
    else ctx.fillStyle = p.favorite ? '#ffd8a0' : p.color;
    ctx.globalAlpha = seen || p.backlog ? 1 : 0.45;
    ctx.fillRect(Math.round(m.x) - (big ? 1 : 0), Math.round(m.y) - (big ? 1 : 0), big ? 2 : 1, big ? 2 : 1);
  }
  ctx.globalAlpha = 1;

  // 지금 화면에 보이는 범위
  const a = map.toMap(state.view.cx - state.view.w / 2, state.view.cy - state.view.h / 2);
  const b = map.toMap(state.view.cx + state.view.w / 2, state.view.cy + state.view.h / 2);
  const rx = Math.round(a.x);
  const ry = Math.round(a.y);
  const rw = Math.max(2, Math.round(b.x - a.x));
  const rh = Math.max(2, Math.round(b.y - a.y));
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(rx, ry, rw, 1);
  ctx.fillRect(rx, ry + rh - 1, rw, 1);
  ctx.fillRect(rx, ry, 1, rh);
  ctx.fillRect(rx + rw - 1, ry, 1, rh);

  // 목적지
  if (state.target) {
    const t = map.toMap(state.target.x, state.target.y);
    ctx.fillStyle = '#7fd8ff';
    const tx = Math.round(t.x);
    const ty = Math.round(t.y);
    ctx.fillRect(tx - 2, ty, 1, 1);
    ctx.fillRect(tx + 2, ty, 1, 1);
    ctx.fillRect(tx, ty - 2, 1, 1);
    ctx.fillRect(tx, ty + 2, 1, 1);
  }
  // 마우스로 가리킨 행성
  if (state.highlight) {
    const h = map.toMap(state.highlight.x, state.highlight.y);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(h.x) - 1, Math.round(h.y) - 1, 3, 3);
  }

  // 탐사선: 깜빡이는 점 + 기수 방향 한 칸
  const s = map.toMap(state.ship.x, state.ship.y);
  const sx = Math.round(s.x);
  const sy = Math.round(s.y);
  const blink = Math.floor(state.now / 300) % 2 === 0;
  ctx.fillStyle = blink ? '#ffffff' : '#7dffb2';
  ctx.fillRect(sx - 1, sy - 1, 3, 3);
  const dir = state.ship.angle - Math.PI / 2;
  ctx.fillStyle = '#7dffb2';
  ctx.fillRect(Math.round(sx + Math.cos(dir) * 3), Math.round(sy + Math.sin(dir) * 3), 1, 1);
}

