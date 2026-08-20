export interface Pagination {
  next_cursor: string | null;
  has_more: boolean;
  total_count?: number;
}

export interface Page<T> {
  data: T[];
  pagination: Pagination;
}

/** Cursor pagination query params per the spec (limit 1..100, default 20). */
export interface CursorParams {
  cursor?: string;
  limit?: number;
}

/**
 * The design spec wraps lists as { data, pagination } (PaginatedResponse),
 * but current endpoints return bare arrays. Normalize both so callers and
 * components only ever see a Page<T>.
 */
export function normalizePage<T>(body: unknown): Page<T> {
  if (Array.isArray(body)) {
    return {
      data: body as T[],
      pagination: { next_cursor: null, has_more: false },
    };
  }

  if (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { data?: unknown }).data)
  ) {
    const envelope = body as { data: T[]; pagination?: Partial<Pagination> };
    return {
      data: envelope.data,
      pagination: {
        next_cursor: envelope.pagination?.next_cursor ?? null,
        has_more: envelope.pagination?.has_more ?? false,
        total_count: envelope.pagination?.total_count,
      },
    };
  }

  throw new Error('Unexpected list response shape');
}
