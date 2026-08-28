import { Merchant, Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { AppError } from '../utils/errors.js';
import { RegisterMerchantInput, UpdateMerchantInput } from '../utils/validation.js';
import type {
  AdminMerchantListFilters,
  AdminMerchantListPagination,
  MerchantListSortBy,
  MerchantListSortDir,
} from '../utils/merchant.validation.js';
import { generateOtp, hashOtp } from './otp.services.js';
import { sendOtp } from './email.service.js';
import { Keypair } from '@stellar/stellar-sdk';

const OTP_EXPIRY_MS = 10 * 60 * 1000;

interface MerchantData {
  merchantId: number;
  email?: string;
  address: string;
  active?: boolean;
  verified?: boolean;
}

/**
 * Returns a public-facing view of a merchant. Built as an allow-list so that
 * any sensitive fields added to the model later are never exposed by default.
 */
export const sanitizeMerchant = (merchant: Merchant) => ({
  id: merchant.id,
  merchantId: merchant.merchantId,
  email: merchant.email,
  address: merchant.address,
  account: merchant.account,
  merchantKey: merchant.merchantKey,
  firstName: merchant.firstName,
  lastName: merchant.lastName,
  businessName: merchant.businessName,
  category: merchant.category,
  description: merchant.description,
  logo: merchant.logo,
  webhook: merchant.webhook,
  active: merchant.active,
  verified: merchant.verified,
  emailVerified: merchant.emailVerified,
  registered: merchant.registered,
  createdAt: merchant.createdAt,
  updatedAt: merchant.updatedAt,
});

export const createMerchant = async (merchantData: MerchantData) => {
  const merchant = await prisma.merchant.create({
    data: merchantData,
  });
  return merchant;
};

export const getMerchant = async (merchantId: number) => {
  const merchant = await prisma.merchant.findUnique({
    where: {
      merchantId: merchantId,
    },
  });
  return merchant;
};

export const listMerchants = async (limit: number, offset: number) => {
  const merchants = await prisma.merchant.findMany({
    take: limit,
    skip: offset,
  });
  return merchants;
};

/**
 * Completes a merchant's profile after wallet authentication.
 *
 * Enforces that the email is unique across merchants and that the profile has
 * not already been completed, persists the profile data, resets email
 * verification, and triggers an OTP email.
 */
export const registerMerchant = async (merchantId: string, data: RegisterMerchantInput) => {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
  });

  if (!merchant) {
    throw new AppError(404, 'Merchant not found');
  }

  if (merchant.registered) {
    throw new AppError(409, 'Profile already set up');
  }

  const normalizedEmail = data.email.trim().toLowerCase();

  const existingEmail = await prisma.merchant.findFirst({
    where: {
      email: normalizedEmail,
      NOT: { id: merchantId },
    },
  });

  if (existingEmail) {
    throw new AppError(409, 'Email already registered');
  }

  const code = generateOtp();
  const emailOtp = await hashOtp(code);
  const emailOtpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

  const updatedMerchant = await prisma.merchant.update({
    where: { id: merchantId },
    data: {
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      email: normalizedEmail,
      businessName: data.businessName.trim(),
      category: data.category.trim(),
      description: data.description.trim(),
      logo: data.logo?.trim() ?? null,
      emailVerified: false,
      registered: true,
      emailOtp,
      emailOtpExpiresAt,
    },
  });

  try {
    await sendOtp(normalizedEmail, code, data.firstName.trim());
  } catch (err) {
    console.error('Failed to send OTP email after registration', err);
  }

  return sanitizeMerchant(updatedMerchant);
};

/**
 * Returns the authenticated merchant's own profile.
 */
export const getMyProfile = async (id: string) => {
  const merchant = await prisma.merchant.findUnique({ where: { id } });

  if (!merchant) {
    throw new AppError(404, 'Merchant not found');
  }

  return sanitizeMerchant(merchant);
};

