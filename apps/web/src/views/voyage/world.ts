import type { OntNode, OntologyGraph } from '@steamverse/shared';

/**
 * 탐사 뷰의 세계 배치. 단위는 "저해상도 픽셀"(화면에서는 PX배로 키워 그린다).
 * - 섹터 = 취향 은하(태그 군집)
 * - 행성 = 게임. 반지름은 플레이 시간
 * 같은 데이터면 항상 같은 배치가 나오도록 난수를 쓰지 않는다.
 */

export const SECTOR_PALETTE = ['#7aa2ff', '#ff8fb1', '#6fe3c1', '#f6c177', '#b69cff', '#ff9e7a', '#7fd8ff', '#e0a3ff', '#c3e88d', '#ffb38a'];
const OTHER_COLOR = '#9aa3b5';
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export interface Planet {
  id: string;
  node: OntNode;
  appid: number;
  x: number;
  y: number;
  r: number;
  sector: number;
  color: string;
  favorite: boolean;
  recent: boolean;
  /** 한 번도 안 한 게임 — 탐사 전에는 안개에 싸여 있다 */
  backlog: boolean;
  /** 자전 속도·고리 기울기 등 개체마다 다른 값 */
  seed: number;
}

export interface Sector {
  id: number;
  name: string;
  primary: string;
  secondary: string;
  color: string;
  x: number;
  y: number;
  r: number;
  hours: number;
  planets: Planet[];
}

export interface World {
  sectors: Sector[];
  planets: Planet[];
  planetById: Map<string, Planet>;
  /** 전체 범위 (워프·시작 위치용) */
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

export function planetRadius(hours: number): number {
  return Math.round(Math.min(26, 5 + Math.sqrt(hours) * 0.95));
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 섹터 안 행성 배치: 큰 행성을 가운데에, 나머지를 해바라기 씨 배열로 두고 겹침을 밀어낸다 */
function placePlanets(planets: Planet[], cx: number, cy: number) {
  planets.forEach((p, i) => {
    const a = i * GOLDEN;
    const d = i === 0 ? 0 : 26 + 30 * Math.sqrt(i);
    p.x = cx + Math.cos(a) * d;
    p.y = cy + Math.sin(a) * d;
  });
  for (let iter = 0; iter < 60; iter++) {
    for (let i = 0; i < planets.length; i++) {
      for (let j = i + 1; j < planets.length; j++) {
        const a = planets[i]!;
        const b = planets[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const min = a.r + b.r + 22;
        if (dist < min) {
          const push = (min - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          // 가장 큰 행성(0번)은 중심에 붙잡아 둔다
          if (i !== 0) {
            a.x -= ux * push;
            a.y -= uy * push;
          }
          b.x += ux * push * (i === 0 ? 2 : 1);
          b.y += uy * push * (i === 0 ? 2 : 1);
        }
      }
    }
  }
  for (const p of planets) {
    p.x = Math.round(p.x);
    p.y = Math.round(p.y);
  }
}

export function buildWorld(graph: OntologyGraph): World {
  const sectors: Sector[] = [];
  const planets: Planet[] = [];

  graph.clusters.forEach((c, i) => {
    const color = c.name === '기타 취향' ? OTHER_COLOR : SECTOR_PALETTE[i % SECTOR_PALETTE.length]!;
    const [primary = c.name, secondary = ''] = c.name.split(' · ');
    const members = c.gameIds
      .map((id) => graph.nodeById.get(id))
      .filter((n): n is OntNode => !!n && n.cls === 'Game')
      .sort((a, b) => b.hours - a.hours);
    const sectorPlanets: Planet[] = members.map((n) => ({
      id: n.id,
      node: n,
      appid: n.game!.appid,
      x: 0,
      y: 0,
      r: planetRadius(n.hours),
      sector: c.id,
      color,
      favorite: n.game!.status === 'favorite',
      recent: n.game!.hours2w > 0,
      backlog: n.game!.status === 'backlog',
      seed: hashString(n.id),
    }));
    placePlanets(sectorPlanets, 0, 0);
    // 섹터 반지름 = 가장 바깥 행성까지 + 여유
    const r = Math.max(90, ...sectorPlanets.map((p) => Math.hypot(p.x, p.y) + p.r + 46));
    sectors.push({ id: c.id, name: c.name, primary, secondary, color, x: 0, y: 0, r, hours: c.hours, planets: sectorPlanets });
  });

  // 섹터 배치: 시간이 많은 섹터부터 나선을 따라, 앞서 놓인 섹터와 겹치지 않는 첫 자리에
  const placed: Sector[] = [];
  for (const s of sectors) {
    if (placed.length === 0) {
      placed.push(s);
      continue;
    }
    for (let k = 1; k < 4000; k++) {
      const a = k * GOLDEN;
      const d = 40 * Math.sqrt(k) * 6;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d * 0.72; // 가로로 넓은 화면에 맞게 납작하게
      if (placed.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + s.r + 120)) {
        s.x = Math.round(x);
        s.y = Math.round(y);
        break;
      }
    }
    placed.push(s);
  }

  for (const s of sectors) {
    for (const p of s.planets) {
      p.x += s.x;
      p.y += s.y;
      planets.push(p);
    }
  }

  const bounds = sectors.reduce(
    (b, s) => ({ x0: Math.min(b.x0, s.x - s.r), y0: Math.min(b.y0, s.y - s.r), x1: Math.max(b.x1, s.x + s.r), y1: Math.max(b.y1, s.y + s.r) }),
    { x0: 0, y0: 0, x1: 0, y1: 0 },
  );

  return { sectors, planets, planetById: new Map(planets.map((p) => [p.id, p])), bounds };
}
