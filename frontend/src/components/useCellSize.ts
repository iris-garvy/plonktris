import { useLayoutEffect, useState, type RefObject } from 'react';

interface CellSizeOptions {
  /** how many cells wide the whole layout is (board + side columns + gaps, in cell units) */
  units: number;
  /** fixed px on top of the cell units (borders etc.) */
  extra?: number;
  /** how many cells tall the layout is, for short screens */
  rows?: number;
  max?: number;
  min?: number;
}

/**
 * Picks the largest whole-pixel cell size (≤ max) at which a board layout fits: in the element's
 * own width, in the viewport width (so phones work even inside shrink-to-fit parents) and in
 * the viewport height (short laptop screens).
 */
export function useCellSize(ref: RefObject<HTMLElement | null>, opts: CellSizeOptions): number {
  const { units, extra = 0, rows = 24, max = 26, min = 12 } = opts;
  const [size, setSize] = useState(max);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      let c = max;
      const w = el.clientWidth;
      if (w > 0) c = Math.min(c, Math.floor((w - extra) / units));
      c = Math.min(c, Math.floor((window.innerWidth - 20 - extra) / units));
      c = Math.min(c, Math.floor((window.innerHeight - 110) / rows));
      setSize(Math.max(min, c));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    window.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [ref, units, extra, rows, max, min]);

  return size;
}
