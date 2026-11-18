/**
 * 도트 그래픽 생성기. 외부 그림 없이 코드로 만든다.
 * - 행성: 게임 표지 이미지를 원으로 잘라 색 수를 줄이고, 디더링으로 음영을 넣는다
 * - 성운: 값 노이즈 + 베이어 디더링
 * - 탐사선: 문자열 도트 그림
 */

/** 4×4 베이어 행렬 (0..1) — 계단식 음영을 도트답게 섞는 데 쓴다 */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)]!;

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// ── 탐사선 ─────────────────────────────────────────────────────
// 위쪽이 기수. 문자: a 밝은 동체, b 동체, c 그림자, w 조종석, e 엔진, r 날개 끝 표시등
const SHIP = [
  '......a......',
  '.....aba.....',
  '.....awa.....',
  '....abwba....',
  '....abbbc....',
  '...aabbbcc...',
  '..rabbbbbcr..',
  '.aabbbcbbbcc.',
  'aabb.bcb.bbcc',
  'cb...ece...bc',
  '.....e.e.....',
];
const SHIP_COLORS: Record<string, string> = {
  a: '#eef2ff',
  b: '#a9b4d6',
  c: '#5c6688',
  w: '#7fd8ff',
  e: '#ff9e7a',
  r: '#ff6b8b',
};

export const SHIP_SIZE = SHIP.length;

/** colors로 일부 색을 바꿔 칠할 수 있다 (친구 탐사선) */
export function shipSprite(colors: Partial<Record<string, string>> = {}): HTMLCanvasElement {
  const c = makeCanvas(SHIP_SIZE, SHIP_SIZE);
  const ctx = c.getContext('2d')!;
  const palette = { ...SHIP_COLORS, ...colors };
  SHIP.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const col = palette[ch];
      if (!col) return;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  return c;
}

// ── 행성 ───────────────────────────────────────────────────────
const LIGHT = (() => {
  const v = [-0.55, -0.6, 0.58];
  const l = Math.hypot(...v);
  return v.map((x) => x / l) as [number, number, number];
})();

/**
 * 표지 없는 행성의 표면 밝기 (0.6~1.1). 무늬 4종: 0 위도 띠, 1 크레이터, 2 소용돌이, 3 대륙
 * nx, ny, nz는 구 표면 좌표(-1..1)
 */
function surface(pattern: number, nx: number, ny: number, nz: number, seed: number, band: number): number {
  const s = seed % 997;
  switch (pattern) {
    case 0: {
      const stripe = Math.floor((ny + 1) * band + Math.sin(nx * 3 + s) * 0.6) % 2;
      return stripe ? 1 : 0.68;
    }
    case 1: {
      // 크레이터: 몇 개의 고정 중심에서 거리로 테두리(밝게)와 바닥(어둡게)
      let k = 0.92;
      for (let c = 0; c < 5; c++) {
        const cx = Math.sin(s * 1.7 + c * 2.3) * 0.65;
        const cy = Math.cos(s * 2.9 + c * 1.9) * 0.65;
        const cr = 0.16 + ((s * (c + 3)) % 7) * 0.035;
        const d = Math.hypot(nx - cx, ny - cy);
        if (d < cr * 0.75) k = 0.66;
        else if (d < cr) k = Math.max(k, 1.08);
      }
      return k;
    }
    case 2: {
      const a = Math.atan2(ny, nx) + Math.hypot(nx, ny) * (3 + (s % 3));
      return Math.sin(a * 3 + s) > 0.15 ? 1 : 0.7;
    }
    default: {
      // 대륙: 사인파를 겹친 값으로 바다/땅을 나눈다
      const v = Math.sin(nx * 3.1 + s) + Math.sin(ny * 2.7 - s * 0.7) + Math.sin((nx + ny + nz) * 4.3 + s * 1.3) * 0.6;
      return v > 0.35 ? 1.05 : 0.64;
    }
  }
}

