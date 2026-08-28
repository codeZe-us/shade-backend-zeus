import { Router } from 'express';
import {
  listSubscriptionPlansController,
  getSubscriptionPlanController,
} from '../../controllers/admin-subscription-plan.controllers.js';

const router = Router();

router.get('/', listSubscriptionPlansController);
router.get('/:id', getSubscriptionPlanController);

export default router;
