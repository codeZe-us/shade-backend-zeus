import { StrKey } from '@stellar/stellar-sdk';

export interface CreateAdminInput {
  address: string;
  name: string;
  isSuperAdmin: boolean;
}

export type ValidationErrors = Record<string, string>;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Validates the body of a create-admin request.
 *
 * `isSuperAdmin` is optional and defaults to false: a superadmin adding another
 * admin does not implicitly grant superadmin, though it may be requested
 * explicitly. Only a real boolean is accepted — coercing a truthy string here
 * would silently escalate the new admin's privileges, and an explicit null is
 * rejected rather than treated as omission.
 */
export const validateCreateAdmin = (
  body: unknown,
): { input: CreateAdminInput; errors: ValidationErrors } => {
  const errors: ValidationErrors = {};
  const payload = (body ?? {}) as Record<string, unknown>;

  if (!isNonEmptyString(payload.address)) {
    errors.address = 'address is required';
  } else if (!StrKey.isValidEd25519PublicKey(payload.address.trim())) {
    errors.address = 'address must be a valid Stellar public key';
  }

  if (!isNonEmptyString(payload.name)) {
    errors.name = 'name is required';
  }

  // Only `undefined` counts as omitted. An explicit null is a supplied value
  // that is not a boolean, so it is rejected rather than silently defaulted.
  if (payload.isSuperAdmin !== undefined && typeof payload.isSuperAdmin !== 'boolean') {
    errors.isSuperAdmin = 'isSuperAdmin must be a boolean';
  }

  const input: CreateAdminInput = {
    address: isNonEmptyString(payload.address) ? payload.address.trim() : '',
    name: isNonEmptyString(payload.name) ? payload.name.trim() : '',
    isSuperAdmin: payload.isSuperAdmin === true,
  };

  return { input, errors };
};
