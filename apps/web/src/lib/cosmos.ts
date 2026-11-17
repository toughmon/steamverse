/**
 * 우주 뷰용 three.js 재료: 절차적 텍스처, 셰이더 점, 은하 원반, 은하·별 배치.
 * 모든 그림은 런타임에 캔버스·셰이더로 만든다 (이미지 에셋 없음).
 */
import * as THREE from 'three';

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 나선팔 감김 정도 (반지름 1당 회전 라디안) — 원반 입자와 별 배치가 같은 값을 쓴다 */
export const TWIST = 0.032;

// ─── 텍스처 ──────────────────────────────────────────────────────

const textureCache = new Map<string, THREE.Texture>();

function canvasTexture(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const cached = textureCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(key, tex);
  return tex;
}

/** 별: 작고 뜨거운 중심 + 부드러운 후광. spikes면 회절 빛줄기 추가 */
export function starTexture(spikes: boolean): THREE.Texture {
  return canvasTexture(`star:${spikes}`, 256, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.05, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.1)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.025)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    if (!spikes) return;
    const ray = (angle: number, length: number, width: number, alpha: number) => {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(angle);
      const lg = ctx.createLinearGradient(-length, 0, length, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(-length, -width / 2, length * 2, width);
      ctx.restore();
    };
    ray(0, c * 0.98, 2, 0.75);
    ray(Math.PI / 2, c * 0.98, 2, 0.75);
    ray(Math.PI / 4, c * 0.5, 1.2, 0.3);
    ray(-Math.PI / 4, c * 0.5, 1.2, 0.3);
  });
}

/** 선택 표시: 끊긴 원 + 눈금 */
export function reticleTexture(): THREE.Texture {
  return canvasTexture('reticle', 256, (ctx, s) => {
    const c = s / 2;
    const r = s * 0.42;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.arc(c, c, r, a + 0.18, a + Math.PI / 2 - 0.18);
      ctx.stroke();
    }
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * (r + 6), c + Math.sin(a) * (r + 6));
      ctx.lineTo(c + Math.cos(a) * (r + 18), c + Math.sin(a) * (r + 18));
      ctx.stroke();
    }
  });
}

/** 성운: 여러 겹의 흐릿한 얼룩 */
export function nebulaTexture(seed: number): THREE.Texture {
  return canvasTexture(`nebula:${seed}`, 256, (ctx, s) => {
    const rand = mulberry32(seed * 977 + 13);
    for (let i = 0; i < 14; i++) {
      const x = s * (0.3 + rand() * 0.4);
      const y = s * (0.3 + rand() * 0.4);
      const r = s * (0.12 + rand() * 0.3);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.08 + rand() * 0.12;
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
  });
}

export function additiveSprite(texture: THREE.Texture, color: THREE.ColorRepresentation, opacity: number, scale: number) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  sprite.scale.set(scale, scale, 1);
  return sprite;
}

/** 클릭·호버 판정에서 빼기 (장식용 객체) */
export function noPick<T extends THREE.Object3D>(obj: T): T {
  obj.raycast = () => {};
  return obj;
}

// ─── 셰이더 점 (배경 별, 은하 원반) ────────────────────────────

const POINT_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uAttenuation;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float twinkle = 0.72 + 0.28 * sin(uTime * (0.6 + fract(aPhase) * 1.4) + aPhase * 6.2831);
    vAlpha = twinkle;
    vColor = aColor;
    float size = uAttenuation > 0.0 ? aSize * (uAttenuation / -mv.z) : aSize;
    gl_PointSize = max(1.0, size * uPixelRatio);
  }
`;

const POINT_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a = a * a;
    gl_FragColor = vec4(vColor, a * vAlpha * uOpacity);
  }
`;

export type PointsUniforms = {
  uTime: { value: number };
  uPixelRatio: { value: number };
  uAttenuation: { value: number };
  uOpacity: { value: number };
};

function shaderPoints(
  positions: Float32Array,
  colors: Float32Array,
  sizes: Float32Array,
  phases: Float32Array,
  attenuation: number,
  opacity: number,
) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const uniforms: PointsUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    uAttenuation: { value: attenuation },
    uOpacity: { value: opacity },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return { points: noPick(new THREE.Points(geo, material)), uniforms };
}