/**
 * 행성 도트 그림. image가 없으면(기본값, 또는 로딩 중·실패) 섹터 색으로 무늬 행성을 만든다.
 * 반환 캔버스 크기 = 2r+2 (외곽 대기층 1px 포함)
 */
export function planetSprite(r: number, tint: string, seed: number, image?: HTMLImageElement): HTMLCanvasElement {
  const d = r * 2;
  const size = d + 2;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;

  let src: Uint8ClampedArray | null = null;
  if (image) {
    try {
      // 표지(가로로 긴 그림)의 가운데를 정사각형으로 잘라 행성 지름에 맞춘다
      const s = Math.min(image.naturalWidth, image.naturalHeight);
      const sx = (image.naturalWidth - s) / 2;
      const sy = (image.naturalHeight - s) / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(image, sx, sy, s, s, 1, 1, d, d);
      src = ctx.getImageData(0, 0, size, size).data;
      ctx.clearRect(0, 0, size, size);
    } catch {
      src = null; // CORS 등으로 픽셀을 못 읽으면 대체 무늬
    }
  }

  const [tr, tg, tb] = hexRgb(tint);
  const out = ctx.createImageData(size, size);
  const o = out.data;
  const band = (seed % 5) + 3;
  const pattern = (seed >>> 3) % 4;
  // 같은 섹터 안에서도 행성마다 색이 살짝 다르게
  const shift = [0, 1, 2].map((c) => 0.86 + (((seed >>> (8 + c * 5)) & 31) / 31) * 0.28);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5 - size / 2) / r;
      const ny = (y + 0.5 - size / 2) / r;
      const rr = nx * nx + ny * ny;
      const i = (y * size + x) * 4;
      if (rr > 1) {
        // 대기층: 행성 바로 바깥 1px 테두리
        if (rr < ((r + 1) / r) ** 2) {
          o[i] = tr;
          o[i + 1] = tg;
          o[i + 2] = tb;
          o[i + 3] = 110;
        }
        continue;
      }
      const nz = Math.sqrt(1 - rr);
      const lambert = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      // 음영을 4단계로 끊고 베이어로 섞는다
      const shadeRaw = 0.22 + lambert * 0.95;
      const shade = Math.floor(shadeRaw * 4 + bayer(x, y) - 0.5) / 4;

      let r0: number, g0: number, b0: number;
      if (src) {
        r0 = src[i]!;
        g0 = src[i + 1]!;
        b0 = src[i + 2]!;
      } else {
        // 표지 없는 행성 (기본값 — STEAM_COMPLIANCE C4): 섹터 색에 행성마다 다른 무늬
        const k = surface(pattern, nx, ny, nz, seed, band);
        r0 = Math.min(255, tr * k * shift[0]);
        g0 = Math.min(255, tg * k * shift[1]);
        b0 = Math.min(255, tb * k * shift[2]);
      }
      // 색 수 줄이기 (채널당 6단계) + 섹터 색을 살짝 섞어 무리마다 통일감
      const q = (v: number, t: number) => Math.round(((v * 0.82 + t * 0.18) * shade) / 51) * 51;
      o[i] = q(r0, tr);
      o[i + 1] = q(g0, tg);
      o[i + 2] = q(b0, tb);
      o[i + 3] = 255;
      // 빛 받는 쪽 가장자리 1px 하이라이트
      if (rr > ((r - 1.2) / r) ** 2 && lambert > 0.55) {
        o[i] = Math.min(255, o[i]! + 70);
        o[i + 1] = Math.min(255, o[i + 1]! + 70);
        o[i + 2] = Math.min(255, o[i + 2]! + 70);
      }
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

