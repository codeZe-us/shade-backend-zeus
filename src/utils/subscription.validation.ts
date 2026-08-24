import type { SubscriptionStatus as PrismaSubscriptionStatus } from '@prisma/client';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

// String constants matching the Prisma `SubscriptionStatus` enum. Defined locally
// so this module never imports a runtime value from `@prisma/client` (the
// generated client is mocked in tests and not generated in CI).
const SUBSCRIPTION_STATUSES = [
  'ACTIVE',
  'CANCELLED',
] as const satisfies readonly PrismaSubscriptionStatus[];

const SUBSCRIPTION_SORT_FIELDS = ['createdAt', 'lastCharged'] as const;
const SORT_DIRECTIONS = ['asc', 'desc'] as const;

export interface AdminSubscriptionListFilters {
  status?: (typeof SUBSCRIPTION_STATUSES)[number];
  planId?: string;
  merchantAddress?: string;
  customer?: string;
}

export interface AdminSubscriptionPaymentsFilters {
  merchantAddress?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface AdminSubscriptionListPagination {
  limit: number;
  offset: number;
}

export type SubscriptionListSortBy = (typeof SUBSCRIPTION_SORT_FIELDS)[number];
export type SubscriptionListSortDir = (typeof SORT_DIRECTIONS)[number];

interface ParsedSubscriptionListQuery {
  filters: AdminSubscriptionListFilters;
  pagination: AdminSubscriptionListPagination;
  sortBy: SubscriptionListSortBy;
  sortDir: SubscriptionListSortDir;
  errors: ValidationErrors;
}

interface ParsedSubscriptionPaymentsQuery {
  filters: AdminSubscriptionPaymentsFilters;
  pagination: AdminSubscriptionListPagination;
  errors: ValidationErrors;
}

export type ValidationErrors = Record<string, string>;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Parses admin subscription list query parameters into typed filters, sort and
 * pagination, clamping the page size to [1, MAX_LIMIT] and defaulting to
 * DEFAULT_LIMIT. Mirrors parseAuditLogListQuery in audit-log.validation.ts.
 */
export const parseAdminSubscriptionListQuery = (
  query: Record<string, unknown>,
): ParsedSubscriptionListQuery => {
  const errors: ValidationErrors = {};
  const filters: AdminSubscriptionListFilters = {};

  if (query.status !== undefined) {
    const status = String(query.status).toUpperCase();
    if ((SUBSCRIPTION_STATUSES as readonly string[]).includes(status)) {
      filters.status = status as (typeof SUBSCRIPTION_STATUSES)[number];
    } else {
      errors.status = `status must be one of ${SUBSCRIPTION_STATUSES.join(', ')}`;
    }
  }

  if (isNonEmptyString(query.planId)) {
    filters.planId = query.planId.trim();
  }

  if (isNonEmptyString(query.merchantAddress)) {
    filters.merchantAddress = query.merchantAddress.trim();
  }

  if (isNonEmptyString(query.customer)) {
    filters.customer = query.customer.trim();
  }

  let sortBy: SubscriptionListSortBy = 'createdAt';
  if (query.sortBy !== undefined) {
    const value = String(query.sortBy);
    if ((SUBSCRIPTION_SORT_FIELDS as readonly string[]).includes(value)) {
      sortBy = value as SubscriptionListSortBy;
    } else {
      errors.sortBy = `sortBy must be one of ${SUBSCRIPTION_SORT_FIELDS.join(', ')}`;
    }
  }

  let sortDir: SubscriptionListSortDir = 'desc';
  if (query.sortDir !== undefined) {
    const value = String(query.sortDir).toLowerCase();
    if ((SORT_DIRECTIONS as readonly string[]).includes(value)) {
      sortDir = value as SubscriptionListSortDir;
    } else {
      errors.sortDir = `sortDir must be one of ${SORT_DIRECTIONS.join(', ')}`;
    }
  }

  const { pagination, paginationErrors } = parsePagination(query);
  return { filters, pagination, sortBy, sortDir, errors: { ...errors, ...paginationErrors } };
};

/**
 * Parses admin subscription payment history query parameters. The date range
 * mirroring the filter shape already established for invoices in
 * parseInvoiceListQuery.
 */
export const parseAdminSubscriptionPaymentsQuery = (
  query: Record<string, unknown>,
): ParsedSubscriptionPaymentsQuery => {
  const errors: ValidationErrors = {};
  const filters: AdminSubscriptionPaymentsFilters = {};

  if (isNonEmptyString(query.merchantAddress)) {
    filters.merchantAddress = query.merchantAddress.trim();
  }

  if (query.startDate !== undefined) {
    const date = new Date(String(query.startDate));
    if (Number.isNaN(date.getTime())) {
      errors.startDate = 'startDate must be a valid date';
    } else {
      filters.startDate = date;
    }
  }

  if (query.endDate !== undefined) {
    const date = new Date(String(query.endDate));
    if (Number.isNaN(date.getTime())) {
      errors.endDate = 'endDate must be a valid date';
    } else {
      filters.endDate = date;
    }
  }

  const { pagination, paginationErrors } = parsePagination(query);
  return { filters, pagination, errors: { ...errors, ...paginationErrors } };
};

const parsePagination = (
  query: Record<string, unknown>,
): { pagination: AdminSubscriptionListPagination; paginationErrors: ValidationErrors } => {
  const paginationErrors: ValidationErrors = {};

  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    const parsed = Number(query.limit);
    if (!Number.isFinite(parsed) || parsed < 1) {
      paginationErrors.limit = 'limit must be a positive number';
    } else {
      limit = Math.min(Math.floor(parsed), MAX_LIMIT);
    }
  }

  let offset = 0;
  if (query.offset !== undefined) {
    const parsed = Number(query.offset);
    if (!Number.isFinite(parsed) || parsed < 0) {
      paginationErrors.offset = 'offset must be a non-negative number';
    } else {
      offset = Math.floor(parsed);
    }
  }

  return { pagination: { limit, offset }, paginationErrors: { ...paginationErrors } };
};
