/**
 * 노드 끌기 = 사람 많은 좁은 방에서 한 명이 비집고 지나가는 모습.
 *
 * - 노드는 화면에 보이는 크기의 단단한 원이다. 끌린 노드는 다른 노드 위를 지나갈 수 없고, 앞을 막는 노드를 밀어낸다.
 * - 밀린 노드는 또 그 앞의 노드를 민다. 밀림은 물결처럼 바깥으로 번져 나가고, 손을 놓은 뒤에도 다 비켜설 때까지 잠깐 이어진다.
 * - 튕기거나 되돌아오지 않는다. 밀린 자리에 그대로 남는다.
 * - 끌기 전부터 겹쳐 있던 노드끼리는 그 겹침만큼은 봐준다 (그렇지 않으면 빽빽한 무리가 한꺼번에 터져 나간다).
 *   '새로 파고드는 것'만 막고, 한번 벌어진 틈은 다시 좁혀지지 않는다.
 *
 * 빽빽한 화면(멀리서 본 수만 개)에서는 한 번 밀면 수천 개가 줄줄이 밀린다.
 * 그래서 끌린 노드에 닿은 노드는 그 자리에서 바로 비키고, 그 너머로 번지는 밀림은 프레임마다 정해진 시간만큼만 처리하고 다음 프레임으로 넘긴다.
 * 밀림은 끌린 노드 둘레(화면 REACH_PX) 안에서만 번진다.
 *
 * 그래프 종류와 무관하게 host 콜백으로 좌표를 읽고 쓴다 (탐색기·대용량 캔버스가 같이 쓴다).
 */

/** 한 프레임에 물리에 쓰는 시간(ms). 나머지는 그리기 몫 */
const FRAME_MS = 7;
/** 끌린 노드가 한 번에 움직이는 거리 상한 (반지름 대비). 빠르게 휘둘러도 노드를 뚫고 지나가지 않게 */
const SUBSTEP = 0.5;
const MAX_SUBSTEPS = 40;
/** 끌린 노드가 한 걸음 옮길 때마다 바로 정리하는 주변 노드 수 (그 너머는 물결로 넘긴다) */
const HOT_CAP = 250;
/** 손을 놓은 뒤 물결이 이어지는 최대 프레임 수 */
const AFTER_FRAMES = 120;
/**
 * 밀림이 번지는 범위: 끌린 노드에서 화면으로 이만큼(px) 안의 노드만 밀린다.
 * 멀리서 본 화면은 노드가 빈틈없이 깔려 있어, 끝없이 번지게 두면 수만 개가 한꺼번에 움직이고 화면 전체가 일그러진다.
 * 범위 밖 노드는 그 자리에 있고, 범위 가장자리에서는 조금 겹칠 수 있다 (멀리서 보면 점이 작아 눈에 띄지 않는다).
 */
const REACH_PX = 200;
/** 한 번 끌 때 밀리는 노드 수 상한 */
const MAX_MOVED = 2500;
/** 셀 좌표 → 숫자 키 */
const ROW = 67108864;

export interface Moved {
  key: string;
  x: number;
  y: number;
}

export interface CrowdHost {
  /** 화면 1px이 그래프 좌표로 얼마인지 */
  unitsPerPx(): number;
  /** 모든 노드: 좌표와 화면에 보이는 반지름(px) */
  forEachNode(cb: (key: string, x: number, y: number, radiusPx: number) => void): void;
  /** 이번 프레임에 움직인 노드의 좌표를 반영한다 */
  write(moved: Moved[]): void;
  /** 밀림이 모두 끝났을 때 움직인 노드 전부 (저장용) */
  settle?(moved: Moved[]): void;
}

