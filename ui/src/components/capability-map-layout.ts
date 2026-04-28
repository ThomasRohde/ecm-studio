import type { Capability, CapabilityMapColorScheme } from '../api/types';
import {
  CAPABILITY_MAP_DENSITY_LAYOUT_OPTIONS,
  DEFAULT_CAPABILITY_MAP_ALIGNMENT,
  DEFAULT_CAPABILITY_MAP_TARGET_ASPECT_RATIO,
} from '../capability-map-settings';

export const CAPABILITY_MAP_ALL_ROOTS = '__ecm_capability_map_all_roots__';

export interface Size {
  w: number;
  h: number;
}

export interface Position {
  x: number;
  y: number;
}

export interface Placement {
  item: LayoutNode;
  x: number;
  y: number;
}

export interface RowMeta {
  items: LayoutNode[];
  height: number;
  width: number;
  placements?: Placement[];
}

export interface TreeNode {
  id: string;
  name: string;
  description?: string;
  order: number;
  children: TreeNode[];
}

export interface LayoutNode {
  id: string;
  name: string;
  description?: string;
  children: LayoutNode[];
  size: Size;
  rows: RowMeta[];
  position: Position;
  depth: number;
  order: number;
  _effectiveLeaf: boolean;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  totalWidth: number;
  totalHeight: number;
  leafSize: Size;
}

export interface PackResult {
  w: number;
  h: number;
  rows: RowMeta[];
}

export interface LayoutOptions {
  gap: number;
  padding: number;
  headerHeight: number;
  rootGap: number;
  viewMargin: number;
  aspectRatio: number;
  alignment: 'left' | 'center' | 'right';
  maxDepth: number;
  sortMode: 'subtrees' | 'alphabetical';
  minLeafWidth: number;
  maxLeafWidth: number;
  leafHeight: number;
}

export interface CapabilityMapRootOption {
  id: string;
  name: string;
  path: string;
  depth: number;
}

export type MeasureTextFn = (text: string) => number;

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  ...CAPABILITY_MAP_DENSITY_LAYOUT_OPTIONS.comfortable,
  aspectRatio: DEFAULT_CAPABILITY_MAP_TARGET_ASPECT_RATIO,
  alignment: DEFAULT_CAPABILITY_MAP_ALIGNMENT,
  maxDepth: -1,
  sortMode: 'subtrees',
};

export const DEFAULT_DEPTH_COLORS = [
  '#D6E4F0',
  '#D9EAD3',
  '#E1D5E7',
  '#FCE5CD',
  '#FFF2CC',
  '#F4CCCC',
];

export const DEFAULT_LEAF_COLOR = '#E8E8E8';
export const DEFAULT_CAPABILITY_MAP_COLOR_SCHEME: CapabilityMapColorScheme = {
  depth_colors: [...DEFAULT_DEPTH_COLORS],
  leaf_color: DEFAULT_LEAF_COLOR,
};

export function normalizeCapabilityMapColorScheme(
  colorScheme?: Partial<CapabilityMapColorScheme> | null,
): CapabilityMapColorScheme {
  const depthColors = colorScheme?.depth_colors?.length
    ? colorScheme.depth_colors
    : DEFAULT_DEPTH_COLORS;
  const leafColor = colorScheme?.leaf_color ?? DEFAULT_LEAF_COLOR;
  return {
    depth_colors: [...depthColors],
    leaf_color: leafColor,
  };
}

export function capabilityMapNodeFill(
  node: Pick<LayoutNode, '_effectiveLeaf' | 'depth'>,
  colorScheme?: Partial<CapabilityMapColorScheme> | null,
): string {
  const normalized = normalizeCapabilityMapColorScheme(colorScheme);
  if (node._effectiveLeaf) return normalized.leaf_color;
  return normalized.depth_colors[Math.min(node.depth, normalized.depth_colors.length - 1)];
}

export function stubMeasureText(text: string): number {
  return text.length * 7;
}

export function buildCapabilityMapTree(capabilities: Capability[]): TreeNode[] {
  return capabilities
    .map((capability, index) => toTreeNode(capability, index))
    .sort(compareTreeNodes);
}

