import { Request, Response } from 'express';
import {
  listSubscriptionPlans,
  getSubscriptionPlan,
} from '../services/admin-subscription-plan.services.js';
import { parseAdminSubscriptionPlanListQuery } from '../utils/admin-subscription-plan.validation.js';
import { AppError } from '../utils/errors.js';

export const listSubscriptionPlansController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { filters, pagination, sortBy, sortDir, errors } = parseAdminSubscriptionPlanListQuery(
    req.query as Record<string, unknown>,
  );

  if (Object.keys(errors).length > 0) {
    res.status(400).json({ error: 'Validation failed', errors });
    return;
  }

  try {
    const result = await listSubscriptionPlans(filters, pagination, sortBy, sortDir);
    res.status(200).json(result);
  } catch (error) {
    handleError(error, req, res);
  }
};

export const getSubscriptionPlanController = async (req: Request, res: Response): Promise<void> => {
  try {
    const plan = await getSubscriptionPlan(req.params.id as string);
    res.status(200).json(plan);
  } catch (error) {
    handleError(error, req, res);
  }
};

const handleError = (error: unknown, req: Request, res: Response): void => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  console.error('Failed to process admin subscription plans request', {
    path: req.path,
    method: req.method,
    error: error instanceof Error ? error.message : 'Unknown error',
  });
  res.status(500).json({ error: 'Internal Server Error' });
};
