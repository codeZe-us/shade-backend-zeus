import crypto from 'node:crypto';
import type { Admin } from '@prisma/client';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma.js';
import { environment } from '../config/environment.js';
import { verifySignature } from './auth.services.js';
import { AppError } from '../utils/errors.js';
import type { CreateAdminInput } from '../utils/admin.validation.js';
import { recordAuditLog, ActorType } from './audit-log.services.js';

const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export function issueAdminAccessToken(adminId: string, address: string): string {
  return jwt.sign({ sub: adminId, address, type: 'admin' }, environment.jwtSecret, {
    expiresIn: '15m',
  });
}

export async function issueAdminRefreshToken(adminId: string): Promise<string> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

  await prisma.adminRefreshToken.create({
    data: { adminId, token, expiresAt },
  });

  return token;
}

export async function authenticateAdminWallet(address: string, nonce: string, signature: string) {
  const verification = await verifySignature(address, nonce, signature);
  if (!verification.valid) {
    await recordAuditLog({
      action: 'admin.login_failed',
      actorType: ActorType.ANONYMOUS,
      actorLabel: address,
      metadata: { reason: verification.reason },
    });
    return { success: false, reason: verification.reason } as const;
  }

  const admin = await prisma.admin.findUnique({ where: { address } });
  if (!admin) {
    await recordAuditLog({
      action: 'admin.login_failed',
      actorType: ActorType.ANONYMOUS,
      actorLabel: address,
      metadata: { reason: 'Not an admin' },
    });
    return { success: false, reason: 'Not an admin' } as const;
  }

  if (!admin.active) {
    await recordAuditLog({
      action: 'admin.login_failed',
      actorType: ActorType.ADMIN,
      actorId: admin.id,
      actorLabel: admin.address,
      metadata: { reason: 'Inactive admin' },
    });
    return { success: false, reason: 'Not an admin' } as const;
  }

  const accessToken = issueAdminAccessToken(admin.id, admin.address);
  const refreshToken = await issueAdminRefreshToken(admin.id);

  await recordAuditLog({
    action: 'admin.login_succeeded',
    actorType: ActorType.ADMIN,
    actorId: admin.id,
    actorLabel: admin.address,
  });

  return {
    success: true,
    accessToken,
    refreshToken,
    admin: {
      id: admin.id,
      address: admin.address,
      isSuperAdmin: admin.isSuperAdmin,
    },
  } as const;
}

/**
 * Public view of an Admin row. Built as an allow-list, matching sanitizeMerchant,
 * so any sensitive field added to the model later is not exposed by default.
 */
export const sanitizeAdmin = (admin: Admin) => ({
  id: admin.id,
  address: admin.address,
  name: admin.name,
  active: admin.active,
  isSuperAdmin: admin.isSuperAdmin,
  createdBy: admin.createdBy,
  createdAt: admin.createdAt,
  updatedAt: admin.updatedAt,
});

// Duck-typed rather than an instanceof check against
// PrismaClientKnownRequestError: the generated client is mocked in tests, so
// the same convention as auth.services.ts applies here.
const isUniqueConstraintError = (error: unknown): boolean =>
  (error as { code?: string })?.code === 'P2002';

/**
 * Creates an Admin row on behalf of an acting superadmin.
 *
 * This is the ongoing counterpart to scripts/create-superadmin.ts, which can
 * only bootstrap the very first admin. It keeps that script's non-overwrite
 * discipline: an address that already has an Admin row is a 409, never an
 * update and never a silent no-op.
 *
 * Backend-only by design. The contract's own Admin/Manager/Operator roles are a
 * separate on-chain authorization concern this backend does not drive, so no
 * contract call is made anywhere in this flow. No keypair or secret is involved
 * either — admins authenticate with their own existing Stellar wallet.
 */
export const createAdmin = async (
  actingAdmin: { id: string; address: string },
  input: CreateAdminInput,
) => {
  const existing = await prisma.admin.findUnique({ where: { address: input.address } });

  if (existing) {
    throw new AppError(409, 'An admin already exists for this address');
  }

  // The row and its `admin.created` log share one transaction so a privileged
  // account can never exist without an audit trail. recordAuditLog is
  // deliberately not used here: it swallows its own failures, which would break
  // that invariant. Every other caller still wants that swallowing behaviour.
  return prisma.$transaction(async (tx: any) => {
    let admin: Admin;

    try {
      admin = await tx.admin.create({
        data: {
          address: input.address,
          name: input.name,
          isSuperAdmin: input.isSuperAdmin,
          active: true,
          createdBy: actingAdmin.id,
        },
      });
    } catch (error) {
      // The findUnique above is not a lock, so two concurrent requests for the
      // same address can both pass it. Admin.address is unique, so the loser
      // gets the same 409 it would have got sequentially.
      if (isUniqueConstraintError(error)) {
        throw new AppError(409, 'An admin already exists for this address');
      }
      throw error;
    }

    await tx.adminLog.create({
      data: {
        action: 'admin.created',
        actorType: ActorType.ADMIN,
        actorId: actingAdmin.id,
        actorLabel: actingAdmin.address,
        targetType: 'Admin',
        targetId: admin.id,
        metadata: { address: admin.address, isSuperAdmin: admin.isSuperAdmin },
      },
    });

    return admin;
  });
};
