import { Request, Response } from 'express';
import {
  getSubscription,
  listSubscriptionPayments,
  listSubscriptions,
} from '../services/subscription.services.js';
import {
  parseAdminSubscriptionListQuery,
  parseAdminSubscriptionPaymentsQuery,
} from '../utils/subscription.validation.js';
import { AppError } from '../utils/errors.js';

export const listSubscriptionsController = async (req: Request, res: Response): Promise<void> => {
  const { filters, pagination, sortBy, sortDir, errors } = parseAdminSubscriptionListQuery(
    req.query as Record<string, unknown>,
  );
  if (Object.keys(errors).length > 0) {
    res.status(400).json({ error: 'Validation failed', errors });
    return;
  }

  try {
    const result = await listSubscriptions(filters, pagination, sortBy, sortDir);
    res.status(200).json(result);
  } catch (error) {
    handleError(error, req, res);
  }
};

export const getSubscriptionController = async (req: Request, res: Response): Promise<void> => {
  try {
    const subscription = await getSubscription(req.params.id as string);
    res.status(200).json(subscription);
  } catch (error) {
    handleError(error, req, res);
  }
};

export const listSubscriptionPaymentsController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { filters, pagination, errors } = parseAdminSubscriptionPaymentsQuery(
    req.query as Record<string, unknown>,
  );
  if (Object.keys(errors).length > 0) {
    res.status(400).json({ error: 'Validation failed', errors });
    return;
  }

  try {
    const result = await listSubscriptionPayments(filters, pagination);
    res.status(200).json(result);
  } catch (error) {
    handleError(error, req, res);
  }
};

const handleError = (error: unknown, req: Request, res: Response): void => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  console.error('Failed to load admin subscriptions', {
    path: req.path,
    method: req.method,
    error: error instanceof Error ? error.message : 'Unknown error',
  });
  res.status(500).json({ error: 'Internal Server Error' });
};
