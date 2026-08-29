import { Router } from 'express';
import {
  blockMerchantController,
  getMerchantAnalyticsController,
  getMerchantController,
  listMerchantInvoicesController,
  listMerchantsController,
} from '../../controllers/admin-merchant.controllers.js';
import { requireSuperAdmin } from '../../middlewares/admin.middleware.js';

const router = Router();

// Read-only dashboard data: any authenticated admin, no superadmin requirement.
// authenticateAdmin is applied where this router is mounted (admin/index.ts).
router.get('/', listMerchantsController);
router.get('/:id', getMerchantController);
router.get('/:id/invoices', listMerchantInvoicesController);
router.get('/:id/analytics', getMerchantAnalyticsController);

// Moderation: superadmin only. Unblocking is deliberately not exposed here —
// only blocking was in scope; see blockMerchant in merchant.services.ts.
router.post('/:id/block', requireSuperAdmin, blockMerchantController);

export default router;
