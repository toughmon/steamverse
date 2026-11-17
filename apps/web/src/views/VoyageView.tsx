import { useEffect, useMemo, useRef, useState } from 'react';
import { steamImage, type OntologyGraph } from '@steamverse/shared';
import { NodeDetail } from '../components/NodeDetail';
import { formatHours } from '../lib/format';
import { SHIP_SIZE, bayer, nebulaSprite, planetSprite, shipSprite } from './voyage/sprites';
import { MH, MW, buildMinimap, drawMinimap } from './voyage/minimap';
import { buildWorld, type Planet, type World } from './voyage/world';

/**
 * 탐사 뷰: 위에서 내려다보는 2D 도트 우주를 탐사선으로 날아다닌다.
 * 섹터 = 취향 은하, 행성 = 게임(크기 = 플레이 시간). 행성에 도킹하면 게임 정보를 본다.
 * 장면은 저해상도 버퍼에 그린 뒤 PX배로 키워(보간 없이) 도트 느낌을 낸다. 글자는 원래 해상도로 따로 그린다.
 */

const PX = 3;
const ACCEL = 520;
const MAX_SPEED = 150;
const BOOST = 1.9;
const DOCK_GAP = 26;
const LABEL_RANGE = 190;
const WARP_MS = 900;
/** 미니맵을 화면에 키우는 배율 */
const MAP_SCALE = 3.6;

const CONTROLS: [string, string][] = [
  ['WASD', '비행'],
  ['SHIFT', '부스트'],
  ['클릭', '자동 비행'],
  ['E', '도킹'],
  ['1-9', '워프'],
  ['M', '지도'],
  ['ESC', '정지'],
];
const PIXEL_FONT = '"Silkscreen", "Pretendard Variable", sans-serif';

interface Props {
  graph: OntologyGraph;
  onOpenInExplorer: (id: string) => void;
}

interface Ship {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

function hash3(a: number, b: number, c: number) {
  let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2246822519);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
}

/** 시작 위치: 가장 큰 섹터의 중심 행성 아래 */
function startPoint(world: World) {
  const s = world.sectors[0];
  if (!s) return { x: 0, y: 0 };
  const core = s.planets[0];
  return { x: s.x, y: s.y + (core ? core.r : 0) + 40 };
}

