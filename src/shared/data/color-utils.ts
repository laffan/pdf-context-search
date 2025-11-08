import { COLOR_PALETTE } from './constants';

export function getColorForQuery(index: number, queryType: 'parallel' | 'filter'): string {
  if (queryType === 'filter') {
    return COLOR_PALETTE[1]; // Green for all filters
  }

  if (index === 0) {
    return COLOR_PALETTE[0]; // Yellow for first parallel query
  }

  // For additional parallel queries, cycle through the palette starting from index 2
  const paletteIndex = ((index - 1) % (COLOR_PALETTE.length - 2)) + 2;
  return COLOR_PALETTE[paletteIndex];
}