export function capabilityMapRootOptions(capabilities: Capability[]): CapabilityMapRootOption[] {
  const options: CapabilityMapRootOption[] = [];

  function visit(node: Capability, path: string, depth: number) {
    const nodePath = path ? `${path} / ${node.name}` : node.name;
    options.push({ id: node.id, name: node.name, path: nodePath, depth });
    for (const child of orderedCapabilities(node.children ?? [])) {
      visit(child, nodePath, depth + 1);
    }
  }

  for (const root of orderedCapabilities(capabilities)) {
    visit(root, '', 0);
  }
  return options;
}

export function getCapabilityMapRoots(
  capabilities: Capability[],
  rootId: string = CAPABILITY_MAP_ALL_ROOTS,
): TreeNode[] {
  const roots = buildCapabilityMapTree(capabilities);
  if (rootId === CAPABILITY_MAP_ALL_ROOTS) return roots;
  const root = findTreeNode(roots, rootId);
  return root ? [root] : [];
}

export function findCapabilityById(
  capabilities: Capability[],
  capabilityId: string,
): Capability | null {
  for (const capability of capabilities) {
    if (capability.id === capabilityId) return capability;
    const childMatch = findCapabilityById(capability.children ?? [], capabilityId);
    if (childMatch) return childMatch;
  }
  return null;
}

export function capabilityMapById(capabilities: Capability[]): Map<string, Capability> {
  const byId = new Map<string, Capability>();

  function visit(nodes: Capability[]) {
    for (const node of nodes) {
      byId.set(node.id, node);
      visit(node.children ?? []);
    }
  }

  visit(capabilities);
  return byId;
}

export function layoutCapabilityMap(
  capabilities: Capability[],
  options: {
    rootId?: string;
    maxDepth?: number;
    layoutOptions?: Partial<LayoutOptions>;
    measureText?: MeasureTextFn;
  } = {},
): LayoutResult | null {
  const roots = getCapabilityMapRoots(capabilities, options.rootId);
  if (roots.length === 0) return null;
  return layoutTrees(
    roots,
    {
      ...DEFAULT_LAYOUT_OPTIONS,
      ...options.layoutOptions,
      maxDepth: options.maxDepth ?? DEFAULT_LAYOUT_OPTIONS.maxDepth,
    },
    options.measureText ?? stubMeasureText,
  );
}

export function layoutTrees(
  roots: TreeNode[],
  options: LayoutOptions,
  measureText: MeasureTextFn = stubMeasureText,
): LayoutResult {
  const layoutRoots = roots.map((root) => toLayoutNode(root, 0, options.maxDepth));
  const { leafWidth, leafHeight } = computeUniformLeafSize(layoutRoots, options, measureText);

  for (const root of layoutRoots) {
    calculateSize(root, 0, leafWidth, leafHeight, options);
  }
  positionRoots(layoutRoots, options);

  let totalWidth = 0;
  let totalHeight = 0;
  for (const root of layoutRoots) {
    totalWidth = Math.max(totalWidth, root.position.x + root.size.w);
    totalHeight = Math.max(totalHeight, root.position.y + root.size.h);
  }

  return {
    nodes: collectVisibleNodes(layoutRoots),
    totalWidth: totalWidth + options.viewMargin,
    totalHeight: totalHeight + options.viewMargin,
    leafSize: { w: leafWidth, h: leafHeight },
  };
}

function toTreeNode(capability: Capability, fallbackOrder: number): TreeNode {
  return {
    id: capability.id,
    name: capability.name,
    description: capability.description,
    order: Number.isFinite(capability.order) ? capability.order : fallbackOrder,
    children: orderedCapabilities(capability.children ?? []).map((child, index) =>
      toTreeNode(child, index),
    ),
  };
}

function orderedCapabilities(capabilities: Capability[]): Capability[] {
  return [...capabilities].sort(compareCapabilities);
}

