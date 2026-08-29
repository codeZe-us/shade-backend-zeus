import { describe, expect, test } from '@jest/globals';
import { parseAdminInvoiceListQuery } from '../../src/utils/invoice.validation.js';

describe('parseAdminInvoiceListQuery', () => {
  test('returns default pagination and empty filters for empty query', () => {
    const result = parseAdminInvoiceListQuery({});

    expect(result.errors).toEqual({});
    expect(result.filters).toEqual({});
    expect(result.pagination).toEqual({ limit: 20, offset: 0 });
  });

  test('parses valid status and merchantAddress', () => {
    const result = parseAdminInvoiceListQuery({
      status: 'paid',
      merchantAddress: '  0x123abc  ',
      limit: '50',
      offset: '10',
    });

    expect(result.errors).toEqual({});
    expect(result.filters).toEqual({
      status: 'PAID',
      merchantAddress: '0x123abc',
    });
    expect(result.pagination).toEqual({ limit: 50, offset: 10 });
  });

  test('clamps limit to MAX_LIMIT (100)', () => {
    const result = parseAdminInvoiceListQuery({ limit: '150' });

    expect(result.errors).toEqual({});
    expect(result.pagination.limit).toBe(100);
  });

  test('returns error for invalid status', () => {
    const result = parseAdminInvoiceListQuery({ status: 'UNKNOWN_STATUS' });

    expect(result.errors.status).toContain('status must be one of');
  });

  test('returns error for invalid limit', () => {
    const result = parseAdminInvoiceListQuery({ limit: '0' });

    expect(result.errors.limit).toBe('limit must be a positive number');
  });

  test('returns error for negative offset', () => {
    const result = parseAdminInvoiceListQuery({ offset: '-1' });

    expect(result.errors.offset).toBe('offset must be a non-negative number');
  });
});
