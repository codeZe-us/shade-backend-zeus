import { parseAdminSubscriptionPlanListQuery } from '../../src/utils/admin-subscription-plan.validation.js';

describe('parseAdminSubscriptionPlanListQuery', () => {
  test('returns default values for an empty query', () => {
    const result = parseAdminSubscriptionPlanListQuery({});
    expect(result.filters).toEqual({});
    expect(result.pagination).toEqual({ limit: 20, offset: 0 });
    expect(result.sortBy).toBe('createdAt');
    expect(result.sortDir).toBe('desc');
    expect(result.errors).toEqual({});
  });

  test('parses merchantAddress filter', () => {
    const result = parseAdminSubscriptionPlanListQuery({ merchantAddress: ' GMERCHANT ' });
    expect(result.filters.merchantAddress).toBe('GMERCHANT');
    expect(result.errors).toEqual({});
  });

  test('parses token filter', () => {
    const result = parseAdminSubscriptionPlanListQuery({ token: ' TOKEN ' });
    expect(result.filters.token).toBe('TOKEN');
    expect(result.errors).toEqual({});
  });

  test('parses active filter', () => {
    let result = parseAdminSubscriptionPlanListQuery({ active: 'true' });
    expect(result.filters.active).toBe(true);
    expect(result.errors).toEqual({});

    result = parseAdminSubscriptionPlanListQuery({ active: true });
    expect(result.filters.active).toBe(true);

    result = parseAdminSubscriptionPlanListQuery({ active: 'false' });
    expect(result.filters.active).toBe(false);

    result = parseAdminSubscriptionPlanListQuery({ active: false });
    expect(result.filters.active).toBe(false);
  });

  test('records error for invalid active filter', () => {
    const result = parseAdminSubscriptionPlanListQuery({ active: 'yes' });
    expect(result.filters.active).toBeUndefined();
    expect(result.errors).toHaveProperty('active');
  });

  test('parses sortBy and sortDir', () => {
    const result = parseAdminSubscriptionPlanListQuery({ sortBy: 'amount', sortDir: 'asc' });
    expect(result.sortBy).toBe('amount');
    expect(result.sortDir).toBe('asc');
    expect(result.errors).toEqual({});
  });

  test('records errors for invalid sortBy and sortDir', () => {
    const result = parseAdminSubscriptionPlanListQuery({ sortBy: 'invalid', sortDir: 'sideways' });
    expect(result.sortBy).toBe('createdAt'); // Defaults applied
    expect(result.sortDir).toBe('desc');
    expect(result.errors).toHaveProperty('sortBy');
    expect(result.errors).toHaveProperty('sortDir');
  });

  test('parses pagination with clamping', () => {
    let result = parseAdminSubscriptionPlanListQuery({ limit: '15', offset: '5' });
    expect(result.pagination).toEqual({ limit: 15, offset: 5 });

    result = parseAdminSubscriptionPlanListQuery({ limit: '500' });
    expect(result.pagination.limit).toBe(100);
  });

  test('records errors for invalid pagination', () => {
    const result = parseAdminSubscriptionPlanListQuery({ limit: '-1', offset: 'abc' });
    expect(result.pagination).toEqual({ limit: 20, offset: 0 }); // Defaults applied
    expect(result.errors).toHaveProperty('limit');
    expect(result.errors).toHaveProperty('offset');
  });
});
