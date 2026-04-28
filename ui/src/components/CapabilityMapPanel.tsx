import {
  Button,
  Input,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Text,
} from '@fluentui/react-components';
import { ArrowDownloadRegular, ZoomFitRegular } from '@fluentui/react-icons';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/bridge';
import type { CapabilityMapColorScheme, MapExportFormat } from '../api/types';
import {
  capabilityMapDensityLayoutOptions,
  DEFAULT_CAPABILITY_MAP_ALIGNMENT,
  DEFAULT_CAPABILITY_MAP_LAYOUT_DENSITY,
  DEFAULT_CAPABILITY_MAP_TARGET_ASPECT_RATIO,
} from '../capability-map-settings';
import { errorMessage, notify } from '../notifications/notify';
import { useAppStore } from '../store/app-store';
import {
  CAPABILITY_MAP_EXPORT_OPTIONS,
  capabilityMapDepthLabel,
  saveCapabilityMapExport,
} from './capability-map-export';
import type { CapabilityMapRootOption, LayoutNode, LayoutResult } from './capability-map-layout';
import {
  CAPABILITY_MAP_ALL_ROOTS,
  capabilityMapById,
  capabilityMapNodeFill,
  capabilityMapRootOptions,
  DEFAULT_CAPABILITY_MAP_COLOR_SCHEME,
  layoutCapabilityMap,
} from './capability-map-layout';

const INITIAL_PAN = { x: 20, y: 20 };
const MIN_SCALE = 0.15;
const MAX_SCALE = 3;
const DEPTH_OPTIONS = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8];
const PARENT_FONT = '13px "Segoe UI", system-ui, sans-serif';
const LEAF_FONT = '11px "Segoe UI", system-ui, sans-serif';
const SELECTED_STROKE = 'var(--accent)';
const DEFAULT_STROKE = '#CCCCCC';

