import { beforeEach, describe, expect, test } from '@jest/globals';
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

const baseInvoice = {
  id: 'invoice-uuid-1',
  invoiceId: 101,
  paymentSlug: 'slug-101',
  description: 'Pro Subscription Invoice',
  amount: BigInt(50_000_000),
  amountPaid: BigInt(0),
  amountRefunded: BigInt(0),
  token: 'CDSTOKEN...',
  merchantId: 'merchant-uuid-1',
  payer: 'GPAYER123',
  email: 'payer@example.com',
  status: 'PENDING',
  pricingMode: 'FIXED_CRYPTO',
  fiatCurrency: null,
  fiatAmount: null,
  fiatDecimals: null,
  expiresAt: null,
  datePaid: null,
  createdAt: mockDate,
  updatedAt: mockDate,
};

describe('Admin Invoice Routes', () => {
  beforeEach(() => {
    mockReset(prismaMock);
    prismaMock.admin.findUnique.mockResolvedValue(admin);
  });

  describe('GET /api/v1/admin/invoices', () => {
    test('returns 401 when unauthenticated', async () => {
      const response = await request(app).get('/api/v1/admin/invoices');

      expect(response.status).toBe(401);
      expect(prismaMock.invoice.findMany).not.toHaveBeenCalled();
    });

    test('lists invoices newest-first by default with default pagination', async () => {
      prismaMock.invoice.findMany.mockResolvedValue([baseInvoice]);
      prismaMock.invoice.count.mockResolvedValue(1);

      const response = await request(app)
        .get('/api/v1/admin/invoices')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toEqual({
        id: baseInvoice.id,
        paymentSlug: baseInvoice.paymentSlug,
        description: baseInvoice.description,
        amount: '50000000',
        token: baseInvoice.token,
        status: baseInvoice.status,
        merchantId: baseInvoice.merchantId,
        email: baseInvoice.email,
        expiresAt: null,
        datePaid: null,
        createdAt: mockDate.toISOString(),
        updatedAt: mockDate.toISOString(),
      });
      expect(response.body.pagination).toEqual({ limit: 20, offset: 0, total: 1 });
      expect(prismaMock.invoice.findMany).toHaveBeenCalledWith({
        where: {},
        take: 20,
        skip: 0,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
    });

    test('filters correctly by status', async () => {
      prismaMock.invoice.findMany.mockResolvedValue([baseInvoice]);
      prismaMock.invoice.count.mockResolvedValue(1);

      const response = await request(app)
        .get('/api/v1/admin/invoices?status=PAID')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(prismaMock.invoice.findMany).toHaveBeenCalledWith({
        where: { status: 'PAID' },
        take: 20,
        skip: 0,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
    });

    test('filters correctly by merchantAddress', async () => {
      prismaMock.invoice.findMany.mockResolvedValue([baseInvoice]);
      prismaMock.invoice.count.mockResolvedValue(1);

      const response = await request(app)
        .get('/api/v1/admin/invoices?merchantAddress=GMERCHANT123')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(prismaMock.invoice.findMany).toHaveBeenCalledWith({
        where: { merchant: { address: 'GMERCHANT123' } },
        take: 20,
        skip: 0,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
    });

    test('filters correctly by both status and merchantAddress combined', async () => {
      prismaMock.invoice.findMany.mockResolvedValue([baseInvoice]);
      prismaMock.invoice.count.mockResolvedValue(1);

      const response = await request(app)
        .get('/api/v1/admin/invoices?status=pending&merchantAddress=GMERCHANT123&limit=10&offset=5')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(prismaMock.invoice.findMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          merchant: { address: 'GMERCHANT123' },
        },
        take: 10,
        skip: 5,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      expect(response.body.pagination).toEqual({ limit: 10, offset: 5, total: 1 });
    });

    test('returns 400 when validation fails for query params', async () => {
      const response = await request(app)
        .get('/api/v1/admin/invoices?status=INVALID&limit=-1&offset=-5')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.errors.status).toBeDefined();
      expect(response.body.errors.limit).toBeDefined();
      expect(response.body.errors.offset).toBeDefined();
      expect(prismaMock.invoice.findMany).not.toHaveBeenCalled();
    });

    test('handles database errors with 500 status', async () => {
      prismaMock.invoice.findMany.mockRejectedValue(new Error('DB failure'));

      const response = await request(app)
        .get('/api/v1/admin/invoices')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  describe('GET /api/v1/admin/invoices/:id', () => {
    test('returns 401 when unauthenticated', async () => {
      const response = await request(app).get('/api/v1/admin/invoices/invoice-uuid-1');

      expect(response.status).toBe(401);
      expect(prismaMock.invoice.findUnique).not.toHaveBeenCalled();
    });

    test('returns full invoice detail regardless of merchant ownership', async () => {
      prismaMock.invoice.findUnique.mockResolvedValue(baseInvoice);

      const response = await request(app)
        .get('/api/v1/admin/invoices/invoice-uuid-1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: baseInvoice.id,
        paymentSlug: baseInvoice.paymentSlug,
        description: baseInvoice.description,
        amount: '50000000',
        token: baseInvoice.token,
        status: baseInvoice.status,
        merchantId: baseInvoice.merchantId,
        email: baseInvoice.email,
        expiresAt: null,
        datePaid: null,
        createdAt: mockDate.toISOString(),
        updatedAt: mockDate.toISOString(),
      });
      expect(prismaMock.invoice.findUnique).toHaveBeenCalledWith({
        where: { id: 'invoice-uuid-1' },
      });
    });

    test('returns 404 when invoice does not exist', async () => {
      prismaMock.invoice.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/admin/invoices/missing-id')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Invoice not found');
    });

    test('handles database errors with 500 status', async () => {
      prismaMock.invoice.findUnique.mockRejectedValue(new Error('DB connection failure'));

      const response = await request(app)
        .get('/api/v1/admin/invoices/invoice-uuid-1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });
});
