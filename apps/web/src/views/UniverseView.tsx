import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-3d';
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PLAY_STATUS, steamImage, type OntologyGraph, type PlayStatus, type TasteCluster } from '@steamverse/shared';
import { NodeDetail } from '../components/NodeDetail';
import { formatHours } from '../lib/format';
import {
  additiveSprite,
  createGalaxyDisc,
  createStarfield,
  galaxyCenter,
  mulberry32,
  nebulaTexture,
  noPick,
  reticleTexture,
  starLocalPosition,
  starTexture,
  type PointsUniforms,
} from '../lib/cosmos';

interface Props {
  graph: OntologyGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpenInExplorer: (id: string) => void;
}

type Star = {
  id: string;
  kind: 'core' | 'game';
  label: string;
  cluster: number;
  hours: number;
  status?: PlayStatus;
  recent?: boolean;
  appid?: number;
  /** 스프라이트 크기 (월드 단위) */
  scale: number;
};
type Lane = { cluster: number };
type StarNode = NodeObject<Star>;
type LaneLink = LinkObject<Star, Lane>;
type FG = ForceGraphMethods<StarNode, LaneLink>;

interface Galaxy {
  cluster: TasteCluster;
  center: THREE.Vector3;
  radius: number;
  tilt: THREE.Euler;
  arms: number;
  color: THREE.Color;
  hex: string;
}

const PALETTE = ['#7aa2ff', '#ff8fb1', '#6fe3c1', '#f6c177', '#b69cff', '#ff9e7a', '#7fd8ff', '#e0a3ff', '#c3e88d', '#ffb38a'];
const OTHER = '#9aa3b5';
// 비스듬히 내려다보는 지도형 시점
/** 시점 중심에서 카메라까지의 오프셋 */
const HOME_OFFSET = { x: 0, y: 1650, z: 1480 };
/** 이 거리 안으로 들어온 별은 이름을 자동으로 보여준다 */
const LABEL_DISTANCE = 560;
/** 시점 중심이 우주 밖으로 벗어나지 않게 */
const PAN_LIMIT = 1400;

function idOf(end: LaneLink['source']): string {
  return typeof end === 'object' ? String(end?.id) : String(end);
}

