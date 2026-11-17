import type { OntologyGraph } from '@steamverse/shared';
import { hexRgb, shipSprite } from './sprites';
import type { Planet, World } from './world';

/**
 * 친구 탐사선. 친구와 같이 가진 게임(행성) 주위를 돌다가
 * 가끔 다른 공유 게임으로 옮겨 간다. 많이 한 게임일수록 자주 간다.
 * 공유 게임이 없는 친구는 아무 행성이나 돌아다닌다.
 */
const FRIEND_COLORS = ['#ff8fb1', '#f6c177', '#6fe3c1', '#b69cff', '#7fd8ff', '#ff9e7a', '#c3e88d', '#e0a3ff'];
const MAX_SHIPS = 12;
const CRUISE = 85;

export interface FriendShip {
  id: string;
  name: string;
  color: string;
  sprite: HTMLCanvasElement;
  /** 같이 가진 게임 수 */
  shared: number;
  targets: { planet: Planet; weight: number }[];
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  planet: Planet;
  mode: 'orbit' | 'travel';
  phase: number;
  orbitDir: 1 | -1;
  until: number;
  rng: () => number;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(hex: string, to: [number, number, number], t: number) {
  const [r, g, b] = hexRgb(hex);
  const c = (v: number, w: number) => Math.round(v + (w - v) * t);
  return `rgb(${c(r, to[0])},${c(g, to[1])},${c(b, to[2])})`;
}

function pick(targets: FriendShip['targets'], rng: () => number, not?: Planet): Planet {
  const pool = targets.length > 1 && not ? targets.filter((t) => t.planet !== not) : targets;
  const total = pool.reduce((s, t) => s + t.weight, 0);
  let r = rng() * total;
  for (const t of pool) {
    r -= t.weight;
    if (r <= 0) return t.planet;
  }
  return pool[pool.length - 1]!.planet;
}

const orbitRadius = (p: Planet) => p.r + 16;

export function buildFriendShips(graph: OntologyGraph, world: World): FriendShip[] {
  if (world.planets.length === 0) return [];
  const friends = (graph.adjacency.get(graph.meId) ?? [])
    .filter((e) => e.rel === 'friendOf')
    .map((e) => graph.nodeById.get(e.source === graph.meId ? e.target : e.source))
    .filter((n): n is NonNullable<typeof n> => !!n)
    .map((node) => {
      const owned = (graph.adjacency.get(node.id) ?? [])
        .filter((e) => e.rel === 'owns' && e.source === node.id)
        .map((e) => ({ planet: world.planetById.get(e.target), weight: 0.5 + Math.sqrt(e.weight ?? 0) }))
        .filter((t): t is { planet: Planet; weight: number } => !!t.planet);
      return { node, owned };
    })
    .sort((a, b) => b.owned.length - a.owned.length)
    .slice(0, MAX_SHIPS);

  return friends.map(({ node, owned }, i) => {
    const color = FRIEND_COLORS[i % FRIEND_COLORS.length]!;
    const rng = mulberry32(hashString(node.id));
    const targets = owned.length ? owned : world.planets.map((planet) => ({ planet, weight: 1 }));
    const planet = pick(targets, rng);
    const phase = rng() * Math.PI * 2;
    return {
      id: node.id,
      name: node.label,
      color,
      sprite: shipSprite({ a: mix(color, [255, 255, 255], 0.6), b: color, c: mix(color, [10, 12, 24], 0.5), r: '#ffffff' }),
      shared: owned.length,
      targets,
      x: planet.x + Math.cos(phase) * orbitRadius(planet),
      y: planet.y + Math.sin(phase) * orbitRadius(planet) * 0.85,
      vx: 0,
      vy: 0,
      angle: 0,
      planet,
      mode: 'orbit',
      phase,
      orbitDir: rng() < 0.5 ? 1 : -1,
      until: 0,
      rng,
    };
  });
}

export function stepFriends(ships: FriendShip[], dt: number, now: number) {
  for (const f of ships) {
    const p = f.planet;
    const R = orbitRadius(p);
    const px = f.x;
    const py = f.y;
    if (f.mode === 'orbit') {
      if (f.until === 0) f.until = now + 5000 + f.rng() * 12000;
      f.phase += f.orbitDir * dt * (26 / R);
      const tx = p.x + Math.cos(f.phase) * R;
      const ty = p.y + Math.sin(f.phase) * R * 0.85;
      const k = Math.min(1, dt * 5);
      f.x += (tx - f.x) * k;
      f.y += (ty - f.y) * k;
      f.vx = (f.x - px) / Math.max(dt, 1e-3);
      f.vy = (f.y - py) / Math.max(dt, 1e-3);
      if (now > f.until) {
        if (f.targets.length > 1) {
          f.planet = pick(f.targets, f.rng, p);
          f.mode = 'travel';
        } else {
          f.until = now + 5000 + f.rng() * 12000;
          f.orbitDir = f.orbitDir === 1 ? -1 : 1;
        }
      }
    } else {
      // 목표 행성 궤도의 가장 가까운 지점으로
      const a = Math.atan2((f.y - p.y) / 0.85, f.x - p.x);
      const ex = p.x + Math.cos(a) * R;
      const ey = p.y + Math.sin(a) * R * 0.85;
      const dx = ex - f.x;
      const dy = ey - f.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 6) {
        f.mode = 'orbit';
        f.phase = a;
        f.until = now + 5000 + f.rng() * 12000;
      } else {
        const sp = Math.min(CRUISE, 18 + dist * 1.4);
        const k = Math.min(1, dt * 2.5);
        f.vx += ((dx / dist) * sp - f.vx) * k;
        f.vy += ((dy / dist) * sp - f.vy) * k;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
      }
    }
    if (Math.hypot(f.vx, f.vy) > 3) {
      const target = Math.atan2(f.vy, f.vx) + Math.PI / 2;
      let da = target - f.angle;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      f.angle += da * Math.min(1, dt * 8);
    }
  }
}
