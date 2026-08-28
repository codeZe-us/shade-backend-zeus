import { Router } from 'express';
import { createAdminController } from '../../controllers/admin-auth.controllers.js';
import { requireSuperAdmin } from '../../middlewares/admin.middleware.js';

const router = Router();

// Admin management is superadmin-only. authenticateAdmin is applied where this
// router is mounted (admin/index.ts); requireSuperAdmin chains after it.
router.post('/', requireSuperAdmin, createAdminController);

export default router;
