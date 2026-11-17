import type { Settings } from 'sigma/settings';
import type { NodeDisplayData, PartialButFor } from 'sigma/types';
import { CLASSES, PLAY_STATUS, RELATIONS, type OntEdge, type OntNode } from '@steamverse/shared';

export const LABEL_FONT = '"Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif';

export function nodeSize(n: OntNode): number {
  switch (n.cls) {
    case 'Game':
      return Math.min(26, 5 + Math.sqrt(n.hours) * 0.85);
    case 'Organization':
      return Math.min(13, 3 + Math.sqrt(n.hours) * 0.22);
    case 'Franchise':
      return Math.min(10, 3 + Math.sqrt(n.hours) * 0.2);
    case 'Genre':
      return Math.min(14, 4 + Math.sqrt(n.gameCount) * 1.4);
    case 'Tag':
      return Math.min(9, 2.5 + Math.sqrt(n.gameCount) * 1);
    case 'Player':
      return n.player?.isMe ? 18 : 10;
  }
}

/** 게임은 플레이 상태 색(이미지 테두리), 나머지는 클래스 색 */
export function nodeColor(n: OntNode): string {
  return n.cls === 'Game' ? PLAY_STATUS[n.game!.status].color : CLASSES[n.cls].color;
}

/** 엣지 id로 정해지는 -1..1 값: 곡선 방향·세기를 엣지마다 다르게 해 기계적인 느낌을 없앤다 */
export function edgeJitter(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** 확인된 관계는 완만한 곡선, 추론 관계는 크게 휘는 곡선 */
export function curvatureFor(id: string, inferred: boolean): number {
  const j = edgeJitter(id);
  const base = inferred ? 0.42 : 0.16;
  return Math.sign(j || 1) * (base + Math.abs(j) * (inferred ? 0.12 : 0.14));
}

export function edgeStyle(e: OntEdge): { size: number; color: string; type: 'curved'; curvature: number } {
  const def = RELATIONS[e.rel];
  const curvature = curvatureFor(e.id, def.inferred);
  switch (e.rel) {
    case 'similarTo':
      return { size: 1 + (e.weight ?? 0.5) * 1.2, color: def.color, type: 'curved', curvature };
    case 'favoriteDeveloper':
      return { size: 2, color: def.color, type: 'curved', curvature };
    case 'developedBy':
      return { size: 1.2, color: def.color, type: 'curved', curvature };
    case 'owns':
      return { size: 0.6 + Math.min(2, Math.sqrt(e.weight ?? 0) / 15), color: def.color, type: 'curved', curvature };
    default:
      return { size: 0.8, color: def.color, type: 'curved', curvature };
  }
}

/**
 * Sigma는 premultiplied alpha로 섞는다(blendFunc ONE, ONE_MINUS_SRC_ALPHA).
 * 반투명 노드 색은 RGB에 알파를 미리 곱해 줘야 밝은 점으로 뜨지 않는다.
 */
export function premultiplied(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * alpha);
  const g = Math.round(((n >> 8) & 255) * alpha);
  const b = Math.round((n & 255) * alpha);
  return `rgba(${r},${g},${b},${alpha})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 평상시 라벨: 어두운 헤일로로 선과 겹쳐도 읽히게 */
export function drawHaloLabel(
  ctx: CanvasRenderingContext2D,
  data: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>,
  settings: Settings,
): void {
  if (!data.label) return;
  const size = settings.labelSize;
  ctx.font = `500 ${size}px ${settings.labelFont}`;
  const x = data.x + data.size + 5;
  const y = data.y + size / 3;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(4,5,10,0.85)';
  ctx.strokeText(data.label, x, y);
  ctx.fillStyle = 'rgba(226,232,240,0.82)';
  ctx.fillText(data.label, x, y);
}

/** 호버: 얇은 이중 링 + 알약 모양 유리 라벨 */
export function drawDarkHover(
  ctx: CanvasRenderingContext2D,
  data: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>,
  settings: Settings,
): void {
  const size = settings.labelSize + 0.5;
  ctx.font = `600 ${size}px ${settings.labelFont}`;
  const label = data.label ?? '';

  ctx.save();
  ctx.beginPath();
  ctx.arc(data.x, data.y, data.size + 3.5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 1.25;
  ctx.shadowColor = data.color;
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(data.x, data.y, data.size + 8, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (label) {
    const padX = 10;
    const h = size + 13;
    const w = ctx.measureText(label).width + padX * 2 + 10;
    const x = data.x + data.size + 13;
    const y = data.y - h / 2;
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = 'rgba(9,11,20,0.94)';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 16;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + padX + 2, data.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = data.color;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + padX + 10, data.y + 0.5);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}
