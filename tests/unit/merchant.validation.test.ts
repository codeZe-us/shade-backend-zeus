const { parseAdminMerchantListQuery, validateBlockMerchant, DEFAULT_LIMIT, MAX_LIMIT } =
  await import('../../src/utils/merchant.validation.js');

describe('parseAdminMerchantListQuery', () => {
  test('defaults to createdAt desc with DEFAULT_LIMIT and no filters', () => {
    const result = parseAdminMerchantListQuery({});

    expect(result.errors).toEqual({});
    expect(result.filters).toEqual({});
    expect(result.pagination).toEqual({ limit: DEFAULT_LIMIT, offset: 0 });
    expect(result.sortBy).toBe('createdAt');
    expect(result.sortDir).toBe('desc');
  });

  test('parses the boolean, category and search filters', () => {
    const result = parseAdminMerchantListQuery({
      active: 'false',
      verified: 'true',
      category: '  software  ',
      search: '  eng  ',
    });

    expect(result.errors).toEqual({});
    expect(result.filters).toEqual({
      active: false,
      verified: true,
      category: 'software',
      search: 'eng',
    });
  });

  test('rejects a boolean filter that is not true or false', () => {
    const result = parseAdminMerchantListQuery({ active: '1', verified: 'nope' });

    expect(result.errors.active).toBeDefined();
    expect(result.errors.verified).toBeDefined();
    expect(result.filters.active).toBeUndefined();
    expect(result.filters.verified).toBeUndefined();
  });

  test('ignores a blank category or search rather than filtering on an empty string', () => {
    const result = parseAdminMerchantListQuery({ category: '   ', search: '' });

    expect(result.errors).toEqual({});
    expect(result.filters).toEqual({});
  });

  test.each(['createdAt', 'merchantId', 'businessName'])('accepts sortBy=%s', field => {
    const result = parseAdminMerchantListQuery({ sortBy: field });

    expect(result.errors).toEqual({});
    expect(result.sortBy).toBe(field);
  });

  test('rejects an unsupported sortBy and sortDir', () => {
    const result = parseAdminMerchantListQuery({ sortBy: 'email', sortDir: 'sideways' });

    expect(result.errors.sortBy).toBeDefined();
    expect(result.errors.sortDir).toBeDefined();
  });

  test('accepts sortDir case-insensitively', () => {
    const result = parseAdminMerchantListQuery({ sortDir: 'ASC' });

    expect(result.errors).toEqual({});
    expect(result.sortDir).toBe('asc');
  });

  test('clamps limit to MAX_LIMIT and floors fractional pagination', () => {
    const result = parseAdminMerchantListQuery({ limit: '1000', offset: '10.9' });

    expect(result.errors).toEqual({});
    expect(result.pagination).toEqual({ limit: MAX_LIMIT, offset: 10 });
  });

  test('rejects a non-positive limit and a negative offset', () => {
    const result = parseAdminMerchantListQuery({ limit: '0', offset: '-1' });

    expect(result.errors.limit).toBeDefined();
    expect(result.errors.offset).toBeDefined();
  });
});

describe('validateBlockMerchant', () => {
  test('accepts a missing body', () => {
    expect(validateBlockMerchant(undefined)).toEqual({ input: {}, errors: {} });
  });

  test('trims a supplied reason', () => {
    const result = validateBlockMerchant({ reason: '  fraud  ' });

    expect(result.errors).toEqual({});
    expect(result.input.reason).toBe('fraud');
  });

  test('rejects a non-string or blank reason', () => {
    expect(validateBlockMerchant({ reason: 42 }).errors.reason).toBeDefined();
    expect(validateBlockMerchant({ reason: '   ' }).errors.reason).toBeDefined();
  });
});