function planetAt(world: World, wx: number, wy: number): Planet | undefined {
  let best: Planet | undefined;
  let bestD = Infinity;
  for (const p of world.planets) {
    const d = Math.hypot(p.x - wx, p.y - wy);
    if (d <= p.r + 4 && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export function VoyageView({ graph, onOpenInExplorer }: Props) {
  const world = useMemo(() => buildWorld(graph), [graph]);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const [minimapOn, setMinimapOn] = useState(true);
  const [mapHover, setMapHover] = useState<Planet | null>(null);
  const mapHoverRef = useRef<Planet | null>(null);

  const [nearId, setNearId] = useState<string | null>(null);
  const [dockedId, setDockedId] = useState<string | null>(null);
  const [sectorId, setSectorId] = useState<number | null>(null);
  const [hud, setHud] = useState({ x: 0, y: 0, speed: 0 });

  // 루프가 읽는 값들 (매 프레임 바뀌므로 상태가 아니라 ref)
  const worldRef = useRef(world);
  const shipRef = useRef<Ship>({ ...startPoint(world), vx: 0, vy: 0, angle: 0 });
  const camRef = useRef({ ...startPoint(world) });
  const keys = useRef(new Set<string>());
  const autopilot = useRef<{ x: number; y: number; planetId?: string } | null>(null);
  const warp = useRef<{ t0: number; to: { x: number; y: number }; done: boolean } | null>(null);
  const mouse = useRef<{ x: number; y: number } | null>(null);
  const hoverRef = useRef<string | null>(null);
  const dockedRef = useRef<string | null>(null);
  const nearRef = useRef<string | null>(null);
  const sectorRef = useRef<number | null>(null);

  // ── 그래픽 자원 ─────────────────────────────────────────────
  const ship = useMemo(() => shipSprite(), []);
  const nebulae = useMemo(() => new Map(world.sectors.map((s) => [s.id, nebulaSprite(s.r * 1.35, s.color, 17 + s.id * 31)])), [world]);
  const planetSprites = useRef(new Map<string, HTMLCanvasElement>());
  const minimap = useMemo(() => buildMinimap(world), [world]);

  useEffect(() => {
    worldRef.current = world;
    const sprites = planetSprites.current;
    sprites.clear();
    let alive = true;
    for (const p of world.planets) {
      sprites.set(p.id, planetSprite(p.r, p.color, p.seed));
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (alive) sprites.set(p.id, planetSprite(p.r, p.color, p.seed, img));
      };
      img.src = steamImage(p.appid, 'header');
    }
    // 데이터가 바뀌어 지금 위치가 허공이 되었으면 시작 위치로
    const s = shipRef.current;
    if (!world.sectors.some((sec) => Math.hypot(sec.x - s.x, sec.y - s.y) < sec.r * 2)) {
      Object.assign(s, startPoint(world), { vx: 0, vy: 0 });
      Object.assign(camRef.current, startPoint(world));
    }
    return () => {
      alive = false;
    };
  }, [world]);

  useEffect(() => {
    dockedRef.current = dockedId;
  }, [dockedId]);

  // ── 조작 ─────────────────────────────────────────────────────
  const warpTo = (x: number, y: number) => {
    setDockedId(null);
    autopilot.current = null;
    warp.current = { t0: performance.now(), to: { x, y }, done: false };
  };
  const warpToSector = (index: number) => {
    const s = world.sectors[index];
    if (!s) return;
    const core = s.planets[0];
    warpTo(s.x, s.y + (core ? core.r : 0) + 40);
  };
  const flyToPlanet = (id: string) => {
    const p = world.planetById.get(id);
    if (!p) return;
    setDockedId(null);
    autopilot.current = { x: p.x, y: p.y, planetId: p.id };
  };

  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (k === 'e') {
        if (dockedRef.current) setDockedId(null);
        else if (nearRef.current) setDockedId(nearRef.current);
        return;
      }
      if (k === 'escape') {
        setDockedId(null);
        autopilot.current = null;
        return;
      }
      if (k === 'm') {
        setMinimapOn((v) => !v);
        return;
      }
      if (/^[1-9]$/.test(k)) {
        warpToSector(Number(k) - 1);
        return;
      }
      keys.current.add(k);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  // ── 게임 루프 ────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current!;
    const container = containerRef.current!;
    const ctx = canvas.getContext('2d')!;
    const buffer = document.createElement('canvas');
    const bctx = buffer.getContext('2d')!;
    let cssW = 0;
    let cssH = 0;
    let dpr = 1;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      cssW = container.clientWidth;
      cssH = container.clientHeight;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      buffer.width = Math.ceil(cssW / PX);
      buffer.height = Math.ceil(cssH / PX);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const particles: Particle[] = [];
    let last = performance.now();
    let frame = 0;
    let hudTick = 0;

    const toWorld = (sx: number, sy: number) => {
      const cam = camRef.current;
      return { x: cam.x + (sx - cssW / 2) / PX, y: cam.y + (sy - cssH / 2) / PX };
    };

    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const w = toWorld(e.clientX - rect.left, e.clientY - rect.top);
      const p = planetAt(worldRef.current, w.x, w.y);
      setDockedId(null);
      autopilot.current = p ? { x: p.x, y: p.y, planetId: p.id } : { x: w.x, y: w.y };
    };
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onLeave = () => {
      mouse.current = null;
    };
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      frame++;
      const W = buffer.width;
      const H = buffer.height;
      const wld = worldRef.current;
      const s = shipRef.current;
      const cam = camRef.current;
      const k = keys.current;

      // ── 워프 ──
      const wp = warp.current;
      let warpT = -1;
      if (wp) {
        warpT = (now - wp.t0) / WARP_MS;
        if (warpT >= 0.5 && !wp.done) {
          wp.done = true;
          Object.assign(s, wp.to, { vx: 0, vy: -20 });
          Object.assign(cam, wp.to);
        }
        if (warpT >= 1) warp.current = null;
      }

      // ── 입력 → 가속 ──
      let ix = 0;
      let iy = 0;
      if (k.has('arrowleft') || k.has('a')) ix -= 1;
      if (k.has('arrowright') || k.has('d')) ix += 1;
      if (k.has('arrowup') || k.has('w')) iy -= 1;
      if (k.has('arrowdown') || k.has('s')) iy += 1;
      const manual = ix !== 0 || iy !== 0;
      if (manual) {
        autopilot.current = null;
        if (dockedRef.current) setDockedId(null);
      }
      const ap = autopilot.current;
      let maxSpeed = MAX_SPEED * (k.has('shift') ? BOOST : 1);
      if (ap && !manual) {
        const target = ap.planetId ? wld.planetById.get(ap.planetId) : undefined;
        const tx = target ? target.x : ap.x;
        // 행성 이름표 아래에 멈춘다
        const ty = target ? target.y + target.r + 22 : ap.y;
        const dx = tx - s.x;
        const dy = ty - s.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 4) {
          autopilot.current = null;
          if (target) setDockedId(target.id);
        } else {
          ix = dx / dist;
          iy = dy / dist;
          // 도착할 때 부드럽게 감속
          // 멀리 갈 때는 빠르게(미니맵 클릭 등), 가까워지면 부드럽게 감속
          maxSpeed = Math.min(MAX_SPEED * 3, 30 + dist * 1.6);
        }
      }
      const inLen = Math.hypot(ix, iy) || 1;
      const thrusting = (ix !== 0 || iy !== 0) && warpT < 0 && !dockedRef.current;
      if (thrusting) {
        s.vx += (ix / inLen) * ACCEL * dt;
        s.vy += (iy / inLen) * ACCEL * dt;
      }
      const damp = thrusting ? 0.8 : dockedRef.current ? 6 : 2.2;
      s.vx *= Math.exp(-damp * dt);
      s.vy *= Math.exp(-damp * dt);
      const speed = Math.hypot(s.vx, s.vy);
      if (speed > maxSpeed) {
        s.vx *= maxSpeed / speed;
        s.vy *= maxSpeed / speed;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      // 기수 방향: 움직이는 쪽, 도킹 중이면 행성 쪽
      const docked = dockedRef.current ? wld.planetById.get(dockedRef.current) : undefined;
      let targetAngle = s.angle;
      if (docked) targetAngle = Math.atan2(docked.y - s.y, docked.x - s.x) + Math.PI / 2;
      else if (speed > 10) targetAngle = Math.atan2(s.vy, s.vx) + Math.PI / 2;
      let da = targetAngle - s.angle;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      s.angle += da * Math.min(1, dt * 10);

      // 엔진 불꽃
      if (thrusting && frame % 2 === 0) {
        const back = s.angle + Math.PI / 2;
        particles.push({
          x: s.x + Math.cos(back) * 6 + (Math.random() - 0.5) * 2,
          y: s.y + Math.sin(back) * 6 + (Math.random() - 0.5) * 2,
          vx: Math.cos(back) * 30 + s.vx * 0.2,
          vy: Math.sin(back) * 30 + s.vy * 0.2,
          life: 1,
        });
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt * 2.2;
        if (p.life <= 0) particles.splice(i, 1);
      }

      // 카메라는 탐사선을 살짝 늦게 따라간다
      const follow = 1 - Math.exp(-5 * dt);
      cam.x += (s.x - cam.x) * follow;
      cam.y += (s.y - cam.y) * follow;

      // ── 근처 행성·섹터 판정 ──
      let near: Planet | undefined;
      let nearD = Infinity;
      for (const p of wld.planets) {
        const d = Math.hypot(p.x - s.x, p.y - s.y) - p.r;
        if (d < DOCK_GAP && d < nearD) {
          near = p;
          nearD = d;
        }
      }
      const nearIdNow = near?.id ?? null;
      if (nearIdNow !== nearRef.current) {
        nearRef.current = nearIdNow;
        setNearId(nearIdNow);
      }
      const sec = wld.sectors.find((x) => Math.hypot(x.x - s.x, x.y - s.y) < x.r);
      const secId = sec?.id ?? null;
      if (secId !== sectorRef.current) {
        sectorRef.current = secId;
        setSectorId(secId);
      }
      hoverRef.current = mouse.current ? (planetAt(wld, toWorld(mouse.current.x, mouse.current.y).x, toWorld(mouse.current.x, mouse.current.y).y)?.id ?? null) : null;
      canvas.style.cursor = hoverRef.current ? 'pointer' : 'crosshair';
      if (++hudTick % 6 === 0) setHud({ x: Math.round(s.x), y: Math.round(s.y), speed: Math.round(speed) });

      // ── 그리기 (저해상도 버퍼) ──
      const ox = Math.round(W / 2 - cam.x);
      const oy = Math.round(H / 2 - cam.y);
      bctx.imageSmoothingEnabled = false;
      bctx.fillStyle = '#04050b';
      bctx.fillRect(0, 0, W, H);

      // 별: 시차가 다른 세 겹. 128px 칸마다 같은 별이 나오게 칸 좌표로 난수를 만든다
      const layers = [
        { p: 0.15, n: 10, tone: [70, 80, 110] },
        { p: 0.35, n: 6, tone: [130, 140, 175] },
        { p: 0.6, n: 3, tone: [220, 228, 255] },
      ];
      layers.forEach((L, li) => {
        const T = 128;
        const bx = cam.x * L.p - W / 2;
        const by = cam.y * L.p - H / 2;
        for (let ty = Math.floor(by / T); ty <= Math.floor((by + H) / T); ty++) {
          for (let tx = Math.floor(bx / T); tx <= Math.floor((bx + W) / T); tx++) {
            for (let i = 0; i < L.n; i++) {
              const h = hash3(tx, ty, li * 97 + i);
              const sx = Math.round(tx * T + (h % T) - bx);
              const sy = Math.round(ty * T + ((h >>> 8) % T) - by);
              const tw = li === 2 && (h >>> 20) % 7 === 0 ? (Math.sin(now / 300 + h) > 0.6 ? 1.4 : 0.8) : 1;
              const [r, g, b] = L.tone.map((c) => Math.min(255, c * tw * (0.7 + ((h >>> 16) % 30) / 100)));
              bctx.fillStyle = `rgb(${r},${g},${b})`;
              if (warpT >= 0 && warpT < 1) {
                // 워프: 별이 화면 중심에서 바깥으로 늘어난다
                const intensity = Math.sin(Math.PI * warpT);
                const dx = sx - W / 2;
                const dy = sy - H / 2;
                const len = intensity * (0.15 + L.p) * 0.6;
                bctx.globalAlpha = 0.9;
                for (let t = 0; t < 1; t += 0.12) bctx.fillRect(Math.round(sx + dx * len * t), Math.round(sy + dy * len * t), 1, 1);
                bctx.globalAlpha = 1;
              } else {
                bctx.fillRect(sx, sy, 1, 1);
              }
            }
          }
        }
      });

      // 성운
      for (const sc of wld.sectors) {
        const neb = nebulae.get(sc.id);
        if (!neb) continue;
        const x = sc.x + ox - neb.width / 2;
        const y = sc.y + oy - neb.height / 2;
        if (x > W || y > H || x + neb.width < 0 || y + neb.height < 0) continue;
        bctx.drawImage(neb, Math.round(x), Math.round(y));
      }

      // 행성
      const ringPoints = (p: Planet, front: boolean) => {
        const tilt = 0.32 + (p.seed % 10) / 60;
        const rx = p.r * 1.75;
        const ry = rx * tilt;
        bctx.fillStyle = front ? 'rgba(255,214,150,0.95)' : 'rgba(255,214,150,0.45)';
        const steps = Math.ceil(rx * 7);
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const isFront = Math.sin(a) > 0;
          if (isFront !== front) continue;
          if (!front && Math.hypot(Math.cos(a) * rx, Math.sin(a) * ry) < p.r) continue;
          bctx.fillRect(Math.round(p.x + ox + Math.cos(a) * rx), Math.round(p.y + oy + Math.sin(a) * ry), 1, 1);
        }
      };
      for (const p of wld.planets) {
        const x = p.x + ox;
        const y = p.y + oy;
        if (x + p.r * 2 < 0 || x - p.r * 2 > W || y + p.r * 2 < 0 || y - p.r * 2 > H) continue;
        if (p.favorite) ringPoints(p, false);
        const spr = planetSprites.current.get(p.id);
        if (spr) bctx.drawImage(spr, Math.round(x - spr.width / 2), Math.round(y - spr.height / 2));
        if (p.favorite) ringPoints(p, true);
        // 최근 2주에 한 게임: 행성 위 깜빡이는 신호등
        if (p.recent && Math.floor(now / 450) % 2 === 0) {
          bctx.fillStyle = '#7dffb2';
          bctx.fillRect(Math.round(x) - 1, Math.round(y - p.r - 5), 2, 2);
        }
      }

      // 선택 표시: 가리킨 행성·목표 행성·도킹 행성에 모서리 괄호
      const bracket = (p: Planet, color: string) => {
        const pad = p.r + 4 + (Math.floor(now / 250) % 2);
        const x = Math.round(p.x + ox);
        const y = Math.round(p.y + oy);
        bctx.fillStyle = color;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          bctx.fillRect(x + sx * pad - (sx > 0 ? 2 : 0), y + sy * pad, 3, 1);
          bctx.fillRect(x + sx * pad, y + sy * pad - (sy > 0 ? 2 : 0), 1, 3);
        }
      };
      const apTarget = autopilot.current?.planetId ? wld.planetById.get(autopilot.current.planetId) : undefined;
      if (apTarget) bracket(apTarget, '#7fd8ff');
      const hovered = hoverRef.current ? wld.planetById.get(hoverRef.current) : undefined;
      if (hovered && hovered !== apTarget) bracket(hovered, 'rgba(255,255,255,0.75)');
      if (docked) bracket(docked, '#7dffb2');
      else if (near) bracket(near, '#ffd479');

      // 자동 비행 목표 (빈 공간): 점선 십자
      if (autopilot.current && !apTarget) {
        const x = Math.round(autopilot.current.x + ox);
        const y = Math.round(autopilot.current.y + oy);
        bctx.fillStyle = '#7fd8ff';
        for (let i = 2; i < 6; i += 1) {
          bctx.fillRect(x + i, y, 1, 1);
          bctx.fillRect(x - i, y, 1, 1);
          bctx.fillRect(x, y + i, 1, 1);
          bctx.fillRect(x, y - i, 1, 1);
        }
      }

      // 불꽃
      for (const p of particles) {
        bctx.fillStyle = p.life > 0.6 ? '#ffe08a' : p.life > 0.3 ? '#ff9e7a' : '#b24a5a';
        bctx.fillRect(Math.round(p.x + ox), Math.round(p.y + oy), 1, 1);
      }

      // 탐사선: 16방향으로 끊어 돌려 도트가 뭉개지지 않게
      if (!(warpT > 0.35 && warpT < 0.65)) {
        const snap = Math.round(s.angle / (Math.PI / 8)) * (Math.PI / 8);
        bctx.save();
        bctx.translate(Math.round(s.x + ox), Math.round(s.y + oy));
        bctx.rotate(snap);
        bctx.drawImage(ship, -Math.floor(SHIP_SIZE / 2), -Math.floor(SHIP_SIZE / 2));
        bctx.restore();
      }

      // 화면 가장자리를 디더링으로 어둡게 (비네트)
      bctx.fillStyle = '#04050b';
      for (let y = 0; y < H; y += 1) {
        for (const edge of [0, 1]) {
          for (let i = 0; i < 6; i++) {
            const x = edge ? W - 1 - i : i;
            if (bayer(x, y) < (6 - i) / 9) bctx.fillRect(x, y, 1, 1);
          }
        }
      }

      // 워프 섬광
      if (warpT >= 0 && warpT < 1) {
        const flash = Math.max(0, 1 - Math.abs(warpT - 0.5) * 6);
        if (flash > 0) {
          bctx.fillStyle = `rgba(220,235,255,${flash * 0.8})`;
          bctx.fillRect(0, 0, W, H);
        }
      }

      // ── 키워서 화면에 ──
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(buffer, 0, 0, W * PX * dpr, H * PX * dpr);

      // ── 글자 (원래 해상도) ──
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const p of wld.planets) {
        const d = Math.hypot(p.x - s.x, p.y - s.y);
        const show = d < LABEL_RANGE || p.id === hoverRef.current || p.id === dockedRef.current || p === apTarget;
        if (!show) continue;
        const sx = (p.x + ox) * PX;
        const sy = (p.y + oy + p.r + 4) * PX;
        if (sx < -100 || sx > cssW + 100 || sy < -40 || sy > cssH + 40) continue;
        const fade = p.id === hoverRef.current || p.id === dockedRef.current ? 1 : Math.min(1, (LABEL_RANGE - d) / 50);
        ctx.globalAlpha = Math.max(0, fade);
        ctx.font = `11px ${PIXEL_FONT}`;
        const name = p.node.label.length > 26 ? `${p.node.label.slice(0, 25)}…` : p.node.label;
        const w = Math.ceil(ctx.measureText(name).width) + 10;
        ctx.fillStyle = 'rgba(4,5,11,0.78)';
        ctx.fillRect(Math.round(sx - w / 2), Math.round(sy), w, 28);
        ctx.fillStyle = '#eef1f8';
        ctx.fillText(name, Math.round(sx), Math.round(sy + 3));
        ctx.font = `9px ${PIXEL_FONT}`;
        ctx.fillStyle = p.color;
        ctx.fillText(formatHours(p.node.hours).toUpperCase(), Math.round(sx), Math.round(sy + 16));
      }
      ctx.globalAlpha = 1;

      // ── 미니맵 ──
      const mm = minimapRef.current;
      if (mm && frame % 2 === 0) {
        const mctx = mm.getContext('2d')!;
        const ap2 = autopilot.current;
        const apPlanet = ap2?.planetId ? wld.planetById.get(ap2.planetId) : undefined;
        drawMinimap(mctx, minimap, {
          ship: s,
          view: { w: W, h: H, cx: cam.x, cy: cam.y },
          target: apPlanet ? { x: apPlanet.x, y: apPlanet.y } : ap2 ? { x: ap2.x, y: ap2.y } : undefined,
          highlight: mapHoverRef.current ?? undefined,
          now,
        });
      }

      raf = requestAnimationFrame(step);
    };
    let raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
    };
  }, [ship, nebulae, minimap]);

  const near = nearId ? world.planetById.get(nearId) : undefined;
  const sector = sectorId !== null ? world.sectors.find((s) => s.id === sectorId) : undefined;

  return (
    <div ref={containerRef} className="relative h-full overflow-hidden bg-[#04050b] select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ imageRendering: 'pixelated' }} />

      {/* 섹터 진입 배너 */}
      {sector && (
        <div key={sector.id} className="voyage-banner pointer-events-none absolute left-1/2 top-[13%] -translate-x-1/2 text-center">
          <div className="font-pixel text-[10px] tracking-[0.3em]" style={{ color: sector.color }}>
            SECTOR {String(world.sectors.indexOf(sector) + 1).padStart(2, '0')}
          </div>
          <div className="font-pixel mt-2 text-[30px] leading-none text-white [text-shadow:3px_3px_0_#04050b]">{sector.primary.toUpperCase()}</div>
          {sector.secondary && (
            <div className="font-pixel mt-2 text-[13px] [text-shadow:2px_2px_0_#04050b]" style={{ color: sector.color }}>
              {sector.secondary}
            </div>
          )}
          <div className="font-pixel mt-2 text-[9px] tracking-[0.2em] text-white/45">
            {sector.planets.length} PLANETS · {Math.round(sector.hours).toLocaleString()} H
          </div>
        </div>
      )}

      {/* 좌상단: 항로 지도(워프) */}
      <div className="absolute left-4 top-4 z-10 w-[230px] border-2 border-white/10 bg-[#070912]/90 p-3 [box-shadow:4px_4px_0_rgba(0,0,0,0.5)]">
        <div className="font-pixel text-[9px] tracking-[0.25em] text-white/40">WARP MAP</div>
        <div className="mt-1 text-[13px] font-semibold text-white">취향 섹터</div>
        <ul className="mt-2.5 space-y-0.5">
          {world.sectors.map((s, i) => {
            const here = s.id === sectorId;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => warpToSector(i)}
                  className={`flex w-full items-center gap-2 px-1.5 py-1 text-left transition ${here ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'}`}
                >
                  <span className="font-pixel w-3 text-[9px] text-white/35">{i < 9 ? i + 1 : ''}</span>
                  <span className="h-2 w-2 shrink-0" style={{ background: s.color }} />
                  <span className={`min-w-0 flex-1 truncate text-[11.5px] ${here ? 'text-white' : 'text-white/70'}`}>{s.name}</span>
                  <span className="font-pixel text-[9px] text-white/35">{s.planets.length}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 우상단: 계기판 */}
      <div className="font-pixel pointer-events-none absolute right-4 top-4 z-10 text-right text-[9px] leading-[1.9] tracking-[0.18em] text-white/45">
        <div>
          X <span className="text-white/80">{hud.x}</span> · Y <span className="text-white/80">{hud.y}</span>
        </div>
        <div>
          SPD <span className="text-white/80">{hud.speed}</span>
        </div>
      </div>

      {/* 하단 중앙: 도킹 안내 */}
      {near && !dockedId && (
        <div className="pointer-events-none absolute bottom-16 left-1/2 z-10 -translate-x-1/2">
          <div className="flex items-center gap-2.5 border-2 border-[#ffd479]/60 bg-[#070912]/95 px-3 py-2 [box-shadow:4px_4px_0_rgba(0,0,0,0.5)]">
            <span className="font-pixel animate-pulse border border-[#ffd479] px-1.5 py-0.5 text-[10px] text-[#ffd479]">E</span>
            <span className="text-[12.5px] text-white">
              도킹 · <span className="font-semibold">{near.node.label}</span>
            </span>
          </div>
        </div>
      )}

      {/* 좌하단: 미니맵 */}
      {minimapOn && (
        <div className="absolute bottom-4 left-4 z-10 border-2 border-white/15 bg-[#070912]/92 p-2.5 [box-shadow:4px_4px_0_rgba(0,0,0,0.5)]">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="font-pixel text-[11px] tracking-[0.25em] text-white/60">MAP</span>
            <span className="max-w-[300px] truncate text-[12.5px] font-medium" style={{ color: mapHover?.color ?? 'rgba(255,255,255,0.45)' }}>
              {mapHover ? mapHover.node.label : 'M 키로 숨기기'}
            </span>
          </div>
          <div className="relative" style={{ width: MW * MAP_SCALE, height: MH * MAP_SCALE }}>
          <canvas
            ref={minimapRef}
            width={MW}
            height={MH}
            className="block cursor-crosshair"
            style={{ width: MW * MAP_SCALE, height: MH * MAP_SCALE, imageRendering: 'pixelated' }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const w = minimap.toWorld(((e.clientX - rect.left) / rect.width) * MW, ((e.clientY - rect.top) / rect.height) * MH);
              // 미니맵 몇 칸 안에 있는 가장 가까운 행성
              let best: Planet | null = null;
              let bestD = 4 / minimap.scale;
              for (const p of world.planets) {
                const d = Math.hypot(p.x - w.x, p.y - w.y);
                if (d < bestD) {
                  best = p;
                  bestD = d;
                }
              }
              mapHoverRef.current = best;
              setMapHover(best);
            }}
            onMouseLeave={() => {
              mapHoverRef.current = null;
              setMapHover(null);
            }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const w = minimap.toWorld(((e.clientX - rect.left) / rect.width) * MW, ((e.clientY - rect.top) / rect.height) * MH);
              setDockedId(null);
              autopilot.current = mapHoverRef.current ? { x: mapHoverRef.current.x, y: mapHoverRef.current.y, planetId: mapHoverRef.current.id } : w;
            }}
          />
          {/* 섹터 이름표: 번호(워프 키) + 대표 장르. 성운 바로 아래 */}
          {world.sectors.map((s, i) => {
            const c = minimap.toMap(s.x, s.y);
            const r = s.r * minimap.scale;
            const here = s.id === sectorId;
            return (
              <div
                key={s.id}
                className="font-pixel pointer-events-none absolute flex -translate-x-1/2 items-center gap-1 whitespace-nowrap text-[11px] leading-none tracking-[0.06em] [text-shadow:1px_1px_0_#05060d,-1px_-1px_0_#05060d,1px_-1px_0_#05060d,-1px_1px_0_#05060d,2px_2px_0_#05060d]"
                style={{
                  left: Math.min(MW * MAP_SCALE - 50, Math.max(50, c.x * MAP_SCALE)),
                  top: Math.min(MH * MAP_SCALE - 12, (c.y + r * 0.9) * MAP_SCALE + 3),
                  color: s.color,
                  opacity: here ? 1 : 0.8,
                }}
              >
                {i < 9 && <span className="text-white/60">{i + 1}</span>}
                <span className={here ? 'text-white' : undefined}>{s.primary.length > 12 ? `${s.primary.slice(0, 11)}…` : s.primary}</span>
              </div>
            );
          })}
          </div>
        </div>
      )}

      {/* 상단 가운데: 조작 안내 (미니맵·도킹 패널과 겹치지 않는 자리) */}
      <div className="pointer-events-none absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-4 whitespace-nowrap border-2 border-white/10 bg-[#070912]/85 px-4 py-2 [box-shadow:4px_4px_0_rgba(0,0,0,0.5)]">
        {CONTROLS.map(([key, label]) => (
          <span key={key} className="flex items-center gap-1.5">
            <kbd className="font-pixel border border-white/30 border-b-2 bg-white/[0.07] px-1.5 py-[3px] text-[11px] leading-none text-white/90">{key}</kbd>
            <span className="text-[12.5px] text-white/70">{label}</span>
          </span>
        ))}
      </div>

      {/* 우측: 도킹한 행성 정보 */}
      {dockedId && world.planetById.get(dockedId) && (
        <aside className="fade-up absolute bottom-4 right-4 top-16 z-10 flex w-[340px] flex-col overflow-hidden border-2 border-[#7dffb2]/40 bg-[#070912]/95 [box-shadow:4px_4px_0_rgba(0,0,0,0.5)]">
          <div className="flex items-center justify-between border-b-2 border-white/[0.06] px-3 py-2">
            <span className="font-pixel text-[9px] tracking-[0.25em] text-[#7dffb2]">DOCKED</span>
            <button type="button" onClick={() => setDockedId(null)} className="font-pixel text-[9px] tracking-[0.2em] text-white/50 hover:text-white">
              출항 [E]
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <NodeDetail
              graph={graph}
              nodeId={dockedId}
              compact
              onSelect={(id) => (world.planetById.has(id) ? flyToPlanet(id) : onOpenInExplorer(id))}
              actions={
                <button
                  type="button"
                  onClick={() => onOpenInExplorer(dockedId)}
                  className="w-full border border-white/10 px-3 py-2 text-left text-[12px] text-white/80 hover:bg-white/[0.05]"
                >
                  그래프 탐색기에서 관계 보기 →
                </button>
              }
            />
          </div>
        </aside>
      )}
    </div>
  );
}