// ── 성운 ───────────────────────────────────────────────────────
function valueNoise(seed: number) {
  const h = (x: number, y: number) => {
    let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = smooth(x - xi);
    const fy = smooth(y - yi);
    const a = h(xi, yi);
    const b = h(xi + 1, yi);
    const c = h(xi, yi + 1);
    const d = h(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** 섹터 성운. 2px 단위로 거칠게 그려 도트 느낌을 살린다. 반환 캔버스 한 변 = 2*radius */
export function nebulaSprite(radius: number, color: string, seed: number): HTMLCanvasElement {
  const cell = 2;
  const n = Math.ceil((radius * 2) / cell);
  const c = makeCanvas(n * cell, n * cell);
  const ctx = c.getContext('2d')!;
  const noise = valueNoise(seed);
  const [r, g, b] = hexRgb(color);
  const levels = [0, 0.07, 0.13, 0.2];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const nx = (x + 0.5) / n - 0.5;
      const ny = (y + 0.5) / n - 0.5;
      const dist = Math.hypot(nx, ny) * 2;
      if (dist > 1) continue;
      const fbm = noise(x * 0.09, y * 0.09) * 0.6 + noise(x * 0.22 + 31, y * 0.22) * 0.3 + noise(x * 0.5, y * 0.5 + 7) * 0.1;
      const v = Math.max(0, (1 - dist) ** 1.4 * 1.5 * fbm - 0.08);
      const lvl = Math.min(levels.length - 1, Math.floor(v * levels.length * 1.6 + bayer(x, y) - 0.5));
      if (lvl <= 0) continue;
      ctx.fillStyle = `rgba(${r},${g},${b},${levels[lvl]})`;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  return c;
}

// ── 안개 (미탐사 백로그 행성) ────────────────────────────────────
const QMARK = ['01110', '10001', '00001', '00110', '00100', '00000', '00100'];
const FOG_SHADES = ['#262c3f', '#3c4460', '#5f6886', '#9099b6'];

export interface FogSprite {
  canvas: HTMLCanvasElement;
  data: ImageData;
}

/** 행성보다 조금 큰 디더링 구름 + 가운데 물음표. 반환 캔버스 한 변 = 2R */
export function fogSprite(r: number, seed: number): FogSprite {
  const R = Math.round(r * 1.35) + 3;
  const size = R * 2;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const noise = valueNoise(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - R, y + 0.5 - R) / R;
      if (d > 1) continue;
      const n = noise(x * 0.2, y * 0.2) * 0.7 + noise(x * 0.5 + 9, y * 0.5) * 0.3;
      const v = (1 - d * d) * 1.3 * (0.5 + n * 0.7);
      const lvl = Math.floor(v * 4 + bayer(x, y) - 0.5);
      if (lvl <= 0) continue;
      ctx.fillStyle = FOG_SHADES[Math.min(FOG_SHADES.length - 1, lvl)]!;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // 물음표: 행성이 클수록 크게, 그림자 한 칸
  const k = Math.max(1, Math.floor(r / 7));
  const qx = R - Math.floor((5 * k) / 2);
  const qy = R - Math.floor((7 * k) / 2);
  for (const [color, off] of [['#0b0d16', k], ['#e4eaff', 0]] as const) {
    ctx.fillStyle = color;
    QMARK.forEach((row, yy) => [...row].forEach((b, xx) => b === '1' && ctx.fillRect(qx + xx * k + off, qy + yy * k + off, k, k)));
  }
  return { canvas: c, data: ctx.getImageData(0, 0, size, size) };
}

/** 안개가 걷히는 효과: 픽셀마다 정해진 문턱값보다 t가 커지면 그 픽셀을 지운다 */
export function dissolveFog(fog: FogSprite, t: number): HTMLCanvasElement {
  const { width, height } = fog.data;
  const out = makeCanvas(width, height);
  const img = new ImageData(new Uint8ClampedArray(fog.data.data), width, height);
  const d = img.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rnd = ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0) % 1000 / 1000;
      if (rnd * 0.6 + bayer(x, y) * 0.4 < t) d[(y * width + x) * 4 + 3] = 0;
    }
  }
  out.getContext('2d')!.putImageData(img, 0, 0);
  return out;
}