/**
 * Generates a fresh Ed25519 signing keypair for the merchant.
 *
 * Persists ONLY the hex-encoded 32-byte public key to `Merchant.merchantKey`,
 * overwriting any previous value (unconditional generate-and-replace). Returns
 * both halves; the hex-encoded 32-byte private key is returned exactly once and
 * is never written to the database or logged.
 *
 * Uploading the public key on-chain (`set_merchant_key`) and signing invoices
 * with the private key are done client/SDK-side and are out of scope here.
 */
export const generateMerchantSigningKey = async (id: string) => {
  const merchant = await prisma.merchant.findUnique({ where: { id } });

  if (!merchant) {
    throw new AppError(404, 'Merchant not found');
  }

  const keypair = Keypair.random();
  const publicKey = Buffer.from(keypair.rawPublicKey()).toString('hex');
  const privateKey = Buffer.from(keypair.rawSecretKey()).toString('hex');

  // Optimistic concurrency: only replace the key we just read. If a concurrent
  // rotation already changed it, no row matches and we reject rather than return
  // a private key whose public half is no longer the one persisted.
  const { count } = await prisma.merchant.updateMany({
    where: { id, merchantKey: merchant.merchantKey },
    data: { merchantKey: publicKey },
  });

  if (count !== 1) {
    throw new AppError(409, 'Signing key was changed concurrently; please retry');
  }

  // Audit only — never include the private key here.
  console.info(
    `[merchant] signing key ${merchant.merchantKey ? 'rotated' : 'created'} for merchant ${id}`,
  );

  return { publicKey, privateKey };
};

/**
 * Deactivates a merchant (admin action). Sets Merchant.active = false only;
 * this does not currently gate login, invoice creation, or any other flow.
 *
 * Off-chain only. The contract's own `set_merchant_status(admin, merchant_id,
 * status)` requires the on-chain admin's signature, which this backend cannot
 * produce, so the on-chain merchant status is deliberately left untouched here.
 * Reconciling the two is deferred to separate future work, following the same
 * off-chain-first pattern already established for invoice amendment.
 *
 * Unblocking is intentionally not implemented — only blocking was in scope.
 */
export const blockMerchant = async (id: string) => {
  const merchant = await prisma.merchant.findUnique({ where: { id } });

  if (!merchant) {
    throw new AppError(404, 'Merchant not found');
  }

  const updated = await prisma.merchant.update({
    where: { id },
    data: { active: false },
  });

  return sanitizeMerchant(updated);
};

// ── Admin read side ─────────────────────────────────────────────────────────

/**
 * Paginated merchant list for the admin dashboard.
 *
 * `search` is a case-insensitive contains across businessName, email and
 * address; the boolean and category filters are exact. Rows go through
 * sanitizeMerchant like every other merchant response, which already withholds
 * the OTP columns an admin has no reason to see.
 */
