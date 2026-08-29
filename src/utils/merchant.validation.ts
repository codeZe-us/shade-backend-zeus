export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

const MERCHANT_SORT_FIELDS = ['createdAt', 'merchantId', 'businessName'] as const;
const SORT_DIRECTIONS = ['asc', 'desc'] as const;

export interface AdminMerchantListFilters {
  active?: boolean;
  verified?: boolean;
  category?: string;
  search?: string;
}

export interface AdminMerchantListPagination {
  limit: number;
  offset: number;
}

export type MerchantListSortBy = (typeof MERCHANT_SORT_FIELDS)[number];
export type MerchantListSortDir = (typeof SORT_DIRECTIONS)[number];

export type ValidationErrors = Record<string, string>;

export interface ParsedAdminMerchantListQuery {
  filters: AdminMerchantListFilters;
  pagination: AdminMerchantListPagination;
  sortBy: MerchantListSortBy;
  sortDir: MerchantListSortDir;
  errors: ValidationErrors;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Parses a boolean query parameter. Query strings never carry a real boolean,
 * so only the literals "true"/"false" are accepted; anything else is a 400
 * rather than a silent coercion that would filter on the wrong value.
 */
const parseBoolean = (
  value: unknown,
  field: string,
  errors: ValidationErrors,
): boolean | undefined => {
  const raw = String(value).toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  errors[field] = `${field} must be either true or false`;
  return undefined;
};

/**
 * Parses admin merchant list query parameters into typed filters, sort and
 * pagination, clamping the page size to [1, MAX_LIMIT] and defaulting to
 * DEFAULT_LIMIT. Mirrors parseAdminSubscriptionListQuery in
 * subscription.validation.ts.
 */
export const parseAdminMerchantListQuery = (
  query: Record<string, unknown>,
): ParsedAdminMerchantListQuery => {
  const errors: ValidationErrors = {};
  const filters: AdminMerchantListFilters = {};

  if (query.active !== undefined) {
    const active = parseBoolean(query.active, 'active', errors);
    if (active !== undefined) filters.active = active;
  }

  if (query.verified !== undefined) {
    const verified = parseBoolean(query.verified, 'verified', errors);
    if (verified !== undefined) filters.verified = verified;
  }

  if (isNonEmptyString(query.category)) {
    filters.category = query.category.trim();
  }

  if (isNonEmptyString(query.search)) {
    filters.search = query.search.trim();
  }

  let sortBy: MerchantListSortBy = 'createdAt';
  if (query.sortBy !== undefined) {
    const value = String(query.sortBy);
    if ((MERCHANT_SORT_FIELDS as readonly string[]).includes(value)) {
      sortBy = value as MerchantListSortBy;
    } else {
      errors.sortBy = `sortBy must be one of ${MERCHANT_SORT_FIELDS.join(', ')}`;
    }
  }

  let sortDir: MerchantListSortDir = 'desc';
  if (query.sortDir !== undefined) {
    const value = String(query.sortDir).toLowerCase();
    if ((SORT_DIRECTIONS as readonly string[]).includes(value)) {
      sortDir = value as MerchantListSortDir;
    } else {
      errors.sortDir = `sortDir must be one of ${SORT_DIRECTIONS.join(', ')}`;
    }
  }

  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    const parsed = Number(query.limit);
    if (!Number.isFinite(parsed) || parsed < 1) {
      errors.limit = 'limit must be a positive number';
    } else {
      limit = Math.min(Math.floor(parsed), MAX_LIMIT);
    }
  }

  let offset = 0;
  if (query.offset !== undefined) {
    const parsed = Number(query.offset);
    if (!Number.isFinite(parsed) || parsed < 0) {
      errors.offset = 'offset must be a non-negative number';
    } else {
      offset = Math.floor(parsed);
    }
  }

  return { filters, pagination: { limit, offset }, sortBy, sortDir, errors };
};

export interface BlockMerchantInput {
  reason?: string;
}

/**
 * Validates the optional `reason` carried on a block request. The reason is
 * recorded in the audit log's metadata; it is never persisted on Merchant.
 */
export const validateBlockMerchant = (
  body: unknown,
): { input: BlockMerchantInput; errors: ValidationErrors } => {
  const errors: ValidationErrors = {};
  const payload = (body ?? {}) as Record<string, unknown>;
  const input: BlockMerchantInput = {};

  if (payload.reason !== undefined && payload.reason !== null) {
    if (typeof payload.reason !== 'string' || payload.reason.trim().length === 0) {
      errors.reason = 'reason must be a non-empty string';
    } else {
      input.reason = payload.reason.trim();
    }
  }

  return { input, errors };
};
