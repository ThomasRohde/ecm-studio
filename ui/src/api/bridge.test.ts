import { beforeEach, describe, expect, it } from 'vitest';
import { api } from './bridge';
import { canApplyImportPreview } from '../components/WorkspacePanels';
import type { Capability, ImportPreview } from './types';

beforeEach(() => {
  (globalThis as unknown as { window: unknown }).window = {};
});

describe('bridge mock fallback', () => {
  it('initializes a workspace and creates a capability without pywebview', async () => {
    const workspace = await api.workspace.init('C:/tmp/ecm', 'Demo');
    const root = await api.capabilities.create({ name: 'Payments', type: 'abstract' });
    const tree = await api.capabilities.listTree();

    expect(workspace.name).toBe('Demo');
    expect(root.name).toBe('Payments');
    expect(tree[0].name).toBe('Payments');
  });

  it('supports theme, picker, import/export, and guided git mocks', async () => {
    const settings = await api.settings.update({ theme_mode: 'dark' });
    const workspace = await api.workspace.pickInit('Picked');
    const exportResult = await api.models.export('json_bundle');
    const preview = await api.models.importPreview(null, 'append');
    const branch = await api.git.createBranch('work/mock');
    const status = await api.git.status();

    expect(settings.resolved_theme).toBe('dark');
    expect(workspace?.name).toBe('Picked');
    expect(exportResult?.format).toBe('json_bundle');
    expect(preview?.invalid).toBe(0);
    expect(branch.branch).toBe('work/mock');
    expect(status.branch).toBe('work/mock');
  });

  it('normalizes order when mock capabilities move through the bridge', async () => {
    const suffix = String(Date.now());
    await api.workspace.init(`C:/tmp/ecm-order-${suffix}`, 'Ordering');
    const root = await api.capabilities.create({ name: `Root ${suffix}` });
    const first = await api.capabilities.create({ name: `First ${suffix}`, parent_id: root.id });
    const second = await api.capabilities.create({ name: `Second ${suffix}`, parent_id: root.id });
    const third = await api.capabilities.create({ name: `Third ${suffix}`, parent_id: root.id });

    await api.capabilities.move(third.id, root.id, 0);
    const tree = await api.capabilities.listTree();
    const movedRoot = flatten(tree).find((capability) => capability.id === root.id);

    expect(movedRoot?.children?.map((capability) => capability.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
    expect(movedRoot?.children?.map((capability) => capability.order)).toEqual([0, 1, 2]);
  });

  it('saves metadata and parent changes through the combined bridge method', async () => {
    const suffix = String(Date.now());
    await api.workspace.init(`C:/tmp/ecm-save-${suffix}`, 'Save');
    const source = await api.capabilities.create({ name: `Source ${suffix}` });
    const target = await api.capabilities.create({ name: `Target ${suffix}` });
    const child = await api.capabilities.create({ name: `Child ${suffix}`, parent_id: source.id });

    const saved = await api.capabilities.save(child.id, {
      ...child,
      name: `Renamed ${suffix}`,
      domain: 'Operations',
    }, target.id);
    const tree = await api.capabilities.listTree();
    const movedTarget = flatten(tree).find((capability) => capability.id === target.id);

    expect(saved.name).toBe(`Renamed ${suffix}`);
    expect(saved.parent_id).toBe(target.id);
    expect(movedTarget?.children?.map((capability) => capability.id)).toContain(child.id);
  });

  it('guards import apply using the previewed mode', () => {
    const basePreview: ImportPreview = {
      source_path: 'C:/tmp/import.jsonl',
      format: 'jsonl',
      mode: 'append',
      total: 1,
      added: 1,
      updated: 0,
      skipped: 0,
      invalid: 0,
      diagnostics: [],
      applied: false,
    };

    expect(canApplyImportPreview(basePreview)).toBe(true);
    expect(canApplyImportPreview({ ...basePreview, mode: 'validate_only' })).toBe(false);
    expect(canApplyImportPreview({ ...basePreview, invalid: 1 })).toBe(false);
    expect(canApplyImportPreview(null)).toBe(false);
  });
});

function flatten(nodes: Capability[]): Capability[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}
