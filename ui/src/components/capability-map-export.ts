import type { MapExportFormat, MapExportResult } from '../api/types';
import type { LayoutNode, LayoutResult } from './capability-map-layout';
import { DEFAULT_DEPTH_COLORS, DEFAULT_LEAF_COLOR } from './capability-map-layout';

const PANEL_BACKGROUND = '#fffdf8';
const TEXT_COLOR = '#000000';
const NODE_STROKE = '#CCCCCC';
const SELECTED_STROKE = '#25636d';
const SEARCH_STROKE = '#b85c00';
const PARENT_FONT = "13px 'Segoe UI', system-ui, sans-serif";
const LEAF_FONT = "11px 'Segoe UI', system-ui, sans-serif";
const EXPORT_TITLE = 'Capability Map';

export const CAPABILITY_MAP_EXPORT_OPTIONS: ReadonlyArray<{
  format: MapExportFormat;
  label: string;
}> = [
  { format: 'svg', label: 'SVG' },
  { format: 'html', label: 'HTML' },
];

export interface CapabilityMapExportContext {
  layout: LayoutResult;
  selectedId?: string | null;
  rootLabel: string;
  maxDepth: number;
  workspaceName?: string | null;
  generatedAt?: Date | string;
}

export interface SaveCapabilityMapExportOptions extends CapabilityMapExportContext {
  format: MapExportFormat;
  save: (
    format: MapExportFormat,
    content: string,
    suggestedFilename: string,
  ) => Promise<MapExportResult | null>;
}

export function buildCapabilityMapExport(
  format: MapExportFormat,
  context: CapabilityMapExportContext,
): string {
  if (format === 'svg') return buildCapabilityMapSvgExport(context);
  return buildCapabilityMapHtmlExport(context);
}

export function buildCapabilityMapSvgExport(context: CapabilityMapExportContext): string {
  const generatedAt = formatGeneratedAt(context.generatedAt);
  const description = exportDescription(context, generatedAt);
  const roots = context.layout.nodes.filter((node) => node.depth === 0);
  const body = [
    `<title>${escapeXml(EXPORT_TITLE)}</title>`,
    `<desc>${escapeXml(description)}</desc>`,
    `<rect fill="${PANEL_BACKGROUND}" height="${context.layout.totalHeight}" width="${context.layout.totalWidth}" x="0" y="0" />`,
    roots.map((root) => renderSvgNode(root, context.selectedId ?? null)).join('\n'),
  ].join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${context.layout.totalWidth}" height="${context.layout.totalHeight}" viewBox="0 0 ${context.layout.totalWidth} ${context.layout.totalHeight}" role="img">`,
    body,
    '</svg>',
  ].join('\n');
}