export const listMerchantsForAdmin = async (
  filters: AdminMerchantListFilters,
  pagination: AdminMerchantListPagination,
  sortBy: MerchantListSortBy,
  sortDir: MerchantListSortDir,
) => {
  const where: Prisma.MerchantWhereInput = {};

  if (filters.active !== undefined) {
    where.active = filters.active;
  }

  if (filters.verified !== undefined) {
    where.verified = filters.verified;
  }

  if (filters.category) {
    where.category = filters.category;
  }

  if (filters.search) {
    where.OR = [
      { businessName: { contains: filters.search, mode: 'insensitive' } },
      { email: { contains: filters.search, mode: 'insensitive' } },
      { address: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  const [merchants, total] = await Promise.all([
    prisma.merchant.findMany({
      where,
      take: pagination.limit,
      skip: pagination.offset,
      orderBy: { [sortBy]: sortDir },
    }),
    prisma.merchant.count({ where }),
  ]);

  return {
    data: merchants.map(sanitizeMerchant),
    pagination: {
      limit: pagination.limit,
      offset: pagination.offset,
      total,
    },
  };
};

/**
 * Full merchant detail for an admin, keyed by Merchant.id (uuid).
 */
export const getMerchantForAdmin = async (id: string) => {
  const merchant = await prisma.merchant.findUnique({ where: { id } });

  if (!merchant) {
    throw new AppError(404, 'Merchant not found');
  }

  return sanitizeMerchant(merchant);
};

/**
 * Per-merchant analytics for the admin dashboard: the merchant's own per-token
 * counters plus live status-grouped invoice and subscription counts.
 *
 * BigInt counters are serialized as strings, matching how analytics.services.ts
 * already reports them, since JSON has no BigInt.
 */
export const getMerchantAdminAnalytics = async (id: string) => {
  const merchant = await prisma.merchant.findUnique({ where: { id } });

  if (!merchant) {
    throw new AppError(404, 'Merchant not found');
  }

  const [tokenRows, invoicesByStatus, subscriptionsByStatus] = await Promise.all([
    prisma.merchantAnalytics.findMany({
      where: { merchantId: id },
      orderBy: { totalVolume: 'desc' },
    }),
    prisma.invoice.groupBy({
      by: ['status'],
      where: { merchantId: id },
      _count: { _all: true },
    }),
    // Subscription.merchantId is a direct scalar (see the composite FK comment
    // on the model), so this needs no join through SubscriptionPlan.
    prisma.subscription.groupBy({
      by: ['status'],
      where: { merchantId: id },
      _count: { _all: true },
    }),
  ]);

  const countByStatus = (groups: { status: string; _count: { _all: number } }[]) => {
    const counts: Record<string, number> = {};
    for (const group of groups) {
      counts[group.status] = group._count._all;
    }
    return counts;
  };

  const invoiceCounts = countByStatus(
    invoicesByStatus as { status: string; _count: { _all: number } }[],
  );
  const subscriptionCounts = countByStatus(
    subscriptionsByStatus as { status: string; _count: { _all: number } }[],
  );

  const sumCounts = (counts: Record<string, number>) =>
    Object.values(counts).reduce((total, count) => total + count, 0);

  return {
    merchantId: merchant.id,
    tokens: tokenRows.map(row => ({
      token: row.token,
      totalVolume: row.totalVolume.toString(),
      totalFees: row.totalFees.toString(),
      transactionCount: row.transactionCount.toString(),
      lastUpdated: row.lastUpdated.toISOString(),
    })),
    invoices: {
      total: sumCounts(invoiceCounts),
      byStatus: invoiceCounts,
    },
    subscriptions: {
      total: sumCounts(subscriptionCounts),
      byStatus: subscriptionCounts,
    },
  };
};

/**
 * Partially updates the authenticated merchant's editable profile fields.
 *
 * Only fields present in `data` are written. Strings are trimmed; an empty
 * `logo`/`webhook` is normalized to null so the merchant can clear them.
 * Non-editable fields are never read here, so they cannot be changed.
 */
export const updateMyProfile = async (id: string, data: UpdateMerchantInput) => {
  const updateData: Prisma.MerchantUpdateInput = {};

  const textFields = ['firstName', 'lastName', 'businessName', 'category', 'description'] as const;
  for (const field of textFields) {
    const value = data[field];
    if (value !== undefined) {
      updateData[field] = value.trim();
    }
  }

  if (data.logo !== undefined) {
    const logo = typeof data.logo === 'string' ? data.logo.trim() : data.logo;
    updateData.logo = logo ? logo : null;
  }

  if (data.webhook !== undefined) {
    const webhook = typeof data.webhook === 'string' ? data.webhook.trim() : data.webhook;
    updateData.webhook = webhook ? webhook : null;
  }

  const updated = await prisma.merchant.update({ where: { id }, data: updateData });

  return sanitizeMerchant(updated);
};