function compareCapabilities(a: Capability, b: Capability): number {
  return a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function compareTreeNodes(a: TreeNode, b: TreeNode): number {
  return a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function findTreeNode(nodes: TreeNode[], nodeId: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const childMatch = findTreeNode(node.children, nodeId);
    if (childMatch) return childMatch;
  }
  return null;
}

function toLayoutNode(tree: TreeNode, depth: number, maxDepth: number): LayoutNode {
  const includeChildren = maxDepth === -1 || depth < maxDepth;
  return {
    id: tree.id,
    name: tree.name,
    description: tree.description,
    children: includeChildren
      ? tree.children.map((child) => toLayoutNode(child, depth + 1, maxDepth))
      : [],
    size: { w: 0, h: 0 },
    rows: [],
    position: { x: 0, y: 0 },
    depth,
    order: tree.order,
    _effectiveLeaf: false,
  };
}

function collectVisibleNodes(roots: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];

  function visit(node: LayoutNode) {
    result.push(node);
    if (node._effectiveLeaf) return;
    for (const child of node.children) visit(child);
  }

  for (const root of roots) visit(root);
  return result;
}

function computeUniformLeafSize(
  roots: LayoutNode[],
  options: LayoutOptions,
  measureText: MeasureTextFn,
): { leafWidth: number; leafHeight: number } {
  let maxLeafTextWidth = 0;

  function findMaxLeafWidth(node: LayoutNode, depth: number): void {
    const isEffectiveLeaf =
      node.children.length === 0 || (options.maxDepth !== -1 && depth >= options.maxDepth);

    if (isEffectiveLeaf) {
      maxLeafTextWidth = Math.max(maxLeafTextWidth, measureText(node.name));
      return;
    }
    for (const child of node.children) findMaxLeafWidth(child, depth + 1);
  }

  for (const root of roots) findMaxLeafWidth(root, 0);

  const leafWidth = Math.max(
    options.minLeafWidth,
    Math.min(maxLeafTextWidth + 2 * options.padding + 10, options.maxLeafWidth),
  );
  return { leafWidth, leafHeight: options.leafHeight };
}

function calculateSize(
  node: LayoutNode,
  depth: number,
  leafWidth: number,
  leafHeight: number,
  options: LayoutOptions,
): void {
  const isEffectiveLeaf =
    node.children.length === 0 || (options.maxDepth !== -1 && depth >= options.maxDepth);

  if (isEffectiveLeaf) {
    node.size = { w: leafWidth, h: leafHeight };
    node.rows = [];
    node._effectiveLeaf = true;
    return;
  }

  node._effectiveLeaf = false;
  for (const child of node.children) {
    calculateSize(child, depth + 1, leafWidth, leafHeight, options);
  }

  sortChildren(node.children, options.sortMode);

  const subtrees: LayoutNode[] = [];
  const leaves: LayoutNode[] = [];
  for (const child of node.children) {
    if (child._effectiveLeaf) leaves.push(child);
    else subtrees.push(child);
  }

  const layout =
    subtrees.length > 0 && leaves.length > 0
      ? computeBandedFlowLayout(subtrees, leaves, options)
      : computeFlowLayout(node.children, options);
  node.size = { w: layout.w, h: layout.h };
  node.rows = layout.rows;
}

function computeFlowLayout(children: LayoutNode[], options: LayoutOptions): PackResult {
  if (children.length === 0) {
    return { w: 2 * options.padding, h: options.headerHeight + options.padding, rows: [] };
  }
  if (children.length === 1) {
    return {
      w: children[0].size.w + 2 * options.padding,
      h: children[0].size.h + options.headerHeight + options.padding,
      rows: [{ items: [children[0]], height: children[0].size.h, width: children[0].size.w }],
    };
  }

  let bestLayout: PackResult | null = null;
  let bestScore = Infinity;

  for (let k = 1; k <= children.length; k++) {
    let targetW = 2 * options.padding;
    for (let i = 0; i < k; i++) {
      targetW += children[i].size.w;
      if (i > 0) targetW += options.gap;
    }
    const layout = packRows(children, targetW, options);
    const score = scoreLayout(layout, options);
    if (score < bestScore) {
      bestScore = score;
      bestLayout = layout;
    }
  }

  return bestLayout!;
}

