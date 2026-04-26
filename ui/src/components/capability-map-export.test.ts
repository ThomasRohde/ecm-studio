import { describe, expect, it } from 'vitest';
import type { Capability, MapExportFormat, MapExportResult } from '../api/types';
import {
  buildCapabilityMapHtmlExport,
  buildCapabilityMapSvgExport,
  saveCapabilityMapExport,
  suggestedCapabilityMapExportFilename,
} from './capability-map-export';
import { CAPABILITY_MAP_ALL_ROOTS, layoutCapabilityMap } from './capability-map-layout';

const GENERATED_AT = '2026-01-01T00:00:00.000Z';

describe('capability map export', () => {
  it('builds deterministic SVG and marks the selected node', () => {
    const layout = layoutCapabilityMap(capabilityModel(), {
      rootId: CAPABILITY_MAP_ALL_ROOTS,
      maxDepth: -1,
    });
    expect(layout).not.toBeNull();

    const context = {
      layout: layout!,
      selectedId: 'lead-capture',
      rootLabel: 'All roots',
      maxDepth: -1,
      workspaceName: 'Demo',
      generatedAt: GENERATED_AT,
    };
    const first = buildCapabilityMapSvgExport(context);
    const second = buildCapabilityMapSvgExport(context);

    expect(first).toBe(second);
    expect(first).toContain('data-capability-map-node="lead-capture"');
    expect(first).toContain('stroke="#25636d" stroke-width="2"');
    expect(first).toContain('Root: All roots | Max depth: All');
  });

  it('exports only the current depth-pruned layout and escapes capability text', () => {
    const layout = layoutCapabilityMap(capabilityModel(), {
      rootId: 'sales',
      maxDepth: 1,
    });
    expect(layout).not.toBeNull();

    const svg = buildCapabilityMapSvgExport({
      layout: layout!,
      selectedId: null,
      rootLabel: 'Sales & Growth',
      maxDepth: 1,
      workspaceName: 'Demo <Workspace>',
      generatedAt: GENERATED_AT,
    });

    expect(svg).toContain('Sales &amp; &lt;Growth&gt;');
    expect(svg).toContain('data-node-description="Owns &quot;pipeline&quot; &amp; growth"');
    expect(svg).toContain('data-capability-map-node="direct-sales"');
    expect(svg).not.toContain('data-capability-map-node="lead-capture"');
  });

  it('builds self-contained HTML with embedded SVG, controls, and scope metadata', () => {
    const layout = layoutCapabilityMap(capabilityModel(), {
      rootId: 'sales',
      maxDepth: 1,
    });
    expect(layout).not.toBeNull();

    const html = buildCapabilityMapHtmlExport({
      layout: layout!,
      selectedId: 'direct-sales',
      rootLabel: 'Sales / Current',
      maxDepth: 1,
      workspaceName: 'Demo',
      generatedAt: GENERATED_AT,
    });

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(html).toContain('id="capability-search"');
    expect(html).toContain('id="reset-view"');
    expect(html).toContain('Sales / Current');
    expect(html).toContain('Depth 1');
    expect(html).toContain('grid-template-rows: auto minmax(0, 1fr) 24px');
    expect(html).not.toContain('inset: 72px 0 24px');
    expect(html).toContain('const viewport = document.getElementById');
  });

  it('saves SVG and HTML through the provided API using the current map scope', async () => {
    const layout = layoutCapabilityMap(capabilityModel(), {
      rootId: 'sales',
      maxDepth: 1,
    });
    expect(layout).not.toBeNull();

    const calls: Array<{
      format: MapExportFormat;
      content: string;
      suggestedFilename: string;
    }> = [];
    const save = async (
      format: MapExportFormat,
      content: string,
      suggestedFilename: string,
    ): Promise<MapExportResult> => {
      calls.push({ format, content, suggestedFilename });
      return { format, path: `C:\\Mock\\exports\\${suggestedFilename}` };
    };

    for (const format of ['svg', 'html'] as const) {
      await saveCapabilityMapExport({
        format,
        layout: layout!,
        selectedId: 'direct-sales',
        rootLabel: 'Sales',
        maxDepth: 1,
        workspaceName: 'Demo',
        generatedAt: GENERATED_AT,
        save,
      });
    }

    expect(calls.map((call) => call.format)).toEqual(['svg', 'html']);
    expect(calls.map((call) => call.suggestedFilename)).toEqual([
      suggestedCapabilityMapExportFilename('svg'),
      suggestedCapabilityMapExportFilename('html'),
    ]);
    for (const call of calls) {
      expect(call.content).toContain('Root: Sales');
      expect(call.content).toContain('Max depth: 1');
      expect(call.content).toContain('data-capability-map-node="direct-sales"');
      expect(call.content).not.toContain('data-capability-map-node="lead-capture"');
    }
  });
});

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
  const sales = capability(
    'sales',
    'Sales & <Growth>',
    0,
    null,
    [directSales, partnerSales],
    'Owns "pipeline" & growth',
  );
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
  description = '',
): Capability {
  return {
    _t: 'capability',
    schema_version: '1.0',
    id,
    name,
    aliases: [],
    description,
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
