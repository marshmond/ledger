import type { FlowGraph, FlowLink, FlowNode } from './flow';

/** Turns a flow graph into positions: columns left to right, nodes stacked in each column, and curved bands between them. Pure. */

export interface PlacedNode extends FlowNode {
  x: number;
  y: number;
  h: number;
  value: number;
}
export interface PlacedLink extends FlowLink {
  /** Centre line of the band. */
  path: string;
  width: number;
}
export interface Layout {
  width: number;
  height: number;
  nodeW: number;
  nodes: PlacedNode[];
  links: PlacedLink[];
  cols: number;
}

export interface LayoutOptions {
  width: number;
  /** Room left of the first column and right of the last, for their labels. */
  padLeft?: number;
  padRight?: number;
  nodeW?: number;
  gap?: number;
  /** Tallest the diagram may be per node, so a short list is not stretched. */
  minHeight?: number;
  rowPx?: number;
}

export function layoutFlow(g: FlowGraph, o: LayoutOptions): Layout {
  const nodeW = o.nodeW ?? 14;
  const gap = o.gap ?? 10;
  const padLeft = o.padLeft ?? 120;
  const padRight = o.padRight ?? 170;
  const pad = 24; // room above the first node for a label
  const colCount = g.nodes.length ? Math.max(...g.nodes.map((n) => n.col)) + 1 : 0;

  const out = new Map<string, number>();
  const inn = new Map<string, number>();
  for (const l of g.links) {
    out.set(l.source, (out.get(l.source) ?? 0) + l.value);
    inn.set(l.target, (inn.get(l.target) ?? 0) + l.value);
  }
  const valueOf = (id: string) => Math.max(out.get(id) ?? 0, inn.get(id) ?? 0);

  const columns: FlowNode[][] = Array.from({ length: colCount }, () => []);
  for (const n of g.nodes) columns[n.col].push(n);
  const tallest = Math.max(1, ...columns.map((c) => c.length));
  const height = Math.max(o.minHeight ?? 320, tallest * (o.rowPx ?? 30) + 2 * pad);

  // One scale for the whole diagram, so a band keeps its thickness from end to end.
  let k = Infinity;
  for (const col of columns) {
    const total = col.reduce((a, n) => a + valueOf(n.id), 0);
    if (total > 0) k = Math.min(k, (height - 2 * pad - gap * (col.length - 1)) / total);
  }
  if (!isFinite(k) || k <= 0) k = 1;

  const span = Math.max(1, o.width - padLeft - padRight - nodeW);
  const xOf = (col: number) => padLeft + (colCount <= 1 ? 0 : (col / (colCount - 1)) * span);
  const placed = new Map<string, PlacedNode>();
  for (const col of columns) {
    const colH = col.reduce((a, n) => a + valueOf(n.id) * k, 0) + gap * Math.max(0, col.length - 1);
    let y = pad + (height - 2 * pad - colH) / 2;
    for (const n of col) {
      const h = valueOf(n.id) * k;
      placed.set(n.id, { ...n, x: xOf(n.col), y, h, value: valueOf(n.id) });
      y += h + gap;
    }
  }

  // Order the bands leaving and entering each node by where the other end is, so bands do not cross needlessly.
  const outCursor = new Map<string, number>();
  const inCursor = new Map<string, number>();
  const sorted = [...g.links];
  const links: PlacedLink[] = [];
  const outOrder = (id: string) => sorted.filter((l) => l.source === id).sort((a, b) => placed.get(a.target)!.y - placed.get(b.target)!.y);
  const inOrder = (id: string) => sorted.filter((l) => l.target === id).sort((a, b) => placed.get(a.source)!.y - placed.get(b.source)!.y);
  const sy = new Map<FlowLink, number>();
  const ty = new Map<FlowLink, number>();
  for (const n of placed.values()) {
    outCursor.set(n.id, n.y);
    for (const l of outOrder(n.id)) {
      sy.set(l, outCursor.get(n.id)!);
      outCursor.set(n.id, outCursor.get(n.id)! + l.value * k);
    }
    inCursor.set(n.id, n.y);
    for (const l of inOrder(n.id)) {
      ty.set(l, inCursor.get(n.id)!);
      inCursor.set(n.id, inCursor.get(n.id)! + l.value * k);
    }
  }
  for (const l of g.links) {
    const a = placed.get(l.source)!;
    const b = placed.get(l.target)!;
    const w = l.value * k;
    const x0 = a.x + nodeW;
    const x1 = b.x;
    const y0 = sy.get(l)! + w / 2;
    const y1 = ty.get(l)! + w / 2;
    const mid = (x0 + x1) / 2;
    links.push({ ...l, width: w, path: `M${x0.toFixed(1)},${y0.toFixed(1)} C${mid.toFixed(1)},${y0.toFixed(1)} ${mid.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}` });
  }
  return { width: o.width, height, nodeW, nodes: [...placed.values()], links, cols: colCount };
}
