import { useCallback, useRef } from "react";

/**
 * Fix for wide tables trapping the mouse wheel.
 *
 * When an element overflows horizontally, Chrome converts a vertical mouse-wheel
 * into HORIZONTAL scroll of that element — so the page won't scroll vertically
 * while the cursor is over a wide table. Attach the returned callback ref to the
 * `overflow-x-auto` wrapper: a dominant-vertical wheel is redirected to the
 * nearest vertically-scrollable ancestor (the portal `<main>`) so the page
 * scrolls normally. Horizontal scroll stays available via Shift+wheel / the bar.
 *
 * Uses a CALLBACK ref (not useRef+useEffect) so it attaches when the table
 * actually mounts — the table is often absent on first render (loading state),
 * which would leave a []-deps effect wired to nothing. Native, non-passive
 * listener because React's onWheel is passive (preventDefault would be ignored).
 */
export function useWheelToPage<T extends HTMLElement = HTMLDivElement>() {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((node: T | null) => {
    if (cleanup.current) { cleanup.current(); cleanup.current = null; }
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // respect horizontal intent
      let n: HTMLElement | null = node.parentElement;
      while (n) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) break;
        n = n.parentElement;
      }
      const scroller = (n ?? (document.scrollingElement as HTMLElement | null));
      if (!scroller) return;
      scroller.scrollTop += e.deltaY;
      e.preventDefault();
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    cleanup.current = () => node.removeEventListener("wheel", onWheel);
  }, []);
}
