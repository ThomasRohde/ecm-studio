import { describe, expect, it } from 'vitest';
import { canRunStructuralDialog } from './CapabilityPanels';

describe('structural operation controls', () => {
  it('requires rationale for every structural dialog', () => {
    expect(canRunStructuralDialog('retire', '', '')).toBe(false);
    expect(canRunStructuralDialog('delete', 'Created by mistake', '')).toBe(true);
  });

  it('requires a survivor for merge', () => {
    expect(canRunStructuralDialog('merge', 'Duplicate capability', '')).toBe(false);
    expect(canRunStructuralDialog('merge', 'Duplicate capability', 'survivor-id')).toBe(true);
  });

  it('does not require rationale for move', () => {
    expect(canRunStructuralDialog('move', '', '')).toBe(true);
  });
});
