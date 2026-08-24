import { Router } from 'express';
import {
  getSubscriptionController,
  listSubscriptionPaymentsController,
  listSubscriptionsController,
} from '../../controllers/admin-subscription.controllers.js';
import { authenticateAdmin } from '../../middlewares/admin.middleware.js';

const router = Router();

// Read-only dashboard data: any authenticated admin, no superadmin requirement.
router.use(authenticateAdmin);

// Declared before `/:id` so Express does not capture "payments" as an id.
router.get('/payments', listSubscriptionPaymentsController);
router.get('/', listSubscriptionsController);
router.get('/:id', getSubscriptionController);

export default router;