export function buildCapabilityMapHtmlExport(context: CapabilityMapExportContext): string {
  const generatedAt = formatGeneratedAt(context.generatedAt);
  const svg = buildCapabilityMapSvgExport(context).replace(
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '',
  );
  const maxDepthLabel = capabilityMapDepthLabel(context.maxDepth);
  const workspaceLabel = context.workspaceName?.trim() || 'ECMS workspace';
  const nodeCount = context.layout.nodes.length;

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(`${EXPORT_TITLE} - ${workspaceLabel}`)}</title>`,
    '<style>',
    htmlStyles(),
    '</style>',
    '</head>',
    '<body>',
    '<header class="topbar">',
    '<div>',
    `<h1>${escapeHtml(EXPORT_TITLE)}</h1>`,
    `<p>${escapeHtml(workspaceLabel)} · ${escapeHtml(context.rootLabel)} · Depth ${escapeHtml(maxDepthLabel)} · ${nodeCount} capabilities · ${escapeHtml(generatedAt)}</p>`,
    '</div>',
    '<div class="tools">',
    '<label class="search-label" for="capability-search">Search</label>',
    '<input id="capability-search" type="search" autocomplete="off" placeholder="Capability name or description" />',
    '<button id="zoom-out" type="button">-</button>',
    '<button id="zoom-in" type="button">+</button>',
    '<button id="reset-view" type="button">Reset</button>',
    '</div>',
    '</header>',
    '<main id="viewport" class="viewport">',
    '<div id="surface" class="surface">',
    svg,
    '</div>',
    '</main>',
    '<footer id="search-status" class="status" aria-live="polite"></footer>',
    '<script>',
    htmlScript(),
    '</script>',
    '</body>',
    '</html>',
  ].join('\n');
}

export async function saveCapabilityMapExport({
  format,
  save,
  ...context
}: SaveCapabilityMapExportOptions): Promise<MapExportResult | null> {
  const content = buildCapabilityMapExport(format, context);
  return save(format, content, suggestedCapabilityMapExportFilename(format));
}

export function suggestedCapabilityMapExportFilename(format: MapExportFormat): string {
  return `capability-map.${format}`;
}

export function capabilityMapDepthLabel(depth: number): string {
  if (depth === -1) return 'All';
  if (depth === 0) return '0 (root only)';
  return String(depth);
}

function renderSvgNode(node: LayoutNode, selectedId: string | null): string {
  const isLeaf = node._effectiveLeaf;
  const fill = isLeaf
    ? DEFAULT_LEAF_COLOR
    : DEFAULT_DEPTH_COLORS[Math.min(node.depth, DEFAULT_DEPTH_COLORS.length - 1)];
  const fontSize = isLeaf ? 11 : 13;
  const lineHeight = Math.max(fontSize * 1.2, fontSize + 1);
  const textBoxHeight = isLeaf ? node.size.h : 48;
  const lines = wrapLabel(node.name, Math.max(1, node.size.w - 24), fontSize, textBoxHeight);
  const textY = isLeaf ? node.position.y + node.size.h / 2 : node.position.y + 24;
  const isSelected = selectedId === node.id;
  const rectClass = [
    'capability-node',
    isLeaf ? 'capability-node-leaf' : 'capability-node-parent',
    isSelected ? 'selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const childContent = !isLeaf
    ? node.children.map((child) => renderSvgNode(child, selectedId)).join('\n')
    : '';
  const title = node.description ? `${node.name}\n${node.description}` : node.name;

  return [
    `<g data-capability-map-entry="${escapeAttribute(node.id)}">`,
    `<rect class="${rectClass}" data-capability-map-node="${escapeAttribute(node.id)}" data-node-name="${escapeAttribute(node.name)}" data-node-description="${escapeAttribute(node.description ?? '')}" fill="${fill}" height="${node.size.h}" rx="4" ry="4" stroke="${isSelected ? SELECTED_STROKE : NODE_STROKE}" stroke-width="${isSelected ? 2 : 1}" width="${node.size.w}" x="${node.position.x}" y="${node.position.y}">`,
    `<title>${escapeXml(title)}</title>`,
    '</rect>',
    `<text dominant-baseline="central" pointer-events="none" style="fill:${TEXT_COLOR};font:${isLeaf ? LEAF_FONT : PARENT_FONT};font-weight:${isLeaf ? 400 : 700};user-select:none" text-anchor="middle">`,
    lines
      .map(
        (line, index) =>
          `<tspan x="${node.position.x + node.size.w / 2}" y="${textY + (index - (lines.length - 1) / 2) * lineHeight}">${escapeXml(line)}</tspan>`,
      )
      .join('\n'),
    '</text>',
    childContent,
    '</g>',
  ]
    .filter(Boolean)
    .join('\n');
}

function exportDescription(context: CapabilityMapExportContext, generatedAt: string): string {
  const workspaceLabel = context.workspaceName?.trim() || 'ECMS workspace';
  return [
    workspaceLabel,
    `Root: ${context.rootLabel}`,
    `Max depth: ${capabilityMapDepthLabel(context.maxDepth)}`,
    `${context.layout.nodes.length} capabilities`,
    `Generated: ${generatedAt}`,
  ].join(' | ');
}

function htmlStyles(): string {
  return `
:root {
  color-scheme: light;
  font-family: "Segoe UI", system-ui, sans-serif;
  color: #1f272c;
  background: #f6f4ef;
}
* { box-sizing: border-box; }
body {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) 24px;
  height: 100vh;
  margin: 0;
  overflow: hidden;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 72px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(33, 49, 58, 0.16);
  background: #fffdf8;
}
h1 { margin: 0 0 4px; font-size: 18px; line-height: 1.2; }
p { margin: 0; color: #5f6f76; font-size: 12px; }
.tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.search-label { color: #5f6f76; font-size: 12px; font-weight: 600; }
input {
  width: min(320px, 40vw);
  min-width: 180px;
  border: 1px solid rgba(33, 49, 58, 0.24);
  border-radius: 4px;
  padding: 7px 9px;
  font: inherit;
}
button {
  border: 1px solid rgba(33, 49, 58, 0.22);
  border-radius: 4px;
  background: #ffffff;
  color: #1f272c;
  padding: 7px 10px;
  font: inherit;
  cursor: pointer;
}
button:hover { border-color: ${SELECTED_STROKE}; background: rgba(37, 99, 109, 0.10); }
.viewport {
  position: relative;
  min-height: 0;
  overflow: hidden;
  background: ${PANEL_BACKGROUND};
  cursor: grab;
}
.viewport.dragging { cursor: grabbing; }
.surface {
  position: absolute;
  inset: 0 auto auto 0;
  transform-origin: 0 0;
}
svg { display: block; }
.capability-node { transition: stroke 120ms ease, stroke-width 120ms ease, filter 120ms ease; }
.capability-node.search-match {
  stroke: ${SEARCH_STROKE};
  stroke-width: 3;
  filter: drop-shadow(0 0 4px rgba(184, 92, 0, 0.45));
}
.capability-node.selected,
.capability-node.selected.search-match {
  stroke: ${SELECTED_STROKE};
  stroke-width: 3;
  filter: drop-shadow(0 0 4px rgba(37, 99, 109, 0.45));
}
.status {
  height: 24px;
  overflow: hidden;
  padding: 4px 12px;
  border-top: 1px solid rgba(33, 49, 58, 0.16);
  background: #fffdf8;
  color: #5f6f76;
  font-size: 12px;
}
@media (max-width: 760px) {
  .topbar { align-items: stretch; flex-direction: column; }
  .tools { justify-content: flex-start; }
  input { width: 100%; }
}
`.trim();
}

function htmlScript(): string {
  return `
const viewport = document.getElementById('viewport');
const surface = document.getElementById('surface');
const search = document.getElementById('capability-search');
const status = document.getElementById('search-status');
const zoomIn = document.getElementById('zoom-in');
const zoomOut = document.getElementById('zoom-out');
const reset = document.getElementById('reset-view');
const nodes = Array.from(document.querySelectorAll('[data-capability-map-node]'));
let scale = 1;
let panX = 20;
let panY = 20;
let dragging = false;
let dragStart = { x: 0, y: 0, panX: 0, panY: 0 };

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function updateTransform() {
  surface.style.transform = 'translate(' + panX + 'px, ' + panY + 'px) scale(' + scale + ')';
}

function setScale(next) {
  scale = clamp(next, 0.15, 3);
  updateTransform();
}

function runSearch() {
  const query = search.value.trim().toLowerCase();
  let matches = 0;
  for (const node of nodes) {
    const haystack = ((node.dataset.nodeName || '') + ' ' + (node.dataset.nodeDescription || '')).toLowerCase();
    const matched = query.length > 0 && haystack.includes(query);
    node.classList.toggle('search-match', matched);
    if (matched) matches += 1;
  }
  status.textContent = query ? matches + ' matches' : nodes.length + ' capabilities';
}

viewport.addEventListener('wheel', (event) => {
  event.preventDefault();
  setScale(scale * (event.deltaY > 0 ? 0.9 : 1.1));
}, { passive: false });

viewport.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  dragging = true;
  viewport.classList.add('dragging');
  dragStart = { x: event.clientX, y: event.clientY, panX, panY };
});

