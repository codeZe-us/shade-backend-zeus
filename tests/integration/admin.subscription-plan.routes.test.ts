
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

describe('GET /api/v1/admin/subscription-plans', () => {
  beforeEach(() => {
    mockReset(prismaMock);
    prismaMock.admin.findUnique.mockResolvedValue(admin);
  });

  test('returns 401 when unauthenticated', async () => {
    const response = await request(app).get('/api/v1/admin/subscription-plans');

    expect(response.status).toBe(401);
  });

  test('lists subscription plans newest-first by default with default pagination', async () => {
    prismaMock.subscriptionPlan.findMany.mockResolvedValue([basePlan]);
    prismaMock.subscriptionPlan.count.mockResolvedValue(1);

    const response = await request(app)
      .get('/api/v1/admin/subscription-plans')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination).toEqual({ limit: 20, offset: 0, total: 1 });
    expect(prismaMock.subscriptionPlan.findMany).toHaveBeenCalledWith({
      where: {},
      take: 20,
      skip: 0,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  });

  test('applies token, active filters and pagination', async () => {
    prismaMock.subscriptionPlan.findMany.mockResolvedValue([basePlan]);
    prismaMock.subscriptionPlan.count.mockResolvedValue(1);

    const response = await request(app)
      .get('/api/v1/admin/subscription-plans')
      .query({ token: 'CABC...TOKEN', active: 'true', limit: 5, offset: 10 })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(prismaMock.subscriptionPlan.findMany).toHaveBeenCalledWith({
      where: {
        token: 'CABC...TOKEN',
        active: true,
      },
      take: 5,
      skip: 10,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  });

  test('resolves merchantAddress to a merchant id and filters by merchantId', async () => {
    prismaMock.merchant.findUnique.mockResolvedValue({ id: 'merchant-uuid' });
    prismaMock.subscriptionPlan.findMany.mockResolvedValue([basePlan]);
    prismaMock.subscriptionPlan.count.mockResolvedValue(1);

    const response = await request(app)
      .get('/api/v1/admin/subscription-plans')
      .query({ merchantAddress: 'GMERCHANT123' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(prismaMock.merchant.findUnique).toHaveBeenCalledWith({
      where: { address: 'GMERCHANT123' },
      select: { id: true },
    });
    expect(prismaMock.subscriptionPlan.findMany).toHaveBeenCalledWith({
      where: { merchantId: 'merchant-uuid' },
      take: 20,
      skip: 0,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  });

  test('returns an empty page when merchantAddress has no matching merchant', async () => {
    prismaMock.merchant.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/v1/admin/subscription-plans')
      .query({ merchantAddress: 'GUNKNOWN123' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [],
      pagination: { limit: 20, offset: 0, total: 0 },
    });
    expect(prismaMock.subscriptionPlan.findMany).not.toHaveBeenCalled();
  });

  test('applies sortBy and sortDir', async () => {
    prismaMock.subscriptionPlan.findMany.mockResolvedValue([basePlan]);
    prismaMock.subscriptionPlan.count.mockResolvedValue(1);

    const response = await request(app)
      .get('/api/v1/admin/subscription-plans')
      .query({ sortBy: 'amount', sortDir: 'asc' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(prismaMock.subscriptionPlan.findMany).toHaveBeenCalledWith({
      where: {},
      take: 20,
      skip: 0,
      orderBy: [{ amount: 'asc' }, { id: 'desc' }],
    });
  });

  test('serializes plan amount as a string', async () => {
    prismaMock.subscriptionPlan.findMany.mockResolvedValue([basePlan]);
    prismaMock.subscriptionPlan.count.mockResolvedValue(1);

    const response = await request(app)
      .get('/api/v1/admin/subscription-plans')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data[0].amount).toBe('10000000');
  });

  test('returns 400 for invalid active filter', async () => {
    const response = await request(app)
      .get('/api/v1/admin/subscription-plans?active=invalid')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(response.body.errors).toHaveProperty('active');
  });

  test('returns 400 for invalid sortBy and sortDir', async () => {
    const response = await request(app)
      .get('/api/v1/admin/subscription-plans?sortBy=invalid&sortDir=sideways')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(response.body.errors).toHaveProperty('sortBy');
    expect(response.body.errors).toHaveProperty('sortDir');
  });
});

describe('GET /api/v1/admin/subscription-plans/:id', () => {
  beforeEach(() => {
    mockReset(prismaMock);
    prismaMock.admin.findUnique.mockResolvedValue(admin);
  });

  test('returns the subscription plan with subscriberCount', async () => {
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue(basePlan);
    prismaMock.subscription.count.mockResolvedValue(5);

    const response = await request(app)
      .get('/api/v1/admin/subscription-plans/plan-uuid')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(prismaMock.subscriptionPlan.findUnique).toHaveBeenCalledWith({
      where: { id: 'plan-uuid' },
    });
    expect(prismaMock.subscription.count).toHaveBeenCalledWith({
      where: { planId: 'plan-uuid', status: 'ACTIVE' },
    });
    expect(response.body.id).toBe('plan-uuid');
    expect(response.body.amount).toBe('10000000');
    expect(response.body.subscriberCount).toBe(5);
  });

  test('returns 404 for an unknown id', async () => {
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/v1/admin/subscription-plans/nope')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Subscription plan not found');
  });
});
