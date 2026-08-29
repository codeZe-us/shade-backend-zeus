import type { InvoiceStatus } from '@prisma/client';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSITIVE_INTEGER_REGEX = /^\d+$/;

// String constants matching the Prisma `Status` enum. Defined locally so this
// module never imports a runtime value from `@prisma/client` (the generated
// client is mocked in tests and not generated in CI).
const INVOICE_STATUSES = [
  'DRAFT',
  'PENDING',
  'PAID',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'PARTIALLY_PAID',
] as const satisfies readonly InvoiceStatus[];

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export interface CreateInvoiceInput {
  description: string;
  amount: string | number;
  token: string;
  payerEmail?: string;
  expiresAt?: string;
  isDraft?: boolean;
}

export interface InvoiceListFilters {
  status?: InvoiceStatus;
  token?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface InvoicePagination {
  limit: number;
  offset: number;
}

export type ValidationErrors = Record<string, string>;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Parses and validates a positive integer amount supplied as a number or a
 * numeric string. Returns the BigInt value, or null when invalid.
 */
export const parseAmount = (value: unknown): bigint | null => {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) return null;
    return BigInt(value);
  }

  if (typeof value === 'string' && POSITIVE_INTEGER_REGEX.test(value.trim())) {
    const parsed = BigInt(value.trim());
    return parsed > 0n ? parsed : null;
  }

  return null;
};

export const validateCreateInvoice = (body: unknown): ValidationErrors => {
  const errors: ValidationErrors = {};
  const payload = (body ?? {}) as Record<string, unknown>;

  if (!isNonEmptyString(payload.description)) {
    errors.description = 'description is required';
  }

  if (parseAmount(payload.amount) === null) {
    errors.amount = 'amount must be a positive integer';
  }

  if (!isNonEmptyString(payload.token)) {
    errors.token = 'token must be a non-empty string';
  }

  if (
    payload.payerEmail !== undefined &&
    payload.payerEmail !== null &&
    !(
      isNonEmptyString(payload.payerEmail) &&
      EMAIL_REGEX.test((payload.payerEmail as string).trim())
    )
  ) {
    errors.payerEmail = 'payerEmail must be a valid email';
  }

  if (payload.expiresAt !== undefined && payload.expiresAt !== null) {
    const date = new Date(payload.expiresAt as string);
    if (Number.isNaN(date.getTime())) {
      errors.expiresAt = 'expiresAt must be a valid date';
    }
  }

  if (payload.isDraft !== undefined && typeof payload.isDraft !== 'boolean') {
    errors.isDraft = 'isDraft must be a boolean';
  }

  return errors;
};

export interface ParsedListQuery {
  filters: InvoiceListFilters;
  pagination: InvoicePagination;
  errors: ValidationErrors;
}

/**
 * Parses list query parameters into typed filters and pagination, clamping the
 * page size to [1, MAX_LIMIT] and defaulting to DEFAULT_LIMIT.
 */
export const parseInvoiceListQuery = (query: Record<string, unknown>): ParsedListQuery => {
  const errors: ValidationErrors = {};
  const filters: InvoiceListFilters = {};

  if (query.status !== undefined) {
    const status = String(query.status).toUpperCase();
    if ((INVOICE_STATUSES as readonly string[]).includes(status)) {
      filters.status = status as InvoiceStatus;
    } else {
      errors.status = `status must be one of ${INVOICE_STATUSES.join(', ')}`;
    }
  }

  if (isNonEmptyString(query.token)) {
    filters.token = query.token.trim();
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

  return { filters, pagination: { limit, offset }, errors };
};

export interface AdminInvoiceListFilters {
  status?: InvoiceStatus;
  merchantAddress?: string;
}

export interface ParsedAdminInvoiceListQuery {
  filters: AdminInvoiceListFilters;
  pagination: InvoicePagination;
  errors: ValidationErrors;
}

/**
 * Parses admin invoice list query parameters into typed filters and pagination,
 * clamping the page size to [1, MAX_LIMIT] and defaulting to DEFAULT_LIMIT.
 */
export const parseAdminInvoiceListQuery = (
  query: Record<string, unknown>,
): ParsedAdminInvoiceListQuery => {
  const errors: ValidationErrors = {};
  const filters: AdminInvoiceListFilters = {};

  if (query.status !== undefined) {
    const status = String(query.status).toUpperCase();
    if ((INVOICE_STATUSES as readonly string[]).includes(status)) {
      filters.status = status as InvoiceStatus;
    } else {
      errors.status = `status must be one of ${INVOICE_STATUSES.join(', ')}`;
    }
  }

  if (isNonEmptyString(query.merchantAddress)) {
    filters.merchantAddress = query.merchantAddress.trim();
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

  return { filters, pagination: { limit, offset }, errors };
};
