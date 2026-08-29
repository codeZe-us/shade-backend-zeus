import { Request, Response } from 'express';
import { getAdminInvoice, listAdminInvoices } from '../services/invoice.services.js';
import { parseAdminInvoiceListQuery } from '../utils/invoice.validation.js';
import { AppError } from '../utils/errors.js';

export const listAdminInvoicesController = async (req: Request, res: Response): Promise<void> => {
  const { filters, pagination, errors } = parseAdminInvoiceListQuery(
    req.query as Record<string, unknown>,
  );
  if (Object.keys(errors).length > 0) {
    res.status(400).json({ error: 'Validation failed', errors });
    return;
  }

  try {
    const result = await listAdminInvoices(filters, pagination);
    res.status(200).json(result);
  } catch (error) {
    handleError(error, req, res);
  }
};

export const getAdminInvoiceController = async (req: Request, res: Response): Promise<void> => {
  try {
    const invoice = await getAdminInvoice(req.params.id as string);
    res.status(200).json(invoice);
  } catch (error) {
    handleError(error, req, res);
  }
};

const handleError = (error: unknown, req: Request, res: Response): void => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  console.error('Failed to load admin invoices', {
    path: req.path,
    method: req.method,
    error: error instanceof Error ? error.message : 'Unknown error',
  });
  res.status(500).json({ error: 'Internal Server Error' });
};
