import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

const FALLBACK_NAV_HEIGHT = 70;

const snapHeights = (layout?: HTMLDivElement | null) => {
  const stageHeight =
    layout?.getBoundingClientRect().height ||
    Math.max(0, window.innerHeight - FALLBACK_NAV_HEIGHT);
  const collapsed = Math.min(72, stageHeight);
  const middle = Math.min(
    stageHeight,
    Math.max(collapsed, Math.min(440, stageHeight * 0.56)),
  );
  return [stageHeight, middle, collapsed];
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
      "--journey-sheet-height",
      `${height}px`,
    );
  };
  const snapJourneySheet = (snap: number) => {
    const next = Math.max(0, Math.min(2, snap));
    paint(snapHeights(journeyLayout.current)[next]);
    setSheetSnap(next);
    if (next === 2) {
      journeyLayout.current
        ?.querySelector<HTMLElement>(".journey-sheet-scroll")
        ?.scrollTo({ top: 0, behavior: "instant" });
    }
    requestAnimationFrame(() =>
      window.dispatchEvent(new Event("wayce:journey-sheet-resized")),
    );
  };

  useEffect(() => {
    if (!active) return;
    // The journey is a viewport-bound map and bottom sheet. Only the sheet's
    // inner scroller should move; the document itself must stay put.
    document.documentElement.classList.add("journey-sheet-active");
    window.scrollTo({ top: 0, behavior: "instant" });
    return () => {
      document.documentElement.classList.remove("journey-sheet-active");
      cleanupDrag.current?.();
      cleanupDrag.current = null;
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const resize = () => paint(snapHeights(journeyLayout.current)[sheetSnap]);
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
    const sheet = journeyLayout.current?.querySelector(".journey-sheet");
    if (!sheet) return;
    cleanupDrag.current?.();
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const startHeight = sheet.getBoundingClientRect().height;
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
      const heights = snapHeights(journeyLayout.current);
      paint(Math.max(heights[2], Math.min(heights[0], startHeight - delta)));
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
      const heights = snapHeights(journeyLayout.current);
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
        distance >= 40
          ? Math.min(nearest, startSnap - 1)
          : distance <= -40
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
    cleanupDrag.current = () => {
      cleanup();
      setSheetDragging(false);
    };
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
