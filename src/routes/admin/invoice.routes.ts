import { Router } from 'express';
import {
  getAdminInvoiceController,
  listAdminInvoicesController,
} from '../../controllers/admin-invoice.controllers.js';
import { authenticateAdmin } from '../../middlewares/admin.middleware.js';

const router = Router();

// Read-only dashboard data: any authenticated admin, no superadmin requirement.
router.use(authenticateAdmin);

router.get('/', listAdminInvoicesController);
router.get('/:id', getAdminInvoiceController);

export default router;
