/**
 * One shape for paginated data, shared by the queries that produce it, the pages that
 * read `?page=` from the URL, and the `<Pagination>` control that renders it. Server-side
 * (LIMIT/OFFSET + COUNT) because the lists run to thousands of rows — shipping them all to
 * the client to slice would be the payload, not the fix.
 */

export type PageParams = {
  page: number;
  pageSize: number;
};

export type Paginated<T> = {
  items: T[];
  /** 1-based, already clamped into range. */
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
  /** 1-based index of the first and last item shown, for "X–Y of N". 0/0 when empty. */
  from: number;
  to: number;
};

export const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Read `page` / `pageSize` from Next's `searchParams`, clamped to sane bounds. */
export function parsePageParams(
  params: RawParams | URLSearchParams,
  opts: { defaultPageSize?: number } = {},
): PageParams {
  const get = (key: string): string | undefined =>
    params instanceof URLSearchParams ? (params.get(key) ?? undefined) : first(params[key]);

  return {
    page: Math.max(1, toInt(get("page"), 1)),
    pageSize: clamp(toInt(get("pageSize"), opts.defaultPageSize ?? DEFAULT_PAGE_SIZE), 1, MAX_PAGE_SIZE),
  };
}

/** SQL OFFSET for a (already-clamped) page. */
export function offsetOf(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

/**
 * Given a total and the requested params, the page number to actually query (clamped so
 * an out-of-range `?page=` lands on the last page, never an empty void).
 */
export function clampPage(requestedPage: number, total: number, pageSize: number): number {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return Math.min(Math.max(1, requestedPage), totalPages);
}

/** Assemble the result once `items` (this page) and `total` (all matches) are known. */
export function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): Paginated<T> {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clamped = Math.min(Math.max(1, page), totalPages);
  return {
    items,
    page: clamped,
    pageSize,
    total,
    totalPages,
    hasPrev: clamped > 1,
    hasNext: clamped < totalPages,
    from: total === 0 ? 0 : offsetOf(clamped, pageSize) + 1,
    to: Math.min(offsetOf(clamped, pageSize) + items.length, total),
  };
}
