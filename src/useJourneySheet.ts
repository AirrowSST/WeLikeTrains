import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

const snapHeights = () => {
  const middle = Math.min(510, Math.max(340, window.innerHeight * 0.51));
  return [
    28,
    middle,
    Math.max(middle, Math.min(600, window.innerHeight * 0.7)),
  ];
};

/** Owns the sheet's physical layout independently of route and map rendering. */
export function useJourneySheet(active: boolean) {
  const journeyLayout = useRef<HTMLDivElement>(null);
  const [sheetSnap, setSheetSnap] = useState(1);
  const [sheetDragging, setSheetDragging] = useState(false);
  const sheetMoved = useRef(false);
  const position = useRef(snapHeights()[1]);
  const cleanupDrag = useRef<(() => void) | null>(null);

  const paint = (height: number) => {
    position.current = height;
    journeyLayout.current?.style.setProperty(
      "--journey-map-height",
      `${height}px`,
    );
  };
  const snapJourneySheet = (snap: number) => {
    const next = Math.max(0, Math.min(2, snap));
    paint(snapHeights()[next]);
    setSheetSnap(next);
    const top = journeyLayout.current?.getBoundingClientRect().top ?? 0;
    if (next === 0 && top < 0) window.scrollBy({ top, behavior: "instant" });
    requestAnimationFrame(() =>
      window.dispatchEvent(new Event("wayce:journey-sheet-resized")),
    );
  };

  useEffect(() => {
    if (!active) return;
    // Otherwise the browser compensates for map resizing by scrolling the page,
    // pinning the visible handle in place even though its layout position moves.
    document.documentElement.classList.add("journey-sheet-active");
    return () => {
      document.documentElement.classList.remove("journey-sheet-active");
      cleanupDrag.current?.();
      cleanupDrag.current = null;
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const resize = () => paint(snapHeights()[sheetSnap]);
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [active, sheetSnap]);

  const startSheetDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const interactive = (event.target as Element).closest(
      "button, a, input, select, textarea",
    );
    if (
      event.button !== 0 ||
      (interactive && interactive !== event.currentTarget)
    )
      return;
    const slot = journeyLayout.current?.querySelector(".journey-map-slot");
    if (!slot) return;
    cleanupDrag.current?.();
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const startHeight = slot.getBoundingClientRect().height;
    const startSnap = sheetSnap;
    const target = event.currentTarget;
    sheetMoved.current = false;
    event.preventDefault();
    setSheetDragging(true);

    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      pointer.preventDefault();
      const delta = pointer.clientY - startY;
      if (Math.abs(delta) > 4) sheetMoved.current = true;
      const heights = snapHeights();
      paint(Math.max(heights[0], Math.min(heights[2], startHeight + delta)));
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      if (target.hasPointerCapture(pointerId))
        target.releasePointerCapture(pointerId);
    };
    const finish = (cancelled: boolean) => {
      cleanup();
      cleanupDrag.current = null;
      setSheetDragging(false);
      const heights = snapHeights();
      const nearest = heights.reduce(
        (best, height, index) =>
          Math.abs(height - position.current) <
          Math.abs(heights[best] - position.current)
            ? index
            : best,
        0,
      );
      const distance = position.current - startHeight;
      const next =
        distance <= -40
          ? Math.min(nearest, startSnap - 1)
          : distance >= 40
            ? Math.max(nearest, startSnap + 1)
            : nearest;
      snapJourneySheet(cancelled ? startSnap : next);
    };
    const end = (pointer: PointerEvent) => {
      if (pointer.pointerId === pointerId) finish(false);
    };
    const cancel = (event: Event) => {
      if (event instanceof PointerEvent && event.pointerId !== pointerId)
        return;
      finish(true);
    };
    cleanupDrag.current = cleanup;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    try {
      target.setPointerCapture(pointerId);
    } catch {
      /* Window listeners handle capture loss. */
    }
  };

  return {
    journeyLayout,
    sheetSnap,
    sheetDragging,
    sheetMoved,
    snapJourneySheet,
    startSheetDrag,
  };
}