function computeBandedFlowLayout(
  subtrees: LayoutNode[],
  leaves: LayoutNode[],
  options: LayoutOptions,
): PackResult {
  let bestLayout: PackResult | null = null;
  let bestScore = Infinity;
  const candidateWidths: number[] = [];

  for (let k = 1; k <= subtrees.length; k++) {
    candidateWidths.push(candidateWidth(subtrees, k, options));
  }
  for (let k = 1; k <= leaves.length; k++) {
    candidateWidths.push(candidateWidth(leaves, k, options));
  }

  for (const targetW of candidateWidths) {
    const subtreeResult = packRows(subtrees, targetW, options);
    const clonedRows = subtreeResult.rows.map((row) => ({
      items: [...row.items],
      height: row.height,
      width: row.width,
      placements: row.placements ? [...row.placements] : undefined,
    }));
    const remainingLeaves = backfillRowsWithLeaves(
      clonedRows,
      [...leaves],
      targetW - 2 * options.padding,
      options,
    );
    const layout =
      remainingLeaves.length > 0
        ? buildLayoutFromRows(
            [...clonedRows, ...packRows(remainingLeaves, targetW, options).rows],
            options,
          )
        : buildLayoutFromRows(clonedRows, options);
    const score = scoreLayout(layout, options);

    if (score < bestScore) {
      bestScore = score;
      bestLayout = layout;
    }
  }

  return bestLayout!;
}

function candidateWidth(nodes: LayoutNode[], count: number, options: LayoutOptions): number {
  let width = 2 * options.padding;
  for (let i = 0; i < count; i++) {
    width += nodes[i].size.w;
    if (i > 0) width += options.gap;
  }
  return width;
}

function buildLayoutFromRows(rows: RowMeta[], options: LayoutOptions): PackResult {
  let maxRowWidth = 0;
  let height = options.headerHeight;
  for (let index = 0; index < rows.length; index++) {
    maxRowWidth = Math.max(maxRowWidth, rows[index].width);
    if (index > 0) height += options.gap;
    height += rows[index].height;
  }
  return { w: maxRowWidth + 2 * options.padding, h: height + options.padding, rows };
}

