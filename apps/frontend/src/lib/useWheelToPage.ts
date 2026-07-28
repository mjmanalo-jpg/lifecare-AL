import { useEffect, useRef } from "react";

/**
 * Fix for wide tables trapping the mouse wheel.
 *
 * When an element overflows horizontally, Chrome converts a vertical mouse-wheel
 * into HORIZONTAL scroll of that element — so the page won't scroll vertically
 * while the cursor is over a wide table. Attach this ref to the `overflow-x-auto`
 * wrapper: a dominant-vertical wheel is redirected to the nearest scroll ancestor
 * (the portal `<main>`) so the page scrolls normally. Horizontal scroll is still
 * available via Shift+wheel or dragging the scrollbar.
 *
 * Uses a native, non-passive listener because React's onWheel is passive
 * (preventDefault would be ignored).
 */
export function useWheelToPage<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Respect genuine horizontal intent (trackpad sideways / Shift+wheel).
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      // Only intervene when this element actually scrolls horizontally.
      if (el.scrollWidth <= el.clientWidth) return;
      const scroller = el.closest("main") as HTMLElement | null;
      if (!scroller) return;
      scroller.scrollTop += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  return ref;
}
