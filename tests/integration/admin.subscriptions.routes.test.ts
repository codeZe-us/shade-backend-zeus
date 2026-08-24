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

const adminToken = jwt.sign(
  { sub: admin.id, address: admin.address, type: 'admin' },
  environment.jwtSecret,
  { expiresIn: '15m' },
);

const mockDate = new Date('2026-06-24T10:00:00.000Z');

const basePlan = {
  id: 'plan-uuid',
  planId: 101,
  merchantId: 'merchant-uuid',
  description: 'Monthly Pro Plan',
  token: 'CABC...TOKEN',
  amount: BigInt(10_000_000),
  interval: 2_592_000,
  active: true,
  createdAt: mockDate,
  updatedAt: mockDate,
};

const baseSubscription = {
  id: 'sub-uuid',
  subscriptionId: 501,
  planId: 'plan-uuid',
  merchantId: 'merchant-uuid',
  customer: 'GCUSTOMER123',
  status: 'ACTIVE',
  lastCharged: new Date('2026-07-24T10:00:00.000Z'),
  createdAt: mockDate,
  updatedAt: mockDate,
};

const baseTransaction = {
  id: 'txn-uuid',
  transactionType: 'SUBSCRIPTION_CHARGE',
  refId: 501,
  amount: BigInt(10_000_000),
  token: 'CABC...TOKEN',
  merchantId: 'merchant-uuid',
  description: 'Subscription #501 charge',
  date: mockDate,
  createdAt: mockDate,
};

describe('GET /api/v1/admin/subscriptions', () => {
  beforeEach(() => {
    mockReset(prismaMock);
    prismaMock.admin.findUnique.mockResolvedValue(admin);
  });

  test('returns 401 when unauthenticated', async () => {
    const response = await request(app).get('/api/v1/admin/subscriptions');

    expect(response.status).toBe(401);
  });

  test('lists subscriptions newest-first by default with default pagination', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([baseSubscription]);
    prismaMock.subscription.count.mockResolvedValue(1);

    const response = await request(app)
      .get('/api/v1/admin/subscriptions')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination).toEqual({ limit: 20, offset: 0, total: 1 });
    expect(prismaMock.subscription.findMany).toHaveBeenCalledWith({
      where: {},
      take: 20,
      skip: 0,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { plan: true },
    });
  });

  test('applies status, planId, customer filters and pagination', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([baseSubscription]);
    prismaMock.subscription.count.mockResolvedValue(1);

    const response = await request(app)
      .get('/api/v1/admin/subscriptions')
      .query({ status: 'cancelled', planId: 'plan-uuid', customer: 'GCUSTOMER123', limit: 5, offset: 10 })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(prismaMock.subscription.findMany).toHaveBeenCalledWith({
      where: {
        status: 'CANCELLED',
        planId: 'plan-uuid',
        customer: 'GCUSTOMER123',
      },
      take: 5,
      skip: 10,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { plan: true },
    });
  });

  test('resolves merchantAddress to a merchant id and filters by merchantId', async () => {
    prismaMock.merchant.findUnique.mockResolvedValue({ id: 'merchant-uuid' });
    prismaMock.subscription.findMany.mockResolvedValue([baseSubscription]);
    prismaMock.subscription.count.mockResolvedValue(1);

    const response = await request(app)
      .get('/api/v1/admin/subscriptions')
      .query({ merchantAddress: 'GMERCHANT123' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(prismaMock.merchant.findUnique).toHaveBeenCalledWith({
      where: { address: 'GMERCHANT123' },
      select: { id: true },
    });
    expect(prismaMock.subscription.findMany).toHaveBeenCalledWith({
      where: { merchantId: 'merchant-uuid' },
      take: 20,
      skip: 0,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { plan: true },
    });
  });

  test('returns an empty page when merchantAddress has no matching merchant', async () => {
    prismaMock.merchant.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/v1/admin/subscriptions')
      .query({ merchantAddress: 'GUNKNOWN123' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [],
      pagination: { limit: 20, offset: 0, total: 0 },
    });
    expect(prismaMock.subscription.findMany).not.toHaveBeenCalled();
  });

  test('applies sortBy and sortDir', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([baseSubscription]);
    prismaMock.subscription.count.mockResolvedValue(1);

    const response = await request(app)
      .get('/api/v1/admin/subscriptions')
      .query({ sortBy: 'lastCharged', sortDir: 'asc' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(prismaMock.subscription.findMany).toHaveBeenCalledWith({
      where: {},
      take: 20,
      skip: 0,
      orderBy: [{ lastCharged: 'asc' }, { id: 'desc' }],
      include: { plan: true },
    });
  });

  test('serializes plan amount as a string and inlines plan details', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([{ ...baseSubscription, plan: basePlan }]);
    prismaMock.subscription.count.mockResolvedValue(1);

    const response = await request(app)
      .get('/api/v1/admin/subscriptions')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data[0].plan).toEqual({
      planId: 101,
      description: 'Monthly Pro Plan',
      token: 'CABC...TOKEN',
      amount: '10000000',
      interval: 2_592_000,
      active: true,
    });
  });

  test('clamps limit to the maximum of 100', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([]);
    prismaMock.subscription.count.mockResolvedValue(0);

    const response = await request(app)
      .get('/api/v1/admin/subscriptions?limit=500')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.pagination.limit).toBe(100);
  });

  test('returns 400 for an invalid status', async () => {
    const response = await request(app)
      .get('/api/v1/admin/subscriptions?status=NOT_REAL')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(response.body.errors).toHaveProperty('status');
  });

  test('returns 400 for invalid sortBy and sortDir', async () => {
    const response = await request(app)
      .get('/api/v1/admin/subscriptions?sortBy=amount&sortDir=sideways')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(response.body.errors).toHaveProperty('sortBy');
    expect(response.body.errors).toHaveProperty('sortDir');
  });
});