export function CapabilityMapPanel() {
  const workspace = useAppStore((state) => state.workspace);
  const tree = useAppStore((state) => state.tree);
  const setSelected = useAppStore((state) => state.setSelected);
  const [rootId, setRootId] = useState(CAPABILITY_MAP_ALL_ROOTS);
  const [rootQuery, setRootQuery] = useState('');
  const [maxDepth, setMaxDepth] = useState(-1);
  const [pan, setPan] = useState(INITIAL_PAN);
  const [scale, setScale] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<MapExportFormat | null>(null);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const capabilityById = useMemo(() => capabilityMapById(tree), [tree]);
  const rootOptions = useMemo(() => capabilityMapRootOptions(tree), [tree]);
  const targetAspectRatio =
    workspace?.settings.capability_map.target_aspect_ratio ??
    DEFAULT_CAPABILITY_MAP_TARGET_ASPECT_RATIO;
  const layoutDensity =
    workspace?.settings.capability_map.layout_density ?? DEFAULT_CAPABILITY_MAP_LAYOUT_DENSITY;
  const alignment =
    workspace?.settings.capability_map.alignment ?? DEFAULT_CAPABILITY_MAP_ALIGNMENT;
  const colorScheme =
    workspace?.settings.capability_map.color_scheme ?? DEFAULT_CAPABILITY_MAP_COLOR_SCHEME;
  const visibleRootOptions = useMemo(
    () => visibleOptions(rootOptions, rootId, rootQuery),
    [rootOptions, rootId, rootQuery],
  );
  const layout = useMemo(
    () =>
      layoutCapabilityMap(tree, {
        rootId,
        maxDepth,
        layoutOptions: {
          ...capabilityMapDensityLayoutOptions(layoutDensity),
          aspectRatio: targetAspectRatio,
          alignment,
        },
      }),
    [tree, rootId, maxDepth, targetAspectRatio, layoutDensity, alignment],
  );

  useEffect(() => {
    if (rootId === CAPABILITY_MAP_ALL_ROOTS) return;
    if (!rootOptions.some((option) => option.id === rootId)) {
      setRootId(CAPABILITY_MAP_ALL_ROOTS);
    }
  }, [rootId, rootOptions]);

  useEffect(() => {
    setRootId(CAPABILITY_MAP_ALL_ROOTS);
    setRootQuery('');
    setPan(INITIAL_PAN);
    setScale(1);
  }, [workspace?.path]);

  const selectNode = useCallback(
    (nodeId: string) => {
      const capability = capabilityById.get(nodeId);
      if (capability) setSelected(capability);
    },
    [capabilityById, setSelected],
  );

  const resetView = useCallback(() => {
    setPan(INITIAL_PAN);
    setScale(1);
  }, []);

  const exportMap = useCallback(
    async (format: MapExportFormat) => {
      if (!layout) return;
      const rootLabel = selectedRootLabel(rootOptions, rootId);

      try {
        setExportingFormat(format);
        const result = await saveCapabilityMapExport({
          format,
          layout,
          maxDepth,
          rootLabel,
          selectedId: useAppStore.getState().selectedId,
          workspaceName: workspace?.name,
          colorScheme,
          save: api.map.export,
        });
        if (!result) return;
        notify.success({
          intent: 'model.exported',
          title: 'Capability map exported',
          body: `${format.toUpperCase()} map exported to ${result.path}.`,
          source: 'model',
          dedupeKey: `capability-map.export.${result.path}`,
          action: { label: 'Open capability map', panelId: 'map' },
        });
      } catch (error) {
        notify.error({
          intent: 'operation.failed',
          title: 'Could not export capability map',
          body: errorMessage(error),
          source: 'model',
          action: { label: 'Open capability map', panelId: 'map' },
        });
      } finally {
        setExportingFormat(null);
      }
    },
    [colorScheme, layout, maxDepth, rootId, rootOptions, workspace?.name],
  );

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    setScale((current) => clamp(current * delta, MIN_SCALE, MAX_SCALE));
  }, []);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      setDragging(true);
      dragStart.current = {
        x: event.clientX,
        y: event.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    },
    [pan],
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!dragging) return;
      setPan({
        x: dragStart.current.panX + event.clientX - dragStart.current.x,
        y: dragStart.current.panY + event.clientY - dragStart.current.y,
      });
    },
    [dragging],
  );

  const stopDragging = useCallback(() => setDragging(false), []);

  return (
    <section className="panel capability-map-panel">
      <div className="capability-map-toolbar">
        <label className="capability-map-field root-filter">
          <span>Find root</span>
          <Input
            aria-label="Find map root"
            onChange={(_, data) => setRootQuery(data.value)}
            placeholder="Capability path"
            value={rootQuery}
          />
        </label>
        <label className="capability-map-field root-select">
          <span>Root</span>
          <select
            aria-label="Capability map root"
            className="select"
            onChange={(event) => setRootId(event.target.value)}
            value={rootId}
          >
            <option value={CAPABILITY_MAP_ALL_ROOTS}>All roots</option>
            {visibleRootOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.path}
              </option>
            ))}
          </select>
        </label>
        <label className="capability-map-field depth-select">
          <span>Max depth</span>
          <select
            aria-label="Capability map max depth"
            className="select"
            onChange={(event) => setMaxDepth(Number(event.target.value))}
            value={maxDepth}
          >
            {DEPTH_OPTIONS.map((depth) => (
              <option key={depth} value={depth}>
                {capabilityMapDepthLabel(depth)}
              </option>
            ))}
          </select>
        </label>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <MenuButton
              disabled={!layout || exportingFormat !== null}
              icon={<ArrowDownloadRegular />}
            >
              {exportingFormat ? 'Exporting...' : 'Export'}
            </MenuButton>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {CAPABILITY_MAP_EXPORT_OPTIONS.map((option) => (
                <MenuItem key={option.format} onClick={() => void exportMap(option.format)}>
                  {option.label}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
        <Button icon={<ZoomFitRegular />} onClick={resetView}>
          Reset
        </Button>
        {layout ? (
          <Text className="capability-map-meta" size={200}>
            {layout.nodes.length} shown, {Math.round(scale * 100)}%
          </Text>
        ) : null}
      </div>

      <MapCanvas
        dragging={dragging}
        colorScheme={colorScheme}
        layout={layout}
        pan={pan}
        scale={scale}
        status={mapStatus(workspace !== null, tree.length, layout)}
        onMouseDown={handleMouseDown}
        onMouseLeave={stopDragging}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDragging}
        onSelectNode={selectNode}
        onWheel={handleWheel}
      />
    </section>
  );
}

