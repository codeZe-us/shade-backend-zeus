import { Router } from 'express';
import authRoutes from './auth.routes.js';
import analyticsRoutes from './analytics.routes.js';
import merchantRoutes from './merchant.routes.js';
import logsRoutes from './logs.routes.js';
import subscriptionsRoutes from './subscriptions.routes.js';
import invoiceRoutes from './invoice.routes.js';
import { authenticateAdmin } from '../../middlewares/admin.middleware.js';

const router = Router();

// Public: issues the wallet challenge/verify pair, no admin session yet.
router.use('/auth', authRoutes);

// Protected: the router applies authenticateAdmin to every route it owns.
router.use('/analytics', analyticsRoutes);

// Sibling routers added by later issues (merchant.routes.ts, invoice.routes.ts, ...)
// are mounted here behind authenticateAdmin.
router.use('/merchants', authenticateAdmin, merchantRoutes);
router.use('/logs', authenticateAdmin, logsRoutes);
router.use('/subscriptions', authenticateAdmin, subscriptionsRoutes);
router.use('/invoices', authenticateAdmin, invoiceRoutes);

export default router;
