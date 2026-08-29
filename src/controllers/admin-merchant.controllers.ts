import { Request, Response } from 'express';
import {
  blockMerchant,
  getMerchantAdminAnalytics,
  getMerchantForAdmin,
  listMerchantsForAdmin,
} from '../services/merchant.services.js';
import { listInvoices } from '../services/invoice.services.js';
import { recordAuditLog, ActorType } from '../services/audit-log.services.js';
import {
  parseAdminMerchantListQuery,
  validateBlockMerchant,
} from '../utils/merchant.validation.js';
import { parseInvoiceListQuery } from '../utils/invoice.validation.js';
import { AppError } from '../utils/errors.js';

const handleError = (error: unknown, req: Request, res: Response, action: string): void => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  console.error(`Failed to ${action}`, {
    path: req.path,
    method: req.method,
    error: error instanceof Error ? error.message : 'Unknown error',
  });
  res.status(500).json({ error: 'Internal Server Error' });
};

export const listMerchantsController = async (req: Request, res: Response): Promise<void> => {
  const { filters, pagination, sortBy, sortDir, errors } = parseAdminMerchantListQuery(
    req.query as Record<string, unknown>,
  );
  if (Object.keys(errors).length > 0) {
    res.status(400).json({ error: 'Validation failed', errors });
    return;
  }

  try {
    const result = await listMerchantsForAdmin(filters, pagination, sortBy, sortDir);
    res.status(200).json(result);
  } catch (error) {
    handleError(error, req, res, 'list merchants');
  }
};

export const getMerchantController = async (req: Request, res: Response): Promise<void> => {
  try {
    const merchant = await getMerchantForAdmin(req.params.id as string);
    res.status(200).json(merchant);
  } catch (error) {
    handleError(error, req, res, 'load the merchant');
  }
};

/**
 * Admin-scoped view of one merchant's invoices. Delegates to the same
 * listInvoices the merchant-facing route uses, so the response shape and the
 * accepted filters cannot drift between the two.
 */
export const listMerchantInvoicesController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { filters, pagination, errors } = parseInvoiceListQuery(
    req.query as Record<string, unknown>,
  );
  if (Object.keys(errors).length > 0) {
    res.status(400).json({ error: 'Validation failed', errors });
    return;
  }

  try {
    // 404s an unknown merchant rather than returning an empty page for an id
    // that never existed.
    await getMerchantForAdmin(req.params.id as string);
    const result = await listInvoices(req.params.id as string, filters, pagination);
    res.status(200).json(result);
  } catch (error) {
    handleError(error, req, res, 'list the merchant invoices');
  }
};

export const getMerchantAnalyticsController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const result = await getMerchantAdminAnalytics(req.params.id as string);
    res.status(200).json(result);
  } catch (error) {
    handleError(error, req, res, 'load the merchant analytics');
  }
};

/**
 * Blocks a merchant off-chain. The on-chain `set_merchant_status` call is
 * deliberately not made here — it requires the on-chain admin's signature,
 * which this backend does not hold; that reconciliation is deferred.
 *
 * Unblocking is out of scope for this endpoint and is not implemented.
 */
export const blockMerchantController = async (req: Request, res: Response): Promise<void> => {
  const admin = req.admin;
  if (!admin) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { input, errors } = validateBlockMerchant(req.body);
  if (Object.keys(errors).length > 0) {
    res.status(400).json({ error: 'Validation failed', errors });
    return;
  }

  try {
    const merchant = await blockMerchant(req.params.id as string);
    await recordAuditLog({
      action: 'merchant.blocked',
      actorType: ActorType.ADMIN,
      actorId: admin.id,
      actorLabel: admin.address,
      targetType: 'Merchant',
      targetId: merchant.id,
      ...(input.reason !== undefined ? { metadata: { reason: input.reason } } : {}),
    });
    res.status(200).json(merchant);
  } catch (error) {
    handleError(error, req, res, 'block the merchant');
  }
};
