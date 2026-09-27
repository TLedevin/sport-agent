import { useCallback, useRef, useState } from "react";

/** Tracks an element's width. A callback ref, so it re-attaches whenever the element is re-created
 * (e.g. switching back from the table view) and measures immediately instead of waiting for a resize. */
export function useWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    observer.current = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.current.observe(node);
  }, []);
  return [ref, width] as const;
}
