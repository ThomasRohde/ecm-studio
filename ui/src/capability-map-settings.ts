import type { CapabilityMapAlignment, CapabilityMapLayoutDensity } from './api/types';

export const DEFAULT_CAPABILITY_MAP_TARGET_ASPECT_RATIO = 1.7777777778;
export const DEFAULT_CAPABILITY_MAP_LAYOUT_DENSITY: CapabilityMapLayoutDensity = 'comfortable';
export const DEFAULT_CAPABILITY_MAP_ALIGNMENT: CapabilityMapAlignment = 'center';

export const CAPABILITY_MAP_RATIO_PRESETS: ReadonlyArray<{
  label: string;
  value: number;
}> = [
  { label: '16:9', value: DEFAULT_CAPABILITY_MAP_TARGET_ASPECT_RATIO },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 1.5 },
  { label: '1:1', value: 1 },
  { label: '2:1', value: 2 },
];

export const CAPABILITY_MAP_LAYOUT_DENSITY_OPTIONS: ReadonlyArray<{
  label: string;
  value: CapabilityMapLayoutDensity;
}> = [
  { label: 'Compact', value: 'compact' },
  { label: 'Comfortable', value: 'comfortable' },
  { label: 'Spacious', value: 'spacious' },
];

export const CAPABILITY_MAP_ALIGNMENT_OPTIONS: ReadonlyArray<{
  label: string;
  value: CapabilityMapAlignment;
}> = [
  { label: 'Left', value: 'left' },
  { label: 'Center', value: 'center' },
  { label: 'Right', value: 'right' },
];

export interface CapabilityMapDensityLayoutOptions {
  gap: number;
  padding: number;
  headerHeight: number;
  rootGap: number;
  viewMargin: number;
  minLeafWidth: number;
  maxLeafWidth: number;
  leafHeight: number;
}

export const CAPABILITY_MAP_DENSITY_LAYOUT_OPTIONS: Record<
  CapabilityMapLayoutDensity,
  CapabilityMapDensityLayoutOptions
> = {
  compact: {
    gap: 6,
    padding: 8,
    headerHeight: 40,
    rootGap: 22,
    viewMargin: 16,
    minLeafWidth: 100,
    maxLeafWidth: 170,
    leafHeight: 44,
  },
  comfortable: {
    gap: 8,
    padding: 12,
    headerHeight: 48,
    rootGap: 30,
    viewMargin: 20,
    minLeafWidth: 120,
    maxLeafWidth: 200,
    leafHeight: 55,
  },
  spacious: {
    gap: 12,
    padding: 16,
    headerHeight: 56,
    rootGap: 44,
    viewMargin: 28,
    minLeafWidth: 150,
    maxLeafWidth: 240,
    leafHeight: 68,
  },
};

export function capabilityMapDensityLayoutOptions(
  density?: CapabilityMapLayoutDensity | null,
): CapabilityMapDensityLayoutOptions {
  return CAPABILITY_MAP_DENSITY_LAYOUT_OPTIONS[density ?? DEFAULT_CAPABILITY_MAP_LAYOUT_DENSITY];
}

export function isCapabilityMapLayoutDensity(value: unknown): value is CapabilityMapLayoutDensity {
  return value === 'compact' || value === 'comfortable' || value === 'spacious';
}

export function isCapabilityMapAlignment(value: unknown): value is CapabilityMapAlignment {
  return value === 'left' || value === 'center' || value === 'right';
}
