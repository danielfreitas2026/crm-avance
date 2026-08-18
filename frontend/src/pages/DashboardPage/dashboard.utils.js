export function calcularSegmentosCirculares(items, total) {
  return items.reduce((resultado, item, index) => {
    const value = Math.max(0, Number(item.value) || 0);
    const share = total > 0 ? (value / total) * 100 : 0;
    return {
      offset: resultado.offset + share,
      segments: [...resultado.segments, { item, index, share, offset: resultado.offset }]
    };
  }, { offset: 0, segments: [] }).segments;
}
