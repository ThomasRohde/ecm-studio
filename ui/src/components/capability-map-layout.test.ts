import { afterEach, describe, expect, it } from 'vitest';
import type { Capability } from '../api/types';
import { useAppStore } from '../store/app-store';
import {
  CAPABILITY_MAP_ALL_ROOTS,
  capabilityMapById,
  capabilityMapRootOptions,
  getCapabilityMapRoots,
  layoutCapabilityMap,
} from './capability-map-layout';

describe('capability map layout', () => {
  afterEach(() => {
    useAppStore.getState().reset();
  });

  it('returns all roots or exactly the selected subtree', () => {
    const model = capabilityModel();

    expect(getCapabilityMapRoots(model).map((node) => node.id)).toEqual(['sales', 'operations']);

    const selected = getCapabilityMapRoots(model, 'sales');
    expect(selected.map((node) => node.id)).toEqual(['sales']);
    expect(selected[0].children.map((node) => node.id)).toEqual(['direct-sales', 'partner-sales']);

    expect(getCapabilityMapRoots(model, 'missing')).toEqual([]);
    expect(
      capabilityMapRootOptions(model).find((option) => option.id === 'lead-capture')?.path,
    ).toBe('Sales / Direct Sales / Lead Capture');
  });

  it('hides descendants below max depth and marks boundary nodes as leaves', () => {
    const layout = layoutCapabilityMap(capabilityModel(), {
      rootId: 'sales',
      maxDepth: 1,
    });

    expect(layout).not.toBeNull();
    expect(layout!.nodes.map((node) => node.id)).toEqual([
      'sales',
      'direct-sales',
      'partner-sales',
    ]);
    expect(layout!.nodes.find((node) => node.id === 'sales')?._effectiveLeaf).toBe(false);
    expect(layout!.nodes.find((node) => node.id === 'direct-sales')?._effectiveLeaf).toBe(true);
    expect(layout!.nodes.find((node) => node.id === 'direct-sales')?.children).toEqual([]);
    expect(layout!.nodes.some((node) => node.id === 'lead-capture')).toBe(false);
  });

  it('produces deterministic layout for a mixed subtree and leaf model', () => {
    const first = layoutCapabilityMap(capabilityModel(), {
      rootId: CAPABILITY_MAP_ALL_ROOTS,
      maxDepth: -1,
    });
    const second = layoutCapabilityMap(capabilityModel(), {
      rootId: CAPABILITY_MAP_ALL_ROOTS,
      maxDepth: -1,
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(serializeLayout(first!)).toEqual(serializeLayout(second!));
    expect(first!.totalWidth).toBeGreaterThan(300);
    expect(first!.totalHeight).toBeGreaterThan(100);
  });

  it('resolves map node clicks to the existing selected capability store state', () => {
    const model = capabilityModel();
    const clicked = capabilityMapById(model).get('lead-capture') ?? null;

    useAppStore.getState().setSelected(clicked);

    expect(clicked?.name).toBe('Lead Capture');
    expect(useAppStore.getState().selectedId).toBe('lead-capture');
    expect(useAppStore.getState().selected?.name).toBe('Lead Capture');
  });
});

function serializeLayout(layout: NonNullable<ReturnType<typeof layoutCapabilityMap>>) {
  return {
    totalWidth: layout.totalWidth,
    totalHeight: layout.totalHeight,
    leafSize: layout.leafSize,
    nodes: layout.nodes.map((node) => ({
      id: node.id,
      depth: node.depth,
      effectiveLeaf: node._effectiveLeaf,
      size: node.size,
      position: node.position,
      children: node.children.map((child) => child.id),
    })),
  };
}

function capabilityModel(): Capability[] {
  const leadCapture = capability('lead-capture', 'Lead Capture', 0, 'direct-sales');
  const opportunityManagement = capability(
    'opportunity-management',
    'Opportunity Management',
    1,
    'direct-sales',
  );
  const onboarding = capability('partner-onboarding', 'Partner Onboarding', 0, 'partner-sales');
  const directSales = capability('direct-sales', 'Direct Sales', 0, 'sales', [
    leadCapture,
    opportunityManagement,
  ]);
  const partnerSales = capability('partner-sales', 'Partner Sales', 1, 'sales', [onboarding]);
  const sales = capability('sales', 'Sales', 0, null, [directSales, partnerSales]);
  const operations = capability('operations', 'Operations', 1, null, [
    capability('fulfillment', 'Fulfillment', 0, 'operations'),
  ]);
  return [sales, operations];
}

function capability(
  id: string,
  name: string,
  order: number,
  parentId: string | null,
  children: Capability[] = [],
): Capability {
  return {
    _t: 'capability',
    schema_version: '1.0',
    id,
    name,
    aliases: [],
    description: '',
    domain: '',
    type: children.length > 0 ? 'abstract' : 'leaf',
    parent_id: parentId,
    order,
    lifecycle_status: 'Draft',
    effective_from: null,
    effective_to: null,
    rationale: '',
    source_references: [],
    tags: [],
    steward_id: '',
    steward_department: '',
    created_at: '',
    updated_at: '',
    children,
  };
}
