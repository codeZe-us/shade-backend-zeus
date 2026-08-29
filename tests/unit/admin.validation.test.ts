const { validateCreateAdmin } = await import('../../src/utils/admin.validation.js');

// A real, structurally valid Ed25519 public key; StrKey checks the checksum, so
// an arbitrary G-prefixed string will not do.
const VALID_ADDRESS = 'GA6HCMBLTZS5VYYBCATRBRZ3BZJMAFUDKYYF6AH6MVCMGWMRDNSWJPIH';

describe('validateCreateAdmin', () => {
  test('accepts an address and name, defaulting isSuperAdmin to false', () => {
    const result = validateCreateAdmin({ address: VALID_ADDRESS, name: 'Jane Doe' });

    expect(result.errors).toEqual({});
    expect(result.input).toEqual({
      address: VALID_ADDRESS,
      name: 'Jane Doe',
      isSuperAdmin: false,
    });
  });

  test('trims the address and name', () => {
    const result = validateCreateAdmin({
      address: `  ${VALID_ADDRESS}  `,
      name: '  Jane Doe  ',
    });

    expect(result.errors).toEqual({});
    expect(result.input.address).toBe(VALID_ADDRESS);
    expect(result.input.name).toBe('Jane Doe');
  });

  test('grants superadmin only when explicitly requested', () => {
    const granted = validateCreateAdmin({
      address: VALID_ADDRESS,
      name: 'Jane Doe',
      isSuperAdmin: true,
    });

    expect(granted.errors).toEqual({});
    expect(granted.input.isSuperAdmin).toBe(true);
  });

  test('rejects a non-boolean isSuperAdmin rather than coercing it', () => {
    const result = validateCreateAdmin({
      address: VALID_ADDRESS,
      name: 'Jane Doe',
      isSuperAdmin: 'true',
    });

    expect(result.errors.isSuperAdmin).toBeDefined();
    // A truthy string must never escalate the new admin's privileges.
    expect(result.input.isSuperAdmin).toBe(false);
  });

  test('rejects a null isSuperAdmin rather than treating it as omitted', () => {
    const result = validateCreateAdmin({
      address: VALID_ADDRESS,
      name: 'Jane Doe',
      isSuperAdmin: null,
    });

    expect(result.errors.isSuperAdmin).toBeDefined();
    expect(result.input.isSuperAdmin).toBe(false);
  });

  test('rejects an invalid Stellar address', () => {
    const result = validateCreateAdmin({ address: 'not-a-key', name: 'Jane Doe' });

    expect(result.errors.address).toBeDefined();
  });

  test('rejects a missing or blank address and name', () => {
    expect(validateCreateAdmin({}).errors.address).toBeDefined();
    expect(validateCreateAdmin({}).errors.name).toBeDefined();
    expect(validateCreateAdmin({ address: '   ', name: '   ' }).errors.address).toBeDefined();
    expect(validateCreateAdmin({ address: VALID_ADDRESS, name: '   ' }).errors.name).toBeDefined();
  });

  test('accepts a missing body without throwing', () => {
    const result = validateCreateAdmin(undefined);

    expect(result.errors.address).toBeDefined();
    expect(result.errors.name).toBeDefined();
  });
});