const MapCanvas = memo(function MapCanvas({
  dragging,
  colorScheme,
  layout,
  onMouseDown,
  onMouseLeave,
  onMouseMove,
  onMouseUp,
  onSelectNode,
  onWheel,
  pan,
  scale,
  status,
}: {
  dragging: boolean;
  colorScheme: CapabilityMapColorScheme;
  layout: LayoutResult | null;
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
  onMouseMove: (event: React.MouseEvent<HTMLDivElement>) => void;
  onMouseUp: () => void;
  onSelectNode: (nodeId: string) => void;
  onWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
  pan: { x: number; y: number };
  scale: number;
  status: string | null;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  if (status) {
    return (
      <div className="capability-map-empty">
        <Text>{status}</Text>
      </div>
    );
  }

  if (!layout) return null;

  return (
    <div
      className={`capability-map-canvas ${dragging ? 'dragging' : ''}`}
      onMouseDown={onMouseDown}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onWheel={onWheel}
    >
      <div
        className="capability-map-surface"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
      >
        <StaticMapSvg
          colorScheme={colorScheme}
          layout={layout}
          onSelectNode={onSelectNode}
          svgRef={svgRef}
        />
      </div>
    </div>
  );
});

const StaticMapSvg = memo(function StaticMapSvg({
  colorScheme,
  layout,
  onSelectNode,
  svgRef,
}: {
  colorScheme: CapabilityMapColorScheme;
  layout: LayoutResult;
  onSelectNode: (nodeId: string) => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
}) {
  const roots = useMemo(() => layout.nodes.filter((node) => node.depth === 0), [layout]);

  const handleSvgMouseDown = (event: React.MouseEvent<SVGSVGElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const rect = target.closest<SVGRectElement>('[data-capability-map-node]');
    const nodeId = rect?.dataset.capabilityMapNode;
    if (!nodeId) return;

    event.preventDefault();
    event.stopPropagation();
    if (svgRef.current) moveMapHighlight(svgRef.current, nodeId);
    onSelectNode(nodeId);
  };

  return (
    <svg
      height={layout.totalHeight}
      onMouseDown={handleSvgMouseDown}
      ref={svgRef}
      viewBox={`0 0 ${layout.totalWidth} ${layout.totalHeight}`}
      width={layout.totalWidth}
    >
      <rect
        fill="var(--panel-bg)"
        height={layout.totalHeight}
        width={layout.totalWidth}
        x={0}
        y={0}
      />
      {roots.map((root) => renderNodeBox(root, colorScheme))}
      <SelectedMapHighlight layout={layout} svgRef={svgRef} />
    </svg>
  );
});

function renderNodeBox(node: LayoutNode, colorScheme: CapabilityMapColorScheme): React.JSX.Element {
  const isLeaf = node._effectiveLeaf;
  const fill = capabilityMapNodeFill(node, colorScheme);
  const fontSize = isLeaf ? 11 : 13;
  const lineHeight = Math.max(fontSize * 1.2, fontSize + 1);
  const textBoxHeight = isLeaf ? node.size.h : 48;
  const lines = wrapLabel(node.name, Math.max(1, node.size.w - 24), fontSize, textBoxHeight);
  const textY = isLeaf ? node.position.y + node.size.h / 2 : node.position.y + 24;

  return (
    <g key={node.id}>
      <rect
        data-capability-map-node={node.id}
        fill={fill}
        height={node.size.h}
        rx={4}
        ry={4}
        stroke={DEFAULT_STROKE}
        strokeWidth={1}
        style={{ cursor: 'pointer' }}
        width={node.size.w}
        x={node.position.x}
        y={node.position.y}
      >
        <title>{node.name}</title>
      </rect>
      <text
        dominantBaseline="central"
        pointerEvents="none"
        style={{
          fill: '#000000',
          font: isLeaf ? LEAF_FONT : PARENT_FONT,
          fontWeight: isLeaf ? 400 : 700,
          userSelect: 'none',
        }}
        textAnchor="middle"
      >
        {lines.map((line, index) => (
          <tspan
            key={`${node.id}-line-${index}`}
            x={node.position.x + node.size.w / 2}
            y={textY + (index - (lines.length - 1) / 2) * lineHeight}
          >
            {line}
          </tspan>
        ))}
      </text>
      {!isLeaf ? node.children.map((child) => renderNodeBox(child, colorScheme)) : null}
    </g>
  );
}

function SelectedMapHighlight({
  layout,
  svgRef,
}: {
  layout: LayoutResult;
  svgRef: React.RefObject<SVGSVGElement | null>;
}) {
  const selectedId = useAppStore((state) => state.selectedId);
  const previousSelectedRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const previousId = previousSelectedRef.current;
    if (previousId && previousId !== selectedId) {
      setNodeStroke(svg, previousId, DEFAULT_STROKE, '1');
    }

    if (selectedId) {
      const updated = setNodeStroke(svg, selectedId, SELECTED_STROKE, '2', true);
      previousSelectedRef.current = updated ? selectedId : null;
    } else {
      previousSelectedRef.current = null;
    }
  }, [layout, selectedId, svgRef]);

  return null;
}