describe('GET /api/v1/admin/subscriptions/:id', () => {
  beforeEach(() => {
    mockReset(prismaMock);
    prismaMock.admin.findUnique.mockResolvedValue(admin);
  });

  test('returns the subscription with the plan inlined by id', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ ...baseSubscription, plan: basePlan });

    const response = await request(app)
      .get('/api/v1/admin/subscriptions/sub-uuid')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(prismaMock.subscription.findUnique).toHaveBeenCalledWith({
      where: { id: 'sub-uuid' },
      include: { plan: true },
    });
    expect(response.body.id).toBe('sub-uuid');
    expect(response.body.plan.description).toBe('Monthly Pro Plan');
    expect(response.body.plan.amount).toBe('10000000');
    expect(response.body.plan.interval).toBe(2_592_000);
  });

  test('returns 404 for an unknown id', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/v1/admin/subscriptions/nope')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Subscription not found');
  });
});

describe('GET /api/v1/admin/subscriptions/payments', () => {
  beforeEach(() => {
    mockReset(prismaMock);
    prismaMock.admin.findUnique.mockResolvedValue(admin);
  });

  test('returns 401 when unauthenticated', async () => {
    const response = await request(app).get('/api/v1/admin/subscriptions/payments');

    expect(response.status).toBe(401);
  });

  test('returns only SUBSCRIPTION_CHARGE transactions with default pagination', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([baseTransaction]);
    prismaMock.transaction.count.mockResolvedValue(1);

    const response = await request(app)
      .get('/api/v1/admin/subscriptions/payments')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination).toEqual({ limit: 20, offset: 0, total: 1 });
    expect(response.body.data[0].amount).toBe('10000000');
    expect(prismaMock.transaction.findMany).toHaveBeenCalledWith({
      where: { transactionType: 'SUBSCRIPTION_CHARGE' },
      take: 20,
      skip: 0,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    });
  });

  test('filters by merchantAddress via the transaction merchant relation', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([baseTransaction]);
    prismaMock.transaction.count.mockResolvedValue(1);

    const response = await request(app)
      .get('/api/v1/admin/subscriptions/payments')
      .query({ merchantAddress: 'GMERCHANT123' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(prismaMock.transaction.findMany).toHaveBeenCalledWith({
      where: {
        transactionType: 'SUBSCRIPTION_CHARGE',
        merchant: { address: 'GMERCHANT123' },
      },
      take: 20,
      skip: 0,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    });
  });

  test('filters by startDate and endDate on the charge date', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([baseTransaction]);
    prismaMock.transaction.count.mockResolvedValue(1);

    const response = await request(app)
      .get('/api/v1/admin/subscriptions/payments')
      .query({
        startDate: '2026-06-01T00:00:00.000Z',
        endDate: '2026-06-30T00:00:00.000Z',
      })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(prismaMock.transaction.findMany).toHaveBeenCalledWith({
      where: {
        transactionType: 'SUBSCRIPTION_CHARGE',
        date: {
          gte: new Date('2026-06-01T00:00:00.000Z'),
          lte: new Date('2026-06-30T00:00:00.000Z'),
        },
      },
      take: 20,
      skip: 0,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    });
  });

  test('returns 400 for an invalid startDate', async () => {
    const response = await request(app)
      .get('/api/v1/admin/subscriptions/payments?startDate=not-a-date')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(response.body.errors).toHaveProperty('startDate');
  });

  test('rejects a nonexistent calendar date that would otherwise normalize', async () => {
    const response = await request(app)
      .get('/api/v1/admin/subscriptions/payments?startDate=2026-02-30')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(response.body.errors).toHaveProperty('startDate');
  });

  test('returns 500 when the charge query fails', async () => {
    prismaMock.transaction.findMany.mockRejectedValue(new Error('db down'));

    const response = await request(app)
      .get('/api/v1/admin/subscriptions/payments')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Internal Server Error');
  });
});