export function UniverseView({ graph, selectedId, onSelect, onOpenInExplorer }: Props) {
  const fgRef = useRef<FG | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const initializedFor = useRef<FG | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [autoRotate, setAutoRotate] = useState(false);
  const [focusCluster, setFocusCluster] = useState<number | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const css2d = useMemo(() => {
    const r = new CSS2DRenderer();
    r.domElement.style.pointerEvents = 'none';
    return r;
  }, []);
  const extraRenderers = useMemo(() => [css2d], [css2d]);

  // ── 은하·별 배치 (결정적) ───────────────────────────────────
  const { galaxies, data, ORIGIN, HOME } = useMemo(() => {
    const n = graph.clusters.length;
    const galaxies: Galaxy[] = graph.clusters.map((c, i) => {
      const rand = mulberry32(100 + i);
      const hex = c.name === '기타 취향' ? OTHER : PALETTE[i % PALETTE.length]!;
      return {
        cluster: c,
        center: galaxyCenter(i, n, 1000),
        radius: 70 + Math.sqrt(c.gameIds.length) * 26,
        tilt: new THREE.Euler((rand() - 0.5) * 0.9, rand() * Math.PI * 2, (rand() - 0.5) * 0.9),
        arms: c.gameIds.length >= 8 ? 3 : 2,
        color: new THREE.Color(hex),
        hex,
      };
    });

    const nodes: StarNode[] = [];
    for (const g of galaxies) {
      const { x, y, z } = g.center;
      nodes.push({
        id: `core:${g.cluster.id}`,
        kind: 'core',
        label: g.cluster.name,
        cluster: g.cluster.id,
        hours: g.cluster.hours,
        scale: g.radius,
        x, y, z, fx: x, fy: y, fz: z,
      });
      const rand = mulberry32(500 + g.cluster.id);
      const games = g.cluster.gameIds.map((id) => graph.nodeById.get(id)!).sort((a, b) => b.hours - a.hours);
      games.forEach((gn, rank) => {
        const p = starLocalPosition(rank, games.length, g.radius, g.arms, rand).applyEuler(g.tilt).add(g.center);
        const status = gn.game!.status;
        nodes.push({
          id: gn.id,
          kind: 'game',
          label: gn.label,
          cluster: g.cluster.id,
          hours: gn.hours,
          status,
          recent: gn.game!.hours2w > 0,
          appid: gn.game!.appid,
          scale: status === 'backlog' ? 8 : 10 + Math.sqrt(gn.hours) * 0.8,
          x: p.x, y: p.y, z: p.z, fx: p.x, fy: p.y, fz: p.z,
        });
      });
    }
    const links: LaneLink[] = graph.edges
      .filter((e) => e.rel === 'similarTo')
      .map((e) => ({ source: e.source, target: e.target, cluster: graph.nodeById.get(e.source)?.cluster ?? 0 }));
    // 전체 보기의 중심 = 은하 중심들의 가운데
    const xs = galaxies.map((g) => g.center.x);
    const zs = galaxies.map((g) => g.center.z);
    const ORIGIN = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: 0, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
    const HOME = { x: ORIGIN.x + HOME_OFFSET.x, y: HOME_OFFSET.y, z: ORIGIN.z + HOME_OFFSET.z };
    return { galaxies, data: { nodes, links }, ORIGIN, HOME };
  }, [graph]);

  const nodeById = useMemo(() => new Map(data.nodes.map((n) => [n.id as string, n])), [data]);

  // ── 3D 객체 (한 번 생성) ────────────────────────────────────
  const scene = useMemo(() => {
    const objects = new Map<string, THREE.Object3D>();
    const labels = new Map<string, HTMLElement>();
    const galaxyLabels = new Map<number, HTMLElement>();
    const uniforms: PointsUniforms[] = [];
    const orbits: { pivot: THREE.Object3D; speed: number }[] = [];

    for (const g of galaxies) {
      const group = new THREE.Group();
      const disc = createGalaxyDisc(g.radius, g.color, 900 + g.cluster.id, g.arms);
      const discHolder = new THREE.Group();
      discHolder.rotation.copy(g.tilt);
      discHolder.add(disc.points);
      group.add(discHolder);
      uniforms.push(disc.uniforms);

      group.add(noPick(additiveSprite(starTexture(false), g.color.clone().lerp(new THREE.Color('#fff7ea'), 0.5), 0.22, g.radius * 0.26)));
      for (let k = 0; k < 2; k++) {
        const neb = noPick(additiveSprite(nebulaTexture(g.cluster.id * 3 + k), g.color, 0.06, g.radius * (2.6 + k * 0.8)));
        neb.position.set((k - 0.5) * g.radius * 0.4, 0, (0.5 - k) * g.radius * 0.3);
        group.add(neb);
      }
      // 클릭 판정용 투명 구
      group.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(g.radius * 0.2, 12, 12),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
        ),
      );

      const el = document.createElement('div');
      el.className = 'sv-galaxy-label';
      el.style.color = g.hex;
      el.style.setProperty('--g', g.hex);
      // 은하 이름은 대표 태그 두 개("Souls-like · Action RPG"): 첫째를 크게, 둘째를 작게
      const [primary, secondary] = g.cluster.name.split(' · ');
      el.innerHTML = `<div class="name"></div><div class="sub"></div><div class="meta"></div>`;
      el.querySelector('.name')!.textContent = primary;
      el.querySelector('.sub')!.textContent = secondary ?? '';
      el.querySelector('.meta')!.textContent = `${g.cluster.gameIds.length} games · ${Math.round(g.cluster.hours).toLocaleString()} h`;
      const label = new CSS2DObject(el);
      // 은하 한가운데
      label.center.set(0.5, 0.5);
      label.position.set(0, 0, 0);
      group.add(label);
      galaxyLabels.set(g.cluster.id, el);
      objects.set(`core:${g.cluster.id}`, group);
    }

    for (const n of data.nodes) {
      if (n.kind !== 'game') continue;
      const g = galaxies.find((x) => x.cluster.id === n.cluster)!;
      const group = new THREE.Group();
      const backlog = n.status === 'backlog';
      const favorite = n.status === 'favorite';
      const color = backlog
        ? new THREE.Color('#6b7488')
        : g.color.clone().lerp(new THREE.Color('#ffffff'), favorite ? 0.2 : n.recent ? 0.18 : 0.05);
      group.add(additiveSprite(starTexture(favorite), color, backlog ? 0.5 : 1, n.scale));

      if (n.recent) {
        // 최근 2주에 플레이: 기울어진 궤도 + 공전하는 위성
        const pivot = new THREE.Group();
        pivot.rotation.set(1.1 + (n.appid! % 7) * 0.05, 0, 0.3);
        const r = n.scale * 0.42;
        const pts = Array.from({ length: 97 }, (_, i) => {
          const a = (i / 96) * Math.PI * 2;
          return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
        });
        pivot.add(
          noPick(
            new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(pts),
              new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.32, depthWrite: false }),
            ),
          ),
        );
        const spinner = new THREE.Group();
        const moon = noPick(additiveSprite(starTexture(false), '#ffffff', 1, n.scale * 0.22));
        moon.position.set(r, 0, 0);
        spinner.add(moon);
        pivot.add(spinner);
        group.add(pivot);
        orbits.push({ pivot: spinner, speed: 0.5 + (n.appid! % 5) * 0.08 });
      }

      const el = document.createElement('div');
      el.className = 'sv-star-label';
      el.innerHTML = `<div class="n"></div><div class="m"></div>`;
      el.querySelector('.n')!.textContent = n.label;
      el.querySelector('.m')!.textContent = `${formatHours(n.hours)} · ${PLAY_STATUS[n.status!].label.ko}`;
      const label = new CSS2DObject(el);
      label.center.set(0, 0.5);
      group.add(label);
      labels.set(n.id as string, el);
      objects.set(n.id as string, group);
    }
    return { objects, labels, galaxyLabels, uniforms, orbits };
  }, [data, galaxies]);

  const nodeThreeObject = useCallback((n: StarNode) => scene.objects.get(n.id as string)!, [scene]);

  // ── 크기 추적 ────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry!.contentRect;
      setSize({ width: Math.floor(r.width), height: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selectedGame = selectedId && nodeById.get(selectedId)?.kind === 'game' ? selectedId : null;
  const stateRef = useRef({ selected: selectedGame });
  stateRef.current.selected = selectedGame;

  // ── 장면 초기화: 블룸, 배경, 카메라, 애니메이션 루프 ───────────
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || initializedFor.current === fg) return;
    initializedFor.current = fg;

    fg.postProcessingComposer().addPass(new UnrealBloomPass(new THREE.Vector2(size.width, size.height), 0.5, 0.5, 0.48));

    const three = fg.scene();
    const starfield = createStarfield();
    three.add(starfield.points);

    // 아주 먼 배경 성운
    (
      [
        ['#2a3f8f', new THREE.Vector3(-2400, 600, -2600)],
        ['#5b2d7a', new THREE.Vector3(2600, -300, -1800)],
        ['#174f63', new THREE.Vector3(600, 900, 2900)],
      ] as const
    ).forEach(([color, pos], i) => {
      const neb = noPick(additiveSprite(nebulaTexture(77 + i), color, 0.1, 4200));
      neb.position.copy(pos);
      three.add(neb);
    });

    const reticle = noPick(
      new THREE.Sprite(new THREE.SpriteMaterial({ map: reticleTexture(), color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false })),
    );
    reticle.visible = false;
    three.add(reticle);

    const camera = fg.camera() as THREE.PerspectiveCamera;
    camera.fov = 38;
    camera.far = 20000;
    camera.updateProjectionMatrix();

    const controls = fg.controls() as OrbitControls;
    // 지도처럼: 왼쪽 드래그 = 이동, 오른쪽 드래그 = 회전, 휠 = 커서 쪽으로 확대
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.screenSpacePanning = false;
    controls.zoomToCursor = true;
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.panSpeed = 1;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 1.2;
    controls.minDistance = 40;
    controls.maxDistance = 3600;
    controls.minPolarAngle = Math.PI * 0.08;
    controls.maxPolarAngle = Math.PI * 0.42;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0.25;
    const stopAuto = () => setAutoRotate(false);
    controls.addEventListener('start', stopAuto);

    // 시작 연출: 멀리서 천천히 다가간다
    fg.cameraPosition({ x: HOME.x, y: HOME.y * 1.9, z: HOME.z * 1.9 }, ORIGIN, 0);
    const intro = window.setTimeout(() => fg.cameraPosition(HOME, ORIGIN, 3200), 60);

    let frame = 0;
    const clock = new THREE.Clock();
    const camPos = new THREE.Vector3();
    const starPos = new THREE.Vector3();
    const near = new Map<string, boolean>();
    const inside = new Map<number, boolean>();
    let overview: boolean | null = null;
    const loop = () => {
      const t = clock.getElapsedTime();
      // 시점 중심 제한
      const tg = controls.target;
      const r = Math.hypot(tg.x, tg.z);
      if (r > PAN_LIMIT) {
        const k = PAN_LIMIT / r;
        const dx = tg.x * k - tg.x;
        const dz = tg.z * k - tg.z;
        tg.x += dx;
        tg.z += dz;
        camera.position.x += dx;
        camera.position.z += dz;
      }
      // 거리 기반 라벨: 가까운 별은 이름을 보이고, 들어가 있는 은하의 이름은 흐리게
      camPos.copy(camera.position);
      for (const [id, el] of scene.labels) {
        const n = nodeById.get(id);
        if (!n || n.x === undefined) continue;
        const isNear = camPos.distanceTo(starPos.set(n.x, n.y!, n.z!)) < LABEL_DISTANCE;
        if (near.get(id) !== isNear) {
          near.set(id, isNear);
          el.classList.toggle('is-cam', isNear);
        }
      }
      let anyInside = false;
      for (const g of galaxies) {
        const isIn = camPos.distanceTo(g.center) < g.radius * 3.4;
        anyInside ||= isIn;
        if (inside.get(g.cluster.id) !== isIn) {
          inside.set(g.cluster.id, isIn);
          scene.galaxyLabels.get(g.cluster.id)?.classList.toggle('is-inside', isIn);
        }
      }
      // 멀리서 볼 때는 은하 이름만, 은하 안으로 들어가면 별 이름만 보이게 한다
      if (overview !== !anyInside) {
        overview = !anyInside;
        css2d.domElement.classList.toggle('sv-overview', overview);
      }
      starfield.uniforms.uTime.value = t;
      for (const u of scene.uniforms) u.uTime.value = t;
      for (const o of scene.orbits) o.pivot.rotation.y = t * o.speed;
      const sel = stateRef.current.selected;
      const node = sel ? nodeById.get(sel) : undefined;
      if (node && node.x !== undefined) {
        reticle.visible = true;
        reticle.position.set(node.x, node.y!, node.z!);
        const s = node.scale * 0.62 * (1 + Math.sin(t * 2.4) * 0.04);
        reticle.scale.set(s, s, 1);
        reticle.material.rotation = t * 0.35;
      } else {
        reticle.visible = false;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(intro);
      controls.removeEventListener('start', stopAuto);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const controls = fgRef.current?.controls() as OrbitControls | undefined;
    if (controls) controls.autoRotate = autoRotate;
  }, [autoRotate]);

  // ── 라벨 표시 상태 ───────────────────────────────────────────
  const focus = hovered ?? selectedGame;
  const neighbors = useMemo(() => {
    if (!focus) return new Set<string>();
    return new Set(
      (graph.adjacency.get(focus) ?? [])
        .filter((e) => e.rel === 'similarTo')
        .map((e) => (e.source === focus ? e.target : e.source)),
    );
  }, [graph, focus]);
  const topStars = useMemo(
    () => new Set(data.nodes.filter((n) => n.kind === 'game').sort((a, b) => b.hours - a.hours).slice(0, 6).map((n) => n.id as string)),
    [data],
  );
  useEffect(() => {
    for (const [id, el] of scene.labels) {
      el.classList.toggle('is-active', id === focus || id === selectedGame);
      el.classList.toggle('is-near', neighbors.has(id) || (!focus && focusCluster !== null && nodeById.get(id)?.cluster === focusCluster));
      el.classList.toggle('is-dim', !focus && topStars.has(id));
    }
  }, [scene, focus, selectedGame, neighbors, topStars, focusCluster, nodeById]);

  // ── 연결선: 평소엔 거의 안 보이게, 초점 별의 관계만 빛나게 ─────
  const materials = useMemo(() => {
    const faint = new THREE.LineBasicMaterial({ color: '#9fb6ff', transparent: true, opacity: 0.04, depthWrite: false });
    const bright = new Map(
      galaxies.map((g) => [
        g.cluster.id,
        new THREE.LineBasicMaterial({ color: g.color, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }),
      ]),
    );
    return { faint, bright };
  }, [galaxies]);
  const linkMaterial = useCallback(
    (l: LaneLink) => {
      const s = idOf(l.source);
      const t = idOf(l.target);
      if (focus && (s === focus || t === focus)) {
        return materials.bright.get(nodeById.get(focus)?.cluster ?? l.cluster) ?? materials.faint;
      }
      return materials.faint;
    },
    [focus, materials, nodeById],
  );

  // ── 카메라 이동 ──────────────────────────────────────────────
  const flyTo = useCallback((node: StarNode, distance: number) => {
    const fg = fgRef.current;
    if (!fg || node.x === undefined) return;
    const p = new THREE.Vector3(node.x, node.y, node.z);
    // 지금 보고 있는 방향을 유지한 채 거리만 바꿔 다가간다
    const controls = fg.controls() as OrbitControls;
    const dir = fg.camera().position.clone().sub(controls.target).normalize();
    if (dir.lengthSq() === 0) dir.set(0, 0.74, 0.67);
    const cam = p.clone().add(dir.multiplyScalar(distance));
    fg.cameraPosition({ x: cam.x, y: cam.y, z: cam.z }, { x: p.x, y: p.y, z: p.z }, 1100);
  }, []);

  const handleClick = (node: StarNode) => {
    setAutoRotate(false);
    if (node.kind === 'core') {
      setFocusCluster(node.cluster);
      onSelect(null);
      flyTo(node, node.scale * 3.4);
    } else {
      setFocusCluster(null);
      onSelect(node.id as string);
      flyTo(node, 140 + node.scale * 3);
    }
  };

  // 다른 화면에서 고른 게임으로 이동
  useEffect(() => {
    if (!selectedGame) return;
    const t = window.setTimeout(() => {
      const node = nodeById.get(selectedGame);
      if (node) flyTo(node, 140 + node.scale * 3);
    }, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGame]);

  const resetView = () => {
    onSelect(null);
    setFocusCluster(null);
    fgRef.current?.cameraPosition(HOME, ORIGIN, 1300);
  };

  /** 선택한 게임 → 그 은하 → 전체 순서로 한 단계씩 물러난다 */
  const goBack = () => {
    if (selectedGame) {
      const n = nodeById.get(selectedGame);
      const core = n ? nodeById.get(`core:${n.cluster}`) : undefined;
      if (core) handleClick(core);
      else resetView();
    } else if (focusCluster !== null) {
      resetView();
    }
  };
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (e.target as HTMLElement | null)?.tagName !== 'INPUT') goBackRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** 버튼 확대/축소: 보고 있는 지점을 기준으로 거리만 조절 */
  const zoomBy = (factor: number) => {
    const fg = fgRef.current;
    if (!fg) return;
    const controls = fg.controls() as OrbitControls;
    const t = controls.target.clone();
    const offset = fg.camera().position.clone().sub(t);
    const d = THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
    const cam = t.clone().add(offset.setLength(d));
    fg.cameraPosition({ x: cam.x, y: cam.y, z: cam.z }, { x: t.x, y: t.y, z: t.z }, 350);
  };

  const selectedNode = selectedGame ? nodeById.get(selectedGame) : undefined;
  const crumbGalaxy = selectedNode
    ? galaxies.find((g) => g.cluster.id === selectedNode.cluster)
    : focusCluster !== null
      ? galaxies.find((g) => g.cluster.id === focusCluster)
      : undefined;

  const totalHours = graph.clusters.reduce((s, c) => s + c.hours, 0);
  const galaxy = focusCluster !== null ? galaxies.find((g) => g.cluster.id === focusCluster) : null;

  return (
    <div ref={wrapRef} className="grain relative h-full w-full overflow-hidden bg-[#020309]">
      <div className="absolute inset-0 z-0">
      <ForceGraph3D<Star, Lane>
        ref={fgRef as React.MutableRefObject<FG | undefined>}
        width={size.width}
        height={size.height}
        graphData={data}
        extraRenderers={extraRenderers}
        backgroundColor="#020309"
        controlType="orbit"
        showNavInfo={false}
        nodeThreeObject={nodeThreeObject}
        nodeLabel={() => ''}
        linkMaterial={linkMaterial}
        linkWidth={0}
        enableNodeDrag={false}
        warmupTicks={1}
        cooldownTicks={1}
        onNodeHover={(n: StarNode | null) => setHovered(n && n.kind === 'game' ? (n.id as string) : null)}
        onNodeClick={handleClick}
        onBackgroundClick={() => {
          onSelect(null);
          setFocusCluster(null);
        }}
      />
      </div>

      <div className="vignette pointer-events-none absolute inset-0 z-[1]" />

      {/* ── 왼쪽 위: 은하 목록 ── */}
      <div className="glass fade-up absolute top-5 left-5 z-10 w-[272px] rounded-2xl p-5">
        <div className="eyebrow">Taste Galaxies</div>
        <h2 className="mt-1.5 text-[17px] font-semibold tracking-tight text-white">취향 은하</h2>
        <p className="mt-1.5 text-[12px] leading-relaxed text-white/45">
          태그가 비슷한 게임을 묶은 {graph.clusters.length}개의 은하. 많이 플레이한 게임일수록 중심 가까이 빛납니다.
        </p>
        <ul className="mt-4 flex flex-col">
          {galaxies.map((g) => {
            const share = g.cluster.hours / totalHours;
            const active = focusCluster === g.cluster.id;
            return (
              <li key={g.cluster.id}>
                <button
                  onClick={() => {
                    const node = nodeById.get(`core:${g.cluster.id}`);
                    if (node) handleClick(node);
                  }}
                  className={`group w-full rounded-lg px-2 py-[7px] text-left transition ${active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="size-[7px] shrink-0 rounded-full" style={{ background: g.hex, boxShadow: `0 0 10px ${g.hex}` }} />
                    <span className="flex-1 truncate text-[12.5px] text-white/80 group-hover:text-white">{g.cluster.name}</span>
                    <span className="num font-mono text-[10.5px] text-white/35">{g.cluster.gameIds.length}</span>
                  </div>
                  <div className="mt-1.5 ml-[17px] h-px bg-white/[0.06]">
                    <div className="h-px" style={{ width: `${Math.max(3, share * 100 * 2.2)}%`, background: g.hex, opacity: 0.7 }} />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ── 왼쪽 아래: 범례 ── */}
      <div className="glass fade-up absolute bottom-5 left-5 z-10 flex items-center gap-5 rounded-xl px-4 py-3">
        <Legend icon={<StarIcon spikes />} label="인생작" />
        <Legend icon={<StarIcon />} label="플레이" />
        <Legend icon={<OrbitIcon />} label="최근 2주" />
        <Legend icon={<StarIcon dim />} label="백로그" />
        <span className="h-4 w-px bg-white/10" />
        <span className="eyebrow !text-[9px]">크기 = 플레이 시간</span>
      </div>

      {/* ── 오른쪽 위: 컨트롤 ── */}
      {/* ── 위 가운데: 현재 위치 ── */}
      <nav className="glass absolute top-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full px-2 py-1.5 text-[12px]">
        <button
          onClick={resetView}
          className={`rounded-full px-2.5 py-1 transition ${crumbGalaxy ? 'text-white/45 hover:text-white' : 'text-white'}`}
        >
          전체 우주
        </button>
        {crumbGalaxy && (
          <>
            <span className="text-white/20">/</span>
            <button
              onClick={() => {
                const core = nodeById.get(`core:${crumbGalaxy.cluster.id}`);
                if (core) handleClick(core);
              }}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 transition ${selectedNode ? 'text-white/45 hover:text-white' : 'text-white'}`}
            >
              <span className="size-[6px] rounded-full" style={{ background: crumbGalaxy.hex }} />
              {crumbGalaxy.cluster.name}
            </button>
          </>
        )}
        {selectedNode && (
          <>
            <span className="text-white/20">/</span>
            <span className="max-w-[220px] truncate px-2.5 py-1 text-white">{selectedNode.label}</span>
          </>
        )}
        {crumbGalaxy && (
          <span className="ml-1 rounded-md border border-white/10 px-1.5 py-px font-mono text-[9.5px] text-white/35">ESC</span>
        )}
      </nav>

      <div className="absolute top-5 right-5 z-10 flex gap-2">
        <div className="glass flex overflow-hidden rounded-xl">
          <button title="확대" aria-label="확대" onClick={() => zoomBy(0.6)} className="grid size-10 place-items-center text-white/70 transition hover:bg-white/[0.06] hover:text-white">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 5v10M5 10h10" strokeLinecap="round" /></svg>
          </button>
          <span className="w-px bg-white/[0.08]" />
          <button title="축소" aria-label="축소" onClick={() => zoomBy(1.6)} className="grid size-10 place-items-center text-white/70 transition hover:bg-white/[0.06] hover:text-white">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 10h10" strokeLinecap="round" /></svg>
          </button>
        </div>
        <IconButton title={autoRotate ? '회전 멈춤' : '자동 회전'} onClick={() => setAutoRotate((v) => !v)}>
          {autoRotate ? (
            <path d="M7 5v10M13 5v10" strokeLinecap="round" />
          ) : (
            <path d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9M15.5 4v3h-3" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </IconButton>
        <IconButton title="전체 보기" onClick={resetView}>
          <path d="M4 7V4h3M16 7V4h-3M4 13v3h3M16 13v3h-3" strokeLinecap="round" strokeLinejoin="round" />
        </IconButton>
      </div>

      {/* ── 오른쪽: 선택 패널 ── */}
      {(selectedGame || galaxy) && (
        <div
          key={selectedGame ?? `g${galaxy?.cluster.id}`}
          className="glass sv-scroll fade-up absolute top-[76px] right-5 bottom-5 z-10 w-[340px] overflow-y-auto rounded-2xl p-4"
        >
          {selectedGame ? (
            <NodeDetail
              graph={graph}
              nodeId={selectedGame}
              compact
              onSelect={(id) => {
                const node = nodeById.get(id);
                if (node) handleClick(node);
                else onOpenInExplorer(id);
              }}
              actions={
                <button
                  onClick={() => onOpenInExplorer(selectedGame)}
                  className="group flex w-full items-center justify-between rounded-xl bg-white/[0.06] px-4 py-2.5 text-[12.5px] font-medium text-white/85 ring-1 ring-white/10 transition hover:bg-white/[0.1] hover:text-white"
                >
                  그래프 탐색기에서 관계 보기
                  <span className="transition group-hover:translate-x-0.5">→</span>
                </button>
              }
            />
          ) : (
            galaxy && (
              <div className="flex flex-col gap-5">
                <div>
                  <div className="eyebrow" style={{ color: galaxy.hex }}>
                    Galaxy · {String(galaxy.cluster.id + 1).padStart(2, '0')}
                  </div>
                  <h2 className="mt-1.5 text-[20px] font-semibold tracking-tight text-white">{galaxy.cluster.name}</h2>
                  <div className="mt-4 grid grid-cols-3 divide-x divide-white/[0.07] rounded-xl bg-white/[0.03] py-3 ring-1 ring-white/[0.06]">
                    <Metric label="Games" value={String(galaxy.cluster.gameIds.length)} />
                    <Metric label="Hours" value={Math.round(galaxy.cluster.hours).toLocaleString()} />
                    <Metric label="Share" value={`${Math.round((galaxy.cluster.hours / totalHours) * 100)}%`} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {galaxy.cluster.topTags.map((t) => (
                      <span key={t} className="rounded-full px-2.5 py-1 text-[11px] text-white/60 ring-1 ring-white/10">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="eyebrow mb-2">Stars</div>
                  {galaxy.cluster.gameIds
                    .map((id) => graph.nodeById.get(id)!)
                    .sort((a, b) => b.hours - a.hours)
                    .map((n) => (
                      <button
                        key={n.id}
                        onClick={() => {
                          const node = nodeById.get(n.id);
                          if (node) handleClick(node);
                        }}
                        onMouseEnter={() => setHovered(n.id)}
                        onMouseLeave={() => setHovered(null)}
                        className="group flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left hover:bg-white/[0.05]"
                      >
                        <img src={steamImage(n.game!.appid, 'capsule')} alt="" className="h-[30px] w-[80px] rounded-md object-cover opacity-90 ring-1 ring-white/10 group-hover:opacity-100" />
                        <span className="flex-1 truncate text-[12.5px] text-white/80 group-hover:text-white">{n.label}</span>
                        <span className="num font-mono text-[10.5px] text-white/40">{formatHours(n.hours)}</span>
                      </button>
                    ))}
                </div>
              </div>
            )
          )}
        </div>
      )}

      <div className="eyebrow pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 !text-[9px] !text-white/25">
        Drag 이동 · Right-drag 회전 · Scroll 커서 쪽 확대 · Esc 뒤로
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 text-center">
      <div className="num text-[17px] font-semibold text-white">{value}</div>
      <div className="eyebrow mt-0.5 !text-[9px]">{label}</div>
    </div>
  );
}

function Legend({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-2 text-[11.5px] text-white/60">
      {icon}
      {label}
    </span>
  );
}

function StarIcon({ spikes, dim }: { spikes?: boolean; dim?: boolean }) {
  const id = `sg${spikes ? 's' : ''}${dim ? 'd' : ''}`;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16">
      <defs>
        <radialGradient id={id}>
          <stop offset="0" stopColor="#fff" stopOpacity={dim ? 0.5 : 1} />
          <stop offset="0.35" stopColor={dim ? '#6b7488' : '#9cb8ff'} stopOpacity={dim ? 0.4 : 0.7} />
          <stop offset="1" stopColor="#9cb8ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="8" cy="8" r={dim ? 4.5 : 7} fill={`url(#${id})`} />
      {spikes && <path d="M8 0.5v15M0.5 8h15" stroke="#fff" strokeOpacity="0.7" strokeWidth="0.8" />}
    </svg>
  );
}

function OrbitIcon() {
  return (
    <svg width="18" height="16" viewBox="0 0 18 16">
      <ellipse cx="9" cy="8" rx="8" ry="3.4" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="0.9" />
      <circle cx="9" cy="8" r="2.6" fill="#9cb8ff" />
      <circle cx="16.4" cy="7" r="1.3" fill="#fff" />
    </svg>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="glass grid size-10 place-items-center rounded-xl text-white/70 transition hover:text-white"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        {children}
      </svg>
    </button>
  );
}