function packRows(children: LayoutNode[], targetWidth: number, options: LayoutOptions): PackResult {
  const contentWidth = targetWidth - 2 * options.padding;
  const rows: LayoutNode[][] = [];
  let currentRow: LayoutNode[] = [];
  let currentRowWidth = 0;

  for (const child of children) {
    const needed = currentRow.length > 0 ? options.gap + child.size.w : child.size.w;
    if (currentRow.length > 0 && currentRowWidth + needed > contentWidth) {
      rows.push(currentRow);
      currentRow = [child];
      currentRowWidth = child.size.w;
    } else {
      currentRow.push(child);
      currentRowWidth += needed;
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  let maxRowWidth = 0;
  let totalHeight = options.headerHeight;
  const rowMeta: RowMeta[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    let rowWidth = 0;
    let rowHeight = 0;
    for (let childIndex = 0; childIndex < row.length; childIndex++) {
      if (childIndex > 0) rowWidth += options.gap;
      rowWidth += row[childIndex].size.w;
      rowHeight = Math.max(rowHeight, row[childIndex].size.h);
    }
    maxRowWidth = Math.max(maxRowWidth, rowWidth);
    if (rowIndex > 0) totalHeight += options.gap;
    totalHeight += rowHeight;
    rowMeta.push({ items: row, height: rowHeight, width: rowWidth });
  }

  return {
    w: maxRowWidth + 2 * options.padding,
    h: totalHeight + options.padding,
    rows: rowMeta,
  };
}

function ensureRowPlacements(row: RowMeta, options: LayoutOptions): void {
  if (row.placements && row.placements.length > 0) return;
  row.placements = [];
  let x = 0;
  for (const item of row.items) {
    row.placements.push({ item, x, y: 0 });
    x += item.size.w + options.gap;
  }
}

function backfillRowsWithLeaves(
  rows: RowMeta[],
  leaves: LayoutNode[],
  contentWidth: number,
  options: LayoutOptions,
): LayoutNode[] {
  if (leaves.length === 0) return [];

  let leafIndex = 0;
  const leafWidth = leaves[0].size.w;
  const leafHeight = leaves[0].size.h;

  for (let rowIndex = rows.length - 1; rowIndex >= 0 && leafIndex < leaves.length; rowIndex--) {
    const row = rows[rowIndex];
    const startX = row.width + (row.items.length > 0 ? options.gap : 0);
    const availableWidth = contentWidth - startX;
    if (availableWidth < leafWidth) continue;

    const maxCols = Math.floor((availableWidth + options.gap) / (leafWidth + options.gap));
    const maxRowsPerCol = Math.floor((row.height + options.gap) / (leafHeight + options.gap));
    if (maxCols <= 0 || maxRowsPerCol <= 0) continue;

    const placeCount = Math.min(maxCols * maxRowsPerCol, leaves.length - leafIndex);
    ensureRowPlacements(row, options);

    for (let placementIndex = 0; placementIndex < placeCount; placementIndex++) {
      const col = Math.floor(placementIndex / maxRowsPerCol);
      const stackRow = placementIndex % maxRowsPerCol;
      const leaf = leaves[leafIndex++];
      const x = startX + col * (leafWidth + options.gap);
      const y = stackRow * (leafHeight + options.gap);

      row.placements!.push({ item: leaf, x, y });
      row.items.push(leaf);
      row.width = Math.max(row.width, x + leaf.size.w);
      row.height = Math.max(row.height, y + leaf.size.h);
    }
  }

  return leafIndex < leaves.length ? leaves.slice(leafIndex) : [];
}

function scoreLayout(layout: PackResult, options: LayoutOptions): number {
  if (layout.rows.length === 0) return Infinity;

  const aspect = layout.w / layout.h;
  const ratioPenalty = Math.abs(aspect - options.aspectRatio);
  const containerArea = layout.w * layout.h;
  let totalChildArea = 0;
  for (const row of layout.rows) {
    for (const item of row.items) {
      totalChildArea += item.size.w * item.size.h;
    }
  }
  const wastedFraction = 1 - totalChildArea / containerArea;

  const maxW = layout.w - 2 * options.padding;
  let varianceSum = 0;
  for (const row of layout.rows) {
    const fill = maxW > 0 ? row.width / maxW : 1;
    varianceSum += (1 - fill) * (1 - fill);
  }
  const rowVariance = Math.sqrt(varianceSum / layout.rows.length);

  let heightVarianceSum = 0;
  let heightVarianceRows = 0;
  for (const row of layout.rows) {
    if (row.items.length <= 1) continue;
    let hasLeaf = false;
    let hasSubtree = false;
    let maxHeight = 0;
    let minHeight = Infinity;
    for (const item of row.items) {
      maxHeight = Math.max(maxHeight, item.size.h);
      minHeight = Math.min(minHeight, item.size.h);
      if (item._effectiveLeaf) hasLeaf = true;
      else hasSubtree = true;
    }
    if (hasLeaf && hasSubtree) continue;
    if (maxHeight > 0) {
      heightVarianceSum += (maxHeight - minHeight) / maxHeight;
      heightVarianceRows++;
    }
  }
  const heightVariance = heightVarianceRows > 0 ? heightVarianceSum / heightVarianceRows : 0;

  let lastRowPenalty = 0;
  if (layout.rows.length > 1) {
    const lastWidth = layout.rows[layout.rows.length - 1].width;
    const firstWidth = layout.rows[0].width;
    if (firstWidth > 0) lastRowPenalty = Math.max(0, 1 - lastWidth / firstWidth) * 0.5;
  }

  return (
    ratioPenalty * 3.0 +
    wastedFraction * 2.0 +
    rowVariance * 1.5 +
    heightVariance * 2.5 +
    lastRowPenalty
  );
}

function sortChildren(children: LayoutNode[], sortMode: LayoutOptions['sortMode']): void {
  children.sort((a, b) => {
    if (sortMode === 'subtrees' && a._effectiveLeaf !== b._effectiveLeaf) {
      return a._effectiveLeaf ? 1 : -1;
    }
    if (sortMode === 'alphabetical') {
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    }
    return a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}

function positionRoots(roots: LayoutNode[], options: LayoutOptions): void {
  const rows = computeRootRows(roots, options);
  const maxRowWidth = Math.max(...rows.map((row) => row.width), 0);
  let cursorY = options.viewMargin;

  for (const row of rows) {
    let cursorX = options.viewMargin + Math.max(0, (maxRowWidth - row.width) / 2);
    for (const root of row.items) {
      root.position = { x: cursorX, y: cursorY };
      root.depth = 0;
      positionChildren(root, options);
      cursorX += root.size.w + options.rootGap;
    }
    cursorY += row.height + options.rootGap;
  }
}

function computeRootRows(roots: LayoutNode[], options: LayoutOptions): RowMeta[] {
  if (roots.length <= 1) {
    return roots.map((root) => ({
      items: [root],
      height: root.size.h,
      width: root.size.w,
    }));
  }

  let bestRows: RowMeta[] | null = null;
  let bestScore = Infinity;

  for (let count = 1; count <= roots.length; count++) {
    const rows = packRootRows(roots, rootCandidateWidth(roots, count, options), options);
    const score = scoreRootRows(rows, options);
    if (score < bestScore) {
      bestScore = score;
      bestRows = rows;
    }
  }

  return bestRows ?? [];
}

function rootCandidateWidth(roots: LayoutNode[], count: number, options: LayoutOptions): number {
  let width = 0;
  for (let index = 0; index < count; index++) {
    if (index > 0) width += options.rootGap;
    width += roots[index].size.w;
  }
  return width;
}

function packRootRows(
  roots: LayoutNode[],
  targetContentWidth: number,
  options: LayoutOptions,
): RowMeta[] {
  const rows: LayoutNode[][] = [];
  let currentRow: LayoutNode[] = [];
  let currentRowWidth = 0;

  for (const root of roots) {
    const needed = currentRow.length > 0 ? options.rootGap + root.size.w : root.size.w;
    if (currentRow.length > 0 && currentRowWidth + needed > targetContentWidth) {
      rows.push(currentRow);
      currentRow = [root];
      currentRowWidth = root.size.w;
    } else {
      currentRow.push(root);
      currentRowWidth += needed;
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  return rows.map((row) => {
    let width = 0;
    let height = 0;
    for (let index = 0; index < row.length; index++) {
      if (index > 0) width += options.rootGap;
      width += row[index].size.w;
      height = Math.max(height, row[index].size.h);
    }
    return { items: row, width, height };
  });
}

function scoreRootRows(rows: RowMeta[], options: LayoutOptions): number {
  if (rows.length === 0) return Infinity;

  const contentWidth = Math.max(...rows.map((row) => row.width), 0);
  const contentHeight =
    rows.reduce((total, row) => total + row.height, 0) + options.rootGap * (rows.length - 1);
  const totalWidth = contentWidth + 2 * options.viewMargin;
  const totalHeight = contentHeight + 2 * options.viewMargin;
  const aspect = totalWidth / totalHeight;
  const ratioPenalty = Math.abs(aspect - options.aspectRatio);

  let varianceSum = 0;
  for (const row of rows) {
    const fill = contentWidth > 0 ? row.width / contentWidth : 1;
    varianceSum += (1 - fill) * (1 - fill);
  }
  const rowVariance = Math.sqrt(varianceSum / rows.length);
  const lastRow = rows[rows.length - 1];
  const lastRowPenalty =
    rows.length > 1 && contentWidth > 0 ? Math.max(0, 1 - lastRow.width / contentWidth) * 0.35 : 0;

  return ratioPenalty * 3.0 + rowVariance * 1.5 + lastRowPenalty;
}

function positionChildren(node: LayoutNode, options: LayoutOptions): void {
  if (node._effectiveLeaf) return;

  let y = options.headerHeight;
  for (const row of node.rows) {
    let rowOffsetX = 0;
    if (options.alignment === 'center') {
      rowOffsetX = Math.max(0, (node.size.w - 2 * options.padding - row.width) / 2);
    } else if (options.alignment === 'right') {
      rowOffsetX = Math.max(0, node.size.w - 2 * options.padding - row.width);
    }

    if (row.placements && row.placements.length > 0) {
      for (const placement of row.placements) {
        placement.item.position = {
          x: node.position.x + options.padding + rowOffsetX + placement.x,
          y: node.position.y + y + placement.y,
        };
        placement.item.depth = node.depth + 1;
        positionChildren(placement.item, options);
      }
    } else {
      let x = options.padding + rowOffsetX;
      for (const child of row.items) {
        child.position = {
          x: node.position.x + x,
          y: node.position.y + y,
        };
        child.depth = node.depth + 1;
        positionChildren(child, options);
        x += child.size.w + options.gap;
      }
    }

    y += row.height + options.gap;
  }
}
