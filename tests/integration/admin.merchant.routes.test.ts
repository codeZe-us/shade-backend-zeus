import { beforeEach } from '@jest/globals';
import { mockReset } from 'jest-mock-extended';
import jwt from 'jsonwebtoken';
import request from 'supertest';

const { default: prismaMock } = (await import('../../src/config/prisma.js')) as any;
const { environment } = await import('../../src/config/environment.js');
const { default: app } = await import('../../src/app.js');

const admin = {
  id: 'admin-uuid',
  address: 'GADMINADDRESS',
  active: true,
  isSuperAdmin: false,
  createdAt: new Date('2026-06-27T12:00:00.000Z'),
  updatedAt: new Date('2026-06-27T12:00:00.000Z'),
};

const superAdmin = { ...admin, id: 'superadmin-uuid', isSuperAdmin: true };

const merchant = {
  id: 'merchant-1',
  merchantId: 1,
  address: 'GMERCHANTADDRESS',
  account: null,
  merchantKey: null,
  email: 'merchant@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  businessName: 'Engines',
  category: 'software',
  description: 'desc',
  logo: null,
  webhook: null,
  active: true,
  verified: false,
  emailVerified: true,
  registered: true,
  emailOtp: null,
  emailOtpExpiresAt: null,
  createdAt: new Date('2026-06-27T12:00:00.000Z'),
  updatedAt: new Date('2026-06-27T12:00:00.000Z'),
};

const signToken = (subject: string) =>
  jwt.sign({ sub: subject, address: admin.address, type: 'admin' }, environment.jwtSecret, {
    expiresIn: '15m',
  });

const adminToken = signToken(admin.id);
const superAdminToken = signToken(superAdmin.id);

