import { Request, Response } from 'express';
import { StrKey } from '@stellar/stellar-sdk';
import { createNonce } from '../services/auth.services.js';
import {
  authenticateAdminWallet,
  createAdmin,
  sanitizeAdmin,
} from '../services/admin-auth.services.js';
import { recordAuditLog, ActorType } from '../services/audit-log.services.js';
import { validateCreateAdmin } from '../utils/admin.validation.js';
import { AppError } from '../utils/errors.js';

export const createAdminChallengeController = async (req: Request, res: Response) => {
  try {
    const { address } = req.body ?? {};
    if (!address || typeof address !== 'string' || !StrKey.isValidEd25519PublicKey(address)) {
      res.status(400).json({ error: 'Invalid Stellar address' });
      return;
    }

    const result = await createNonce(address);
    res.status(200).json(result);
  } catch (error) {
    console.error('Failed to create admin auth challenge', {
      path: req.path,
      method: req.method,
      address: typeof req.body?.address === 'string' ? req.body.address : undefined,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const verifyAdminSignatureController = async (req: Request, res: Response) => {
  try {
    const { address, nonce, signature } = req.body ?? {};
    if (!address || !nonce || !signature) {
      res.status(400).json({ error: 'address, nonce, and signature are required' });
      return;
    }
    if (typeof address !== 'string' || typeof nonce !== 'string' || typeof signature !== 'string') {
      res.status(400).json({ error: 'address, nonce, and signature must be strings' });
      return;
    }

    const result = await authenticateAdminWallet(address, nonce, signature);

    if (!result.success) {
      res.status(401).json({ error: result.reason });
      return;
    }

    res.status(200).json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      admin: result.admin,
    });
  } catch (error) {
    console.error('Failed to verify admin auth signature', {
      path: req.path,
      method: req.method,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * Creates another admin. Superadmin-only; the route applies requireSuperAdmin.
 *
 * Deliberately makes no smart contract call: admin membership here is a
 * backend concept, decoupled from the contract's own Admin/Manager/Operator
 * role system.
 */
export const createAdminController = async (req: Request, res: Response): Promise<void> => {
  const actingAdmin = req.admin;
  if (!actingAdmin) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { input, errors } = validateCreateAdmin(req.body);
  if (Object.keys(errors).length > 0) {
    res.status(400).json({ error: 'Validation failed', errors });
    return;
  }

  try {
    const admin = await createAdmin(actingAdmin.id, input);

    await recordAuditLog({
      action: 'admin.created',
      actorType: ActorType.ADMIN,
      actorId: actingAdmin.id,
      actorLabel: actingAdmin.address,
      targetType: 'Admin',
      targetId: admin.id,
      metadata: { address: admin.address, isSuperAdmin: admin.isSuperAdmin },
    });

    res.status(201).json(sanitizeAdmin(admin));
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    console.error('Failed to create admin', {
      path: req.path,
      method: req.method,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