/** 먼 배경 별: 크기·색온도가 다른 별들이 천천히 반짝인다 */
export function createStarfield(count = 7000) {
  const rand = mulberry32(2024);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const warm = new THREE.Color('#ffd9b0');
  const cool = new THREE.Color('#b8ccff');
  const white = new THREE.Color('#ffffff');
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const r = 1800 + rand() * 3200;
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.7;
    positions[i * 3 + 2] = r * Math.cos(phi);
    const t = rand();
    c.copy(white).lerp(t < 0.5 ? cool : warm, Math.abs(t - 0.5) * 1.2);
    const bright = 0.35 + Math.pow(rand(), 3) * 0.9;
    colors[i * 3] = c.r * bright;
    colors[i * 3 + 1] = c.g * bright;
    colors[i * 3 + 2] = c.b * bright;
    sizes[i] = 0.8 + Math.pow(rand(), 4) * 2.6;
    phases[i] = rand() * 10;
  }
  return shaderPoints(positions, colors, sizes, phases, 0, 1);
}

/** 나선 은하 원반 (로컬 좌표, XZ 평면) */
export function createGalaxyDisc(radius: number, color: THREE.Color, seed: number, arms: number) {
  const rand = mulberry32(seed);
  const count = Math.round(1400 + radius * 14);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const hot = new THREE.Color('#fff4e6');
  const dust = color.clone().multiplyScalar(0.55);
  const c = new THREE.Color();
  const gauss = () => (rand() + rand() + rand() - 1.5) / 1.5;

  for (let i = 0; i < count; i++) {
    let x: number;
    let y: number;
    let z: number;
    let t: number;
    if (i < count * 0.1) {
      // 중심 팽대부
      const r = Math.abs(gauss()) * radius * 0.16;
      const a = rand() * Math.PI * 2;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      y = gauss() * radius * 0.05;
      t = r / radius;
    } else {
      t = Math.pow(rand(), 0.85);
      const r = t * radius;
      const arm = i % arms;
      const spread = (0.18 + t * 0.5) * radius * 0.22;
      const angle = (arm * Math.PI * 2) / arms + r * TWIST;
      x = Math.cos(angle) * r + gauss() * spread;
      z = Math.sin(angle) * r + gauss() * spread;
      y = gauss() * (radius * 0.035) * (1 - t * 0.6);
    }
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    c.copy(hot).lerp(color, Math.min(1, t * 1.6)).lerp(dust, Math.max(0, t - 0.6));
    const bright = (t < 0.12 ? 0.22 : 1 - t * 0.45) * (0.55 + rand() * 0.6);
    colors[i * 3] = c.r * bright;
    colors[i * 3 + 1] = c.g * bright;
    colors[i * 3 + 2] = c.b * bright;
    sizes[i] = (t < 0.12 ? 2 : 1.6) + Math.pow(rand(), 5) * 4;
    phases[i] = rand() * 10;
  }
  return shaderPoints(positions, colors, sizes, phases, 1300, 1);
}

// ─── 배치 ───────────────────────────────────────────────────────

/** 해바라기(phyllotaxis) 배치: 비스듬히 내려다볼 때 은하끼리 겹치지 않는다 */
export function galaxyCenter(i: number, n: number, spread: number): THREE.Vector3 {
  const rand = mulberry32(31 + i);
  const r = spread * Math.sqrt((i + 0.6) / n);
  const theta = i * Math.PI * (3 - Math.sqrt(5)) + 0.4;
  return new THREE.Vector3(Math.cos(theta) * r, (rand() - 0.5) * spread * 0.35, Math.sin(theta) * r);
}

/** 은하 안 별 위치: 많이 한 게임일수록 중심 가까이, 나선팔을 따라 */
export function starLocalPosition(rank: number, total: number, radius: number, arms: number, rand: () => number) {
  const t = (rank + 0.6) / (total + 0.6);
  const r = radius * (0.14 + 0.72 * Math.sqrt(t));
  const arm = rank % arms;
  const angle = (arm * Math.PI * 2) / arms + r * TWIST + (rand() - 0.5) * 0.3;
  return new THREE.Vector3(Math.cos(angle) * r, (rand() - 0.5) * radius * 0.05, Math.sin(angle) * r);
}