export class CrowdDrag {
  private keys: string[] = [];
  private x = new Float64Array(0);
  private y = new Float64Array(0);
  private r = new Float64Array(0);
  /** 끌기를 시작할 때 자리 (두 노드가 원래부터 겹쳐 있었는지 판단) */
  private x0 = new Float64Array(0);
  private y0 = new Float64Array(0);
  /** 한 번의 이웃 찾기에서 같은 노드를 두 번 보지 않게 */
  private seen = new Int32Array(0);
  private query = 0;
  private cell = 1;
  private grid = new Map<number, number[]>();
  /** 노드가 걸쳐 있는 셀 범위 [x0, y0, x1, y1] */
  private span = new Int32Array(0);
  /** 두 노드 사이에 지켜야 할 거리 (끌기 전부터 겹쳐 있었다면 그 거리, 벌어지면 따라 넓어진다) */
  private allowed = new Map<number, number>();
  /** 아직 주변을 밀어 봐야 하는 노드 (물결의 앞) */
  private wave: number[] = [];
  private waveHead = 0;
  private queued = new Uint8Array(0);
  private moved = new Set<number>();
  private dirty = new Set<number>();
  private d = -1;
  private tx = 0;
  private ty = 0;
  private raf = 0;
  /** 손으로 잡고 있는 중 */
  private holding = false;
  /** 손을 놓은 뒤 지난 프레임 수 */
  private after = 0;
  /** 밀림이 번지는 범위 (그래프 좌표) */
  private reach = 0;

  constructor(private host: CrowdHost) {}

  start(key: string) {
    // 이전 끌기의 물결이 아직 번지는 중이면 지금 자리에서 끝내고 저장한다
    this.finish();
    const upp = this.host.unitsPerPx();
    const keys: string[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    const rs: number[] = [];
    this.host.forEachNode((k, x, y, rPx) => {
      keys.push(k);
      xs.push(x);
      ys.push(y);
      rs.push(Math.max(rPx, 0.5) * upp);
    });
    const n = keys.length;
    this.d = keys.indexOf(key);
    if (this.d < 0) return;
    this.keys = keys;
    this.x = Float64Array.from(xs);
    this.y = Float64Array.from(ys);
    this.r = Float64Array.from(rs);
    this.x0 = Float64Array.from(xs);
    this.y0 = Float64Array.from(ys);
    this.seen = new Int32Array(n).fill(-1);
    this.query = 0;
    this.queued = new Uint8Array(n);
    this.wave = [];
    this.waveHead = 0;

    // 셀 = 흔한 노드 지름. 큰 노드(장르 등)는 자기가 덮는 셀 여러 칸에 들어간다
    const sorted = Float64Array.from(rs).sort();
    this.cell = Math.max((sorted[Math.floor(n * 0.9)] ?? upp) * 2, 1e-9);
    this.grid = new Map();
    this.span = new Int32Array(n * 4);
    for (let i = 0; i < n; i++) this.insert(i);

    this.tx = this.x[this.d]!;
    this.ty = this.y[this.d]!;
    // 장르처럼 큰 노드를 끌 때는 그 노드에 닿는 노드까지는 들어오게
    this.reach = Math.max(REACH_PX * upp, this.r[this.d]! * 3);
    this.holding = true;
    this.after = 0;
  }

  move(x: number, y: number) {
    if (!this.holding) return;
    this.tx = x;
    this.ty = y;
    this.schedule();
  }

  /** 손을 놓는다. 끌린 노드는 그 자리에 서고, 번지던 밀림은 다 비켜설 때까지 이어진다 */
  end() {
    if (!this.holding) return;
    this.holding = false;
    this.schedule();
  }

  /** 보기가 바뀌어 좌표가 더는 의미 없을 때 (저장하지 않고 버린다) */
  cancel() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.holding = false;
    this.reset();
  }

  private finish() {
    if (this.d >= 0 && this.moved.size) {
      if (this.dirty.size) this.host.write(this.list(this.dirty));
      this.host.settle?.(this.list(this.moved));
    }
    this.cancel();
  }

  private reset() {
    this.allowed.clear();
    this.moved.clear();
    this.dirty.clear();
    this.grid = new Map();
    this.wave = [];
    this.waveHead = 0;
    this.d = -1;
  }

  private schedule() {
    if (!this.raf && this.d >= 0) this.raf = requestAnimationFrame(() => this.tick());
  }

  private list(set: Set<number>): Moved[] {
    return [...set].map((i) => ({ key: this.keys[i]!, x: this.x[i]!, y: this.y[i]! }));
  }