describe('GET /api/v1/admin/merchants', () => {
  beforeEach(() => {
    mockReset(prismaMock);
    prismaMock.admin.findUnique.mockResolvedValue(admin);
  });

  test('returns 401 when unauthenticated', async () => {
    const response = await request(app).get('/api/v1/admin/merchants');

    expect(response.status).toBe(401);
    expect(prismaMock.merchant.findMany).not.toHaveBeenCalled();
  });

  test('defaults to createdAt desc with the default page size', async () => {
    prismaMock.merchant.findMany.mockResolvedValue([merchant]);
    prismaMock.merchant.count.mockResolvedValue(1);

    const response = await request(app)
      .get('/api/v1/admin/merchants')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({ limit: 20, offset: 0, total: 1 });
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe('merchant-1');
    // sanitizeMerchant keeps the OTP columns out of an admin response too.
    expect(response.body.data[0]).not.toHaveProperty('emailOtp');
    expect(prismaMock.merchant.findMany).toHaveBeenCalledWith({
      where: {},
      take: 20,
      skip: 0,
      orderBy: { createdAt: 'desc' },
    });
  });

  test('applies the active, verified, category and search filters', async () => {
    prismaMock.merchant.findMany.mockResolvedValue([]);
    prismaMock.merchant.count.mockResolvedValue(0);

    const response = await request(app)
      .get('/api/v1/admin/merchants')
      .query({ active: 'true', verified: 'false', category: 'software', search: 'eng' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(prismaMock.merchant.findMany).toHaveBeenCalledWith({
      where: {
        active: true,
        verified: false,
        category: 'software',
        OR: [
          { businessName: { contains: 'eng', mode: 'insensitive' } },
          { email: { contains: 'eng', mode: 'insensitive' } },
          { address: { contains: 'eng', mode: 'insensitive' } },
        ],
      },
      take: 20,
      skip: 0,
      orderBy: { createdAt: 'desc' },
    });
  });

  test('honours sortBy, sortDir and pagination, clamping limit to MAX_LIMIT', async () => {
    prismaMock.merchant.findMany.mockResolvedValue([]);
    prismaMock.merchant.count.mockResolvedValue(0);

    const response = await request(app)
      .get('/api/v1/admin/merchants')
      .query({ sortBy: 'businessName', sortDir: 'asc', limit: '500', offset: '40' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(prismaMock.merchant.findMany).toHaveBeenCalledWith({
      where: {},
      take: 100,
      skip: 40,
      orderBy: { businessName: 'asc' },
    });
  });

  test('sorts by merchantId when asked', async () => {
    prismaMock.merchant.findMany.mockResolvedValue([]);
    prismaMock.merchant.count.mockResolvedValue(0);

    const response = await request(app)
      .get('/api/v1/admin/merchants')
      .query({ sortBy: 'merchantId', sortDir: 'asc' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(prismaMock.merchant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { merchantId: 'asc' } }),
    );
  });

  test('returns 400 for an unsupported sortBy', async () => {
    const response = await request(app)
      .get('/api/v1/admin/merchants')
      .query({ sortBy: 'email' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(response.body.errors).toHaveProperty('sortBy');
    expect(prismaMock.merchant.findMany).not.toHaveBeenCalled();
  });

  test('returns 400 for a non-boolean active filter', async () => {
    const response = await request(app)
      .get('/api/v1/admin/merchants')
      .query({ active: 'yes' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(response.body.errors).toHaveProperty('active');
    expect(prismaMock.merchant.findMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/admin/merchants/:id', () => {
  beforeEach(() => {
    mockReset(prismaMock);
    prismaMock.admin.findUnique.mockResolvedValue(admin);
  });

  test('returns the merchant detail', async () => {
    prismaMock.merchant.findUnique.mockResolvedValue(merchant);

    const response = await request(app)
      .get('/api/v1/admin/merchants/merchant-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe('merchant-1');
    expect(response.body.businessName).toBe('Engines');
    expect(response.body).not.toHaveProperty('emailOtp');
  });

  test('returns 404 for an unknown id', async () => {
    prismaMock.merchant.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/v1/admin/merchants/missing')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });
});

describe('GET /api/v1/admin/merchants/:id/invoices', () => {
  const invoice = {
    id: 'invoice-1',
    invoiceId: 1,
    merchantId: 'merchant-1',
    description: 'work',
    amount: 1000n,
    amountPaid: 0n,
    amountRefunded: 0n,
    token: 'USDC',
    status: 'PENDING',
    payerEmail: null,
    expiresAt: null,
    createdAt: new Date('2026-06-27T12:00:00.000Z'),
    updatedAt: new Date('2026-06-27T12:00:00.000Z'),
  };

  beforeEach(() => {
    mockReset(prismaMock);
    prismaMock.admin.findUnique.mockResolvedValue(admin);
  });

  test('scopes listInvoices to the merchant and passes its filters through', async () => {
    prismaMock.merchant.findUnique.mockResolvedValue(merchant);
    prismaMock.invoice.findMany.mockResolvedValue([invoice]);
    prismaMock.invoice.count.mockResolvedValue(1);

    const response = await request(app)
      .get('/api/v1/admin/merchants/merchant-1/invoices')
      .query({ status: 'pending', token: 'USDC' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({ limit: 20, offset: 0, total: 1 });
    expect(response.body.data).toHaveLength(1);
    expect(prismaMock.invoice.findMany).toHaveBeenCalledWith({
      where: { merchantId: 'merchant-1', status: 'PENDING', token: 'USDC' },
      take: 20,
      skip: 0,
      orderBy: { createdAt: 'desc' },
    });
  });

  test('returns 404 for an unknown merchant', async () => {
    prismaMock.merchant.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/v1/admin/merchants/missing/invoices')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
    expect(prismaMock.invoice.findMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/admin/merchants/:id/analytics', () => {
  beforeEach(() => {
    mockReset(prismaMock);
    prismaMock.admin.findUnique.mockResolvedValue(admin);
  });

  test('returns per-token totals and status-grouped invoice/subscription counts', async () => {
    prismaMock.merchant.findUnique.mockResolvedValue(merchant);
    prismaMock.merchantAnalytics.findMany.mockResolvedValue([
      {
        id: 'analytics-1',
        merchantId: 'merchant-1',
        token: 'USDC',
        totalVolume: 5000n,
        totalFees: 50n,
        transactionCount: 3n,
        lastUpdated: new Date('2026-06-27T12:00:00.000Z'),
      },
    ]);
    prismaMock.invoice.groupBy.mockResolvedValue([
      { status: 'PAID', _count: { _all: 2 } },
      { status: 'PENDING', _count: { _all: 1 } },
    ]);
    prismaMock.subscription.groupBy.mockResolvedValue([{ status: 'ACTIVE', _count: { _all: 4 } }]);

    const response = await request(app)
      .get('/api/v1/admin/merchants/merchant-1/analytics')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.tokens).toEqual([
      {
        token: 'USDC',
        totalVolume: '5000',
        totalFees: '50',
        transactionCount: '3',
        lastUpdated: '2026-06-27T12:00:00.000Z',
      },
    ]);
    expect(response.body.invoices).toEqual({ total: 3, byStatus: { PAID: 2, PENDING: 1 } });
    expect(response.body.subscriptions).toEqual({ total: 4, byStatus: { ACTIVE: 4 } });
    // Subscription.merchantId is a direct scalar, so no join through the plan.
    expect(prismaMock.subscription.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { merchantId: 'merchant-1' },
      _count: { _all: true },
    });
  });

  test('returns 404 for an unknown merchant', async () => {
    prismaMock.merchant.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/v1/admin/merchants/missing/analytics')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
    expect(prismaMock.merchantAnalytics.findMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/admin/merchants/:id/block', () => {
  beforeEach(() => {
    mockReset(prismaMock);
    prismaMock.admin.findUnique.mockResolvedValue(superAdmin);
  });

  test('returns 401 when unauthenticated', async () => {
    const response = await request(app).post('/api/v1/admin/merchants/merchant-1/block');

    expect(response.status).toBe(401);
    expect(prismaMock.merchant.update).not.toHaveBeenCalled();
  });

  test('returns 403 for an authenticated admin that is not a superadmin', async () => {
    prismaMock.admin.findUnique.mockResolvedValue(admin);

    const response = await request(app)
      .post('/api/v1/admin/merchants/merchant-1/block')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(403);
    expect(prismaMock.merchant.update).not.toHaveBeenCalled();
    expect(prismaMock.adminLog.create).not.toHaveBeenCalled();
  });

  test('sets active to false, returns the merchant, and logs the action once', async () => {
    prismaMock.merchant.findUnique.mockResolvedValue(merchant);
    prismaMock.merchant.update.mockResolvedValue({ ...merchant, active: false });

    const response = await request(app)
      .post('/api/v1/admin/merchants/merchant-1/block')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.active).toBe(false);
    expect(prismaMock.merchant.update).toHaveBeenCalledWith({
      where: { id: 'merchant-1' },
      data: { active: false },
    });
    expect(prismaMock.adminLog.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.adminLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'merchant.blocked',
        actorType: 'ADMIN',
        actorId: superAdmin.id,
        actorLabel: superAdmin.address,
        targetType: 'Merchant',
        targetId: 'merchant-1',
      }),
    });
  });

  test('records an optional reason in the audit log metadata', async () => {
    prismaMock.merchant.findUnique.mockResolvedValue(merchant);
    prismaMock.merchant.update.mockResolvedValue({ ...merchant, active: false });

    const response = await request(app)
      .post('/api/v1/admin/merchants/merchant-1/block')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ reason: 'chargeback fraud' });

    expect(response.status).toBe(200);
    expect(prismaMock.adminLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ metadata: { reason: 'chargeback fraud' } }),
    });
  });

  test('returns 400 for a non-string reason', async () => {
    const response = await request(app)
      .post('/api/v1/admin/merchants/merchant-1/block')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ reason: 42 });

    expect(response.status).toBe(400);
    expect(response.body.errors).toHaveProperty('reason');
    expect(prismaMock.merchant.update).not.toHaveBeenCalled();
  });

  test('returns 404 when the merchant does not exist', async () => {
    prismaMock.merchant.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/v1/admin/merchants/missing/block')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(response.status).toBe(404);
    expect(prismaMock.merchant.update).not.toHaveBeenCalled();
    expect(prismaMock.adminLog.create).not.toHaveBeenCalled();
  });

  // Unblocking is deliberately out of scope for this issue; no unblock route
  // exists, so the router must not answer one.
  test('exposes no unblock route', async () => {
    const response = await request(app)
      .post('/api/v1/admin/merchants/merchant-1/unblock')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(response.status).toBe(404);
    expect(prismaMock.merchant.update).not.toHaveBeenCalled();
  });
});