function setNodeStroke(
  svg: SVGSVGElement,
  nodeId: string,
  stroke: string,
  strokeWidth: string,
  selected = false,
): boolean {
  const rect = svg.querySelector<SVGRectElement>(
    `[data-capability-map-node="${escapeAttributeSelectorValue(nodeId)}"]`,
  );
  if (!rect) return false;
  rect.setAttribute('stroke', stroke);
  rect.setAttribute('stroke-width', strokeWidth);
  if (selected) {
    rect.dataset.capabilityMapSelected = 'true';
  } else {
    delete rect.dataset.capabilityMapSelected;
  }
  return true;
}

function moveMapHighlight(svg: SVGSVGElement, nodeId: string): boolean {
  const current = svg.querySelector<SVGRectElement>('[data-capability-map-selected="true"]');
  if (current?.dataset.capabilityMapNode && current.dataset.capabilityMapNode !== nodeId) {
    current.setAttribute('stroke', DEFAULT_STROKE);
    current.setAttribute('stroke-width', '1');
    delete current.dataset.capabilityMapSelected;
  }
  return setNodeStroke(svg, nodeId, SELECTED_STROKE, '2', true);
}

function escapeAttributeSelectorValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function visibleOptions(
  options: CapabilityMapRootOption[],
  selectedRootId: string,
  query: string,
): CapabilityMapRootOption[] {
  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? options.filter((option) => option.path.toLowerCase().includes(normalized))
    : options;
  const selected = options.find((option) => option.id === selectedRootId);
  if (!selected || filtered.some((option) => option.id === selected.id)) return filtered;
  return [selected, ...filtered];
}

function mapStatus(
  workspaceOpen: boolean,
  rootCount: number,
  layout: LayoutResult | null,
): string | null {
  if (!workspaceOpen) return 'Open or initialize a workspace first.';
  if (rootCount === 0) return 'No capabilities yet.';
  if (!layout) return 'No matching capability root.';
  return null;
}

function selectedRootLabel(options: CapabilityMapRootOption[], rootId: string): string {
  if (rootId === CAPABILITY_MAP_ALL_ROOTS) return 'All roots';
  return options.find((option) => option.id === rootId)?.path ?? 'Selected root';
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