  // ── 격자 ──────────────────────────────────────────────
  private insert(i: number) {
    const c = this.cell;
    const x = this.x[i]!;
    const y = this.y[i]!;
    const r = this.r[i]!;
    const x0 = Math.floor((x - r) / c);
    const y0 = Math.floor((y - r) / c);
    const x1 = Math.floor((x + r) / c);
    const y1 = Math.floor((y + r) / c);
    const o = i * 4;
    this.span[o] = x0;
    this.span[o + 1] = y0;
    this.span[o + 2] = x1;
    this.span[o + 3] = y1;
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const k = gx * ROW + gy;
        const list = this.grid.get(k);
        if (list) list.push(i);
        else this.grid.set(k, [i]);
      }
    }
  }

  private relocate(i: number) {
    const c = this.cell;
    const r = this.r[i]!;
    const o = i * 4;
    const x = this.x[i]!;
    const y = this.y[i]!;
    if (
      Math.floor((x - r) / c) === this.span[o] &&
      Math.floor((y - r) / c) === this.span[o + 1] &&
      Math.floor((x + r) / c) === this.span[o + 2] &&
      Math.floor((y + r) / c) === this.span[o + 3]
    )
      return; // 같은 칸들 그대로
    for (let gx = this.span[o]!; gx <= this.span[o + 2]!; gx++) {
      for (let gy = this.span[o + 1]!; gy <= this.span[o + 3]!; gy++) {
        const list = this.grid.get(gx * ROW + gy);
        if (!list) continue;
        const at = list.indexOf(i);
        if (at >= 0) {
          list[at] = list[list.length - 1]!;
          list.pop();
        }
      }
    }
    this.insert(i);
  }

  // ── 움직임 ────────────────────────────────────────────
  private place(i: number, x: number, y: number) {
    this.x[i] = x;
    this.y[i] = y;
    this.relocate(i);
    this.moved.add(i);
    this.dirty.add(i);
  }

  private tick() {
    this.raf = 0;
    const d = this.d;
    if (d < 0) return;
    const t0 = performance.now();
    let reached = true;

    // 1) 끌린 노드를 잘게 나눠 옮기며, 닿은 노드와 그 바로 뒤 노드까지는 그 자리에서 비켜 세운다
    for (let s = 0; s < MAX_SUBSTEPS; s++) {
      const dx = this.tx - this.x[d]!;
      const dy = this.ty - this.y[d]!;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-12) break;
      if (performance.now() - t0 > FRAME_MS) {
        reached = false;
        break;
      }
      const stepLen = Math.min(dist, this.r[d]! * SUBSTEP);
      this.place(d, this.x[d]! + (dx / dist) * stepLen, this.y[d]! + (dy / dist) * stepLen);
      const hot = [d];
      for (let h = 0; h < hot.length; h++) {
        const i = hot[h]!;
        if (h < HOT_CAP) this.push(i, hot);
        else this.enqueue(i); // 그 너머는 물결로 넘긴다
      }
      if (s === MAX_SUBSTEPS - 1 && stepLen < dist) reached = false;
    }

    // 2) 남은 시간만큼 물결을 바깥으로 번지게 한다
    let ops = 0;
    while (this.waveHead < this.wave.length) {
      if ((++ops & 31) === 0 && performance.now() - t0 > FRAME_MS) break;
      const i = this.wave[this.waveHead++]!;
      this.queued[i] = 0;
      this.push(i, null);
    }
    if (this.waveHead > 4096 && this.waveHead * 2 > this.wave.length) {
      this.wave = this.wave.slice(this.waveHead);
      this.waveHead = 0;
    }

    if (this.dirty.size) {
      this.host.write(this.list(this.dirty));
      this.dirty.clear();
    }

    const waving = this.waveHead < this.wave.length;
    if (!this.holding) this.after++;
    if (this.holding ? !reached || waving : waving && this.after < AFTER_FRAMES) this.schedule();
    else if (!this.holding) this.finish();
  }

  private enqueue(i: number) {
    if (this.queued[i]) return;
    this.queued[i] = 1;
    this.wave.push(i);
  }

  /**
   * i와 겹친 노드를 밀어낸다. 밀리는 쪽은 언제나 상대(끌린 노드는 손이 잡고 있어 절대 밀리지 않는다 → i가 비킨다).
   * 밀린 노드는 hot에 넣어 바로 이어서 밀거나, hot이 없으면 물결 뒤에 줄 세운다.
   */
  private push(i: number, hot: number[] | null) {
    const d = this.d;
    for (const j of this.overlapping(i)) {
      const mover = j === d ? i : j;
      const anchor = mover === j ? i : j;
      if (!this.pushable(mover)) continue;
      const ddx = this.x[mover]! - this.x[anchor]!;
      const ddy = this.y[mover]! - this.y[anchor]!;
      const dij = Math.hypot(ddx, ddy);
      const need = this.gap(i, j, dij);
      if (dij >= need - 1e-9) continue;
      let ux: number;
      let uy: number;
      if (dij > 1e-12) {
        ux = ddx / dij;
        uy = ddy / dij;
      } else {
        // 정확히 포개져 있으면 노드마다 정해진 방향으로
        const a = (mover * 2.399963) % (Math.PI * 2);
        ux = Math.cos(a);
        uy = Math.sin(a);
      }
      // 멀리 번지는 물결은 끌린 노드에서 바깥으로만 민다. 끌린 노드 쪽으로 되밀면 빽빽한 무리 안에서 서로 밀고 당기며 끝없이 떤다
      if (!hot && anchor !== d && ux * (this.x[mover]! - this.x[d]!) + uy * (this.y[mover]! - this.y[d]!) < 0) continue;
      const push = need - dij;
      this.place(mover, this.x[mover]! + ux * push, this.y[mover]! + uy * push);
      if (hot && mover !== i) hot.push(mover);
      else this.enqueue(mover);
    }
  }

  /** 범위 안에 있고, 이번 끌기에서 밀린 노드가 아직 상한에 닿지 않았을 때만 밀 수 있다 */
  private pushable(i: number) {
    if (!this.moved.has(i) && this.moved.size >= MAX_MOVED) return false;
    const d = this.d;
    const dx = this.x[i]! - this.x[d]!;
    const dy = this.y[i]! - this.y[d]!;
    return dx * dx + dy * dy <= this.reach * this.reach;
  }

  /** i와 원이 겹치는 노드 */
  private overlapping(i: number): number[] {
    const q = ++this.query;
    this.seen[i] = q;
    const out: number[] = [];
    const xi = this.x[i]!;
    const yi = this.y[i]!;
    const ri = this.r[i]!;
    const o = i * 4;
    for (let gx = this.span[o]!; gx <= this.span[o + 2]!; gx++) {
      for (let gy = this.span[o + 1]!; gy <= this.span[o + 3]!; gy++) {
        const list = this.grid.get(gx * ROW + gy);
        if (!list) continue;
        for (let li = 0; li < list.length; li++) {
          const j = list[li]!;
          if (this.seen[j] === q) continue;
          this.seen[j] = q;
          const dx = this.x[j]! - xi;
          const dy = this.y[j]! - yi;
          const rs = ri + this.r[j]!;
          if (dx * dx + dy * dy < rs * rs) out.push(j);
        }
      }
    }
    return out;
  }

  /**
   * 두 노드가 지켜야 할 거리. 끌기 전부터 겹쳐 있었다면 그만큼은 봐준다.
   * 그 뒤로 둘이 벌어지면 허락된 거리도 같이 넓어진다 (한번 비켜선 노드를 다시 파고들 수 없다).
   */
  private gap(i: number, j: number, dij: number) {
    const rs = this.r[i]! + this.r[j]!;
    const key = i < j ? i * this.keys.length + j : j * this.keys.length + i;
    let g = this.allowed.get(key);
    if (g === undefined) g = Math.min(rs, Math.hypot(this.x0[j]! - this.x0[i]!, this.y0[j]! - this.y0[i]!));
    if (dij > g) g = Math.min(rs, dij);
    this.allowed.set(key, g);
    return g;
  }
}
