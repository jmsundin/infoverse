import { ViewportTransform } from "../types";

const LOCAL_STORAGE_KEY = "infoverse_debug_viewport";
const QUERY_PARAM = "debugViewport";

function hasQueryFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has(QUERY_PARAM)) return false;
    const raw = params.get(QUERY_PARAM);
    return raw === null || raw === "1" || raw.toLowerCase() === "true";
  } catch {
    return false;
  }
}

export function isViewportDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const globalFlag = (window as any).__INFOVERSE_DEBUG_VIEWPORT__ === true;
    if (globalFlag) return true;
    if (hasQueryFlag()) return true;
    return window.localStorage.getItem(LOCAL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function summarizeNodeIds(
  ids: Iterable<string>,
  limit: number = 8
): string[] {
  const all = Array.from(ids);
  if (all.length <= limit) return all;
  return [...all.slice(0, limit), `...(+${all.length - limit})`];
}

export function summarizeTransform(transform: ViewportTransform): {
  x: number;
  y: number;
  k: number;
} {
  const x = Number.isFinite(transform.x) ? Number(transform.x.toFixed(2)) : 0;
  const y = Number.isFinite(transform.y) ? Number(transform.y.toFixed(2)) : 0;
  const k = Number.isFinite(transform.k) ? Number(transform.k.toFixed(4)) : 1;
  return { x, y, k };
}

export function viewportDebugLog(
  event: string,
  details?: Record<string, unknown>
): void {
  if (!isViewportDebugEnabled()) return;
  const now = new Date().toISOString();
  if (details) {
    console.log(`[ViewportDebug] ${now} ${event}`, details);
    return;
  }
  console.log(`[ViewportDebug] ${now} ${event}`);
}
