/**
 * Vega-Lite config following the dataviz reference palette: fixed categorical
 * order, 2px lines, 4px rounded bar ends capped at 24px, recessive hairline grid,
 * text in ink tokens (never series colors). Separate light/dark steps.
 */
const CATEGORICAL = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};
const SEQUENTIAL = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

export function vegaConfig(dark: boolean, numberFormat: 'international' | 'indian' = 'international') {
  const ink = dark ? '#f0efec' : '#0b0b0b';
  const ink2 = dark ? '#c3c2b7' : '#52514e';
  const grid = dark ? '#2f2f2c' : '#ecebe7';
  const surface = dark ? '#1a1a19' : '#fcfcfb';
  const cat = dark ? CATEGORICAL.dark : CATEGORICAL.light;
  return {
    background: surface,
    font: 'Inter, ui-sans-serif, system-ui, sans-serif',
    padding: 8,
    view: { stroke: null },
    range: { category: cat, ordinal: SEQUENTIAL, ramp: SEQUENTIAL, heatmap: SEQUENTIAL },
    mark: { color: cat[0] },
    bar: { color: cat[0], cornerRadiusEnd: 4, maxBandSize: 24, stroke: surface, strokeWidth: 0 },
    line: { color: cat[0], strokeWidth: 2, strokeCap: 'round', strokeJoin: 'round' },
    point: { color: cat[0], size: 64, filled: true, stroke: surface, strokeWidth: 2 },
    area: { color: cat[0] },
    arc: { stroke: surface, strokeWidth: 2 },
    axis: {
      domainColor: grid,
      gridColor: grid,
      gridWidth: 1,
      tickColor: grid,
      labelColor: ink2,
      titleColor: ink2,
      labelFontSize: 11,
      titleFontSize: 11,
      titleFontWeight: 500,
      labelFlush: true,
    },
    axisX: { grid: false },
    axisBand: { labelAngle: 0, labelOverlap: 'greedy', labelLimit: 140 },
    axisY: { domain: false, ticks: false },
    // Compact numbers (2.6B, not 2.6G); scoped to quantitative axes so category labels stay intact.
    // Compact axis numbers in the user's system: 2.6B or 26 Cr / 45 L.
    axisQuantitative: {
      labelExpr:
        numberFormat === 'indian'
          ? "abs(datum.value) >= 1e7 ? format(datum.value / 1e7, '.3~') + ' Cr' : abs(datum.value) >= 1e5 ? format(datum.value / 1e5, '.3~') + ' L' : format(datum.value, '~s')"
          : "replace(format(datum.value, '~s'), 'G', 'B')",
    },
    legend: { labelColor: ink2, titleColor: ink2, symbolType: 'circle', orient: 'top', labelFontSize: 11, titleFontSize: 11 },
    title: { color: ink, fontSize: 13, fontWeight: 600, anchor: 'start', offset: 12 },
    scale: { bandPaddingInner: 0.3 },
  };
}
