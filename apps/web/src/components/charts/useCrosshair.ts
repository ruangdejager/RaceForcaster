import { useCallback, useRef, useState } from 'react';
import { nearestIndex } from './plot.js';

/**
 * Crosshair hover for an SVG plot.
 *
 * A chart on a web page is interactive whether or not you plan for it, so every
 * time series here ships a crosshair rather than treating the tooltip as an
 * afterthought. Pointer events (not mouse events) so it works under a finger,
 * and the hit area is the whole plot rather than the marks themselves — nobody
 * should have to land on a 3px line.
 *
 * The tooltip never carries a value that isn't readable elsewhere: the hourly
 * timeline is the table view for everything plotted here.
 */
export function useCrosshair(xPixels: readonly number[]) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  // The continuous pointer position, in viewBox units — kept alongside the
  // nearest-sample `index` so callers with their own points to hit-test
  // (checkpoints, which don't line up with the sample series) can snap to
  // those instead without reimplementing the client-to-viewBox mapping.
  const [x, setX] = useState<number | null>(null);

  const handleMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || xPixels.length === 0) return;

      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return;

      // Map client x into the viewBox's own coordinate space, so callers never
      // have to reason about how the SVG happens to be scaled on screen.
      const viewWidth = svg.viewBox.baseVal.width || rect.width;
      const localX = ((event.clientX - rect.left) / rect.width) * viewWidth;

      setX(localX);
      setIndex(nearestIndex(xPixels, localX));
    },
    [xPixels],
  );

  const handleLeave = useCallback(() => {
    setIndex(null);
    setX(null);
  }, []);

  return {
    svgRef,
    index,
    x,
    handlers: {
      onPointerMove: handleMove,
      onPointerDown: handleMove,
      onPointerLeave: handleLeave,
      onPointerCancel: handleLeave,
    },
  };
}