window.addEventListener('mousemove', (event) => {
  if (!dragging) return;
  panX = dragStart.panX + event.clientX - dragStart.x;
  panY = dragStart.panY + event.clientY - dragStart.y;
  updateTransform();
});

window.addEventListener('mouseup', () => {
  dragging = false;
  viewport.classList.remove('dragging');
});

zoomIn.addEventListener('click', () => setScale(scale * 1.2));
zoomOut.addEventListener('click', () => setScale(scale * 0.8));
reset.addEventListener('click', () => {
  scale = 1;
  panX = 20;
  panY = 20;
  updateTransform();
});
search.addEventListener('input', runSearch);
updateTransform();
runSearch();
`.trim();
}

function formatGeneratedAt(value: Date | string | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) return value;
  return new Date().toISOString();
}

function wrapLabel(
  text: string,
  maxWidth: number,
  fontSize: number,
  textBoxHeight: number,
): string[] {
  const lineHeight = Math.max(fontSize * 1.2, fontSize + 1);
  const maxLines = Math.max(1, Math.floor(textBoxHeight / lineHeight));
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return [''];
  const measure = (value: string) => estimateTextWidth(value, fontSize);
  if (measure(compact) <= maxWidth) return [compact];

  const lines: string[] = [];
  let current = '';
  for (const word of compact.split(' ')) {
    if (!current) {
      if (measure(word) <= maxWidth) current = word;
      else lines.push(...splitLongToken(word, maxWidth, measure));
      continue;
    }

    const candidate = `${current} ${word}`;
    if (measure(candidate) <= maxWidth) current = candidate;
    else {
      lines.push(current);
      current = measure(word) <= maxWidth ? word : '';
      if (!current) lines.push(...splitLongToken(word, maxWidth, measure));
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;

  const visible = lines.slice(0, Math.max(0, maxLines - 1));
  visible.push(
    truncateWithEllipsis(lines.slice(Math.max(0, maxLines - 1)).join(' '), maxWidth, measure),
  );
  return visible;
}

function splitLongToken(
  token: string,
  maxWidth: number,
  measure: (value: string) => number,
): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const char of token) {
    const candidate = current + char;
    if (current && measure(candidate) > maxWidth) {
      chunks.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [token];
}

function truncateWithEllipsis(
  text: string,
  maxWidth: number,
  measure: (value: string) => number,
): string {
  const ellipsis = '...';
  if (measure(text) <= maxWidth) return text;
  let value = text.trimEnd();
  while (value.length > 0 && measure(`${value}${ellipsis}`) > maxWidth) {
    value = value.slice(0, -1).trimEnd();
  }
  return value ? `${value}${ellipsis}` : ellipsis;
}

function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    if (char === ' ') width += fontSize * 0.32;
    else if (/[ilI.,'`:;!]/.test(char)) width += fontSize * 0.35;
    else if (/[MW@#%&]/.test(char)) width += fontSize * 0.78;
    else width += fontSize * 0.58;
  }
  return width;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(value: string): string {
  return escapeXml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '&#10;');
}
