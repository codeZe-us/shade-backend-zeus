import { DEFAULT_LIMIT, MAX_LIMIT, ValidationErrors } from './subscription.validation.js';

const PLAN_SORT_FIELDS = ['createdAt', 'amount', 'interval'] as const;
const SORT_DIRECTIONS = ['asc', 'desc'] as const;

export interface AdminSubscriptionPlanListFilters {
  merchantAddress?: string;
  token?: string;
  active?: boolean;
}

export interface AdminSubscriptionPlanListPagination {
  limit: number;
  offset: number;
}

export type PlanListSortBy = (typeof PLAN_SORT_FIELDS)[number];
export type PlanListSortDir = (typeof SORT_DIRECTIONS)[number];

interface ParsedSubscriptionPlanListQuery {
  filters: AdminSubscriptionPlanListFilters;
  pagination: AdminSubscriptionPlanListPagination;
  sortBy: PlanListSortBy;
  sortDir: PlanListSortDir;
  errors: ValidationErrors;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const parseAdminSubscriptionPlanListQuery = (
  query: Record<string, unknown>,
): ParsedSubscriptionPlanListQuery => {
  const errors: ValidationErrors = {};
  const filters: AdminSubscriptionPlanListFilters = {};

  if (isNonEmptyString(query.merchantAddress)) {
    filters.merchantAddress = query.merchantAddress.trim();
  }

  if (isNonEmptyString(query.token)) {
    filters.token = query.token.trim();
  }

  if (query.active !== undefined) {
    if (query.active === 'true' || query.active === true) {
      filters.active = true;
    } else if (query.active === 'false' || query.active === false) {
      filters.active = false;
    } else {
      errors.active = 'active must be a boolean';
    }
  }

  let sortBy: PlanListSortBy = 'createdAt';
  if (query.sortBy !== undefined) {
    const value = String(query.sortBy);
    if ((PLAN_SORT_FIELDS as readonly string[]).includes(value)) {
      sortBy = value as PlanListSortBy;
    } else {
      errors.sortBy = `sortBy must be one of ${PLAN_SORT_FIELDS.join(', ')}`;
    }
  }

  let sortDir: PlanListSortDir = 'desc';
  if (query.sortDir !== undefined) {
    const value = String(query.sortDir).toLowerCase();
    if ((SORT_DIRECTIONS as readonly string[]).includes(value)) {
      sortDir = value as PlanListSortDir;
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
