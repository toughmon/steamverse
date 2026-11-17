declare module 'd3-voronoi-treemap' {
  import type { HierarchyNode } from 'd3-hierarchy';

  export type Point = [number, number];
  export type VoronoiPolygon = Point[] & { site?: { x: number; y: number; weight: number } };

  export interface VoronoiTreemap {
    <T>(root: HierarchyNode<T>): void;
    clip(polygon: Point[]): VoronoiTreemap;
    extent(extent: [Point, Point]): VoronoiTreemap;
    size(size: [number, number]): VoronoiTreemap;
    convergenceRatio(ratio: number): VoronoiTreemap;
    maxIterationCount(count: number): VoronoiTreemap;
    minWeightRatio(ratio: number): VoronoiTreemap;
    prng(rng: () => number): VoronoiTreemap;
  }

  export function voronoiTreemap(): VoronoiTreemap;
}
