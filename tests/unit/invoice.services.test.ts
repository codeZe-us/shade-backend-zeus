import { jest } from '@jest/globals';
import { mockReset } from 'jest-mock-extended';

const { default: prismaMock } = (await import('../../src/config/prisma.js')) as any;
const {
  createInvoice,
  listInvoices,
  listAdminInvoices,
  getInvoice,
  getAdminInvoice,
  voidInvoice,
  amendInvoice,
  applyInvoicePayment,
} = await import('../../src/services/invoice.services.js');

const MERCHANT_ID = 'merchant-1';

const baseInvoice = {
  id: 'invoice-1',
  invoiceId: null,
  paymentSlug: 'slug-1',
  description: 'Website design',
  amount: 5000n,
  amountPaid: 0n,
  token: 'USDC',
  merchantId: MERCHANT_ID,
  status: 'PENDING',
  ref: null,
  payer: null,
  payerEmail: null,
  email: null,
  expiresAt: null,
  datePaid: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('invoice services', () => {
  beforeEach(() => {
    mockReset(prismaMock);
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
  });

  describe('createInvoice', () => {
    test('creates a PENDING invoice with a generated url-safe slug', async () => {
      prismaMock.invoice.create.mockImplementation(async (args: any) => ({
        ...baseInvoice,
        ...args.data,
      }));

      const result = await createInvoice(MERCHANT_ID, {
        description: 'Website design',
        amount: '5000',
        token: 'USDC',
      });

      expect(result.status).toBe('PENDING');
      expect(result.amount).toBe('5000');
      expect(typeof result.paymentSlug).toBe('string');
      expect(result.paymentSlug).toMatch(/^[A-Za-z0-9_-]+$/);

      const createArgs = prismaMock.invoice.create.mock.calls[0][0];
      expect(createArgs.data.amount).toBe(5000n);
      expect(createArgs.data.merchantId).toBe(MERCHANT_ID);
    });

    test('creates a DRAFT invoice when isDraft is true', async () => {
      prismaMock.invoice.create.mockImplementation(async (args: any) => ({
        ...baseInvoice,
        ...args.data,
      }));

      const result = await createInvoice(MERCHANT_ID, {
        description: 'Draft job',
        amount: 100,
        token: 'XLM',
        isDraft: true,
      });

      expect(result.status).toBe('DRAFT');
    });

    test('rejects a non-positive amount with a 400', async () => {
      await expect(
        createInvoice(MERCHANT_ID, { description: 'x', amount: 0, token: 'USDC' }),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.invoice.create).not.toHaveBeenCalled();
    });
  });

  describe('listInvoices', () => {
    test('scopes results to the merchant and returns pagination metadata', async () => {
      prismaMock.invoice.findMany.mockResolvedValue([baseInvoice] as any);
      prismaMock.invoice.count.mockResolvedValue(1 as any);

      const result = await listInvoices(
        MERCHANT_ID,
        { status: 'PENDING' as any },
        { limit: 20, offset: 0 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].amount).toBe('5000');
      expect(result.pagination).toEqual({ limit: 20, offset: 0, total: 1 });

      const findArgs = prismaMock.invoice.findMany.mock.calls[0][0];
      expect(findArgs.where).toMatchObject({ merchantId: MERCHANT_ID, status: 'PENDING' });
      expect(findArgs.take).toBe(20);
      expect(findArgs.skip).toBe(0);
    });
  });

  describe('getInvoice', () => {
    test('returns the invoice when it belongs to the merchant', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(baseInvoice as any);

      const result = await getInvoice(MERCHANT_ID, 'invoice-1');

      expect(result.id).toBe('invoice-1');
      expect(prismaMock.invoice.findFirst).toHaveBeenCalledWith({
        where: { id: 'invoice-1', merchantId: MERCHANT_ID },
      });
    });

    test('throws 404 when the invoice is missing or owned by another merchant', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(null);

      await expect(getInvoice(MERCHANT_ID, 'missing')).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('listAdminInvoices', () => {
    test('lists invoices across all merchants with status and merchantAddress filters', async () => {
      prismaMock.invoice.findMany.mockResolvedValue([baseInvoice] as any);
      prismaMock.invoice.count.mockResolvedValue(1 as any);

      const result = await listAdminInvoices(
        { status: 'PENDING' as any, merchantAddress: '0x123' },
        { limit: 10, offset: 5 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].amount).toBe('5000');
      expect(result.pagination).toEqual({ limit: 10, offset: 5, total: 1 });

      expect(prismaMock.invoice.findMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          merchant: { address: '0x123' },
        },
        take: 10,
        skip: 5,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
    });
  });

  describe('getAdminInvoice', () => {
    test('returns invoice regardless of merchantId', async () => {
      prismaMock.invoice.findUnique.mockResolvedValue(baseInvoice as any);

      const result = await getAdminInvoice('invoice-1');

      expect(result.id).toBe('invoice-1');
      expect(prismaMock.invoice.findUnique).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
      });
    });

    test('throws 404 when invoice does not exist', async () => {
      prismaMock.invoice.findUnique.mockResolvedValue(null);

      await expect(getAdminInvoice('missing')).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('amendInvoice', () => {
    test('updates only the provided fields on a PENDING invoice', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(baseInvoice as any);
      prismaMock.invoice.update.mockResolvedValue({
        ...baseInvoice,
        email: 'payer@example.com',
        amount: 2000n,
        description: 'Updated website design',
      } as any);

      const result = await amendInvoice(MERCHANT_ID, 'invoice-1', {
        email: 'payer@example.com',
        amount: '2000',
        description: 'Updated website design',
      });

      expect(result.email).toBe('payer@example.com');
      expect(result.amount).toBe('2000');
      expect(result.description).toBe('Updated website design');
      expect(prismaMock.invoice.update).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
        data: {
          email: 'payer@example.com',
          amount: 2000n,
          description: 'Updated website design',
        },
      });
    });

    test('rejects a non-positive amount with a 400', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(baseInvoice as any);

      await expect(amendInvoice(MERCHANT_ID, 'invoice-1', { amount: '0' })).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(prismaMock.invoice.update).not.toHaveBeenCalled();
    });

    test('rejects descriptions over the 100-character limit', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(baseInvoice as any);

      await expect(
        amendInvoice(MERCHANT_ID, 'invoice-1', {
          description: 'x'.repeat(101),
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.invoice.update).not.toHaveBeenCalled();
    });
  });

  describe('voidInvoice', () => {
    test('voids a PENDING invoice and sets status CANCELLED', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(baseInvoice as any);
      prismaMock.invoice.update.mockResolvedValue({
        ...baseInvoice,
        status: 'CANCELLED',
      } as any);

      const result = await voidInvoice(MERCHANT_ID, 'invoice-1');

      expect(result.status).toBe('CANCELLED');
      expect(prismaMock.invoice.update).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
        data: { status: 'CANCELLED' },
      });
    });

    test('throws 400 when voiding a non-PENDING invoice', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue({
        ...baseInvoice,
        status: 'PAID',
      } as any);

      await expect(voidInvoice(MERCHANT_ID, 'invoice-1')).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(prismaMock.invoice.update).not.toHaveBeenCalled();
    });

    test('throws 404 when the invoice does not belong to the merchant', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(null);

      await expect(voidInvoice(MERCHANT_ID, 'invoice-1')).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('applyInvoicePayment', () => {
    const paymentEvent = {
      invoiceId: 101,
      merchantId: 7,
      payer: 'GPAyerAddress',
      amount: 2000n,
      fee: 20n,
      merchantAmount: 1980n,
      token: 'USDC',
      timestamp: 1_700_000_000,
    };

    const merchant = { id: MERCHANT_ID, merchantId: paymentEvent.merchantId };

    test('marks a partially paid invoice, records the amount, and creates its transaction', async () => {
      prismaMock.invoice.findUnique.mockResolvedValue({
        ...baseInvoice,
        invoiceId: paymentEvent.invoiceId,
      } as any);
      prismaMock.invoice.findUniqueOrThrow.mockResolvedValue({
        ...baseInvoice,
        invoiceId: paymentEvent.invoiceId,
      } as any);
      prismaMock.merchant.findUnique.mockResolvedValue(merchant as any);
      prismaMock.invoice.update.mockImplementation(async (args: any) => ({
        ...baseInvoice,
        ...args.data,
      }));
      prismaMock.transaction.create.mockResolvedValue({ id: 'transaction-1' } as any);

      await applyInvoicePayment(paymentEvent, 'tx-partial');

      expect(prismaMock.invoice.findUnique).toHaveBeenCalledWith({
        where: { invoiceId: paymentEvent.invoiceId },
      });
      expect(prismaMock.merchant.findUnique).toHaveBeenCalledWith({
        where: { merchantId: paymentEvent.merchantId },
      });
      expect(prismaMock.invoice.update).toHaveBeenCalledWith({
        where: { id: baseInvoice.id },
        data: {
          status: 'PARTIALLY_PAID',
          payer: paymentEvent.payer,
          amountPaid: 2000n,
          datePaid: null,
        },
      });
      expect(prismaMock.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          transactionType: 'INVOICE_PAYMENT',
          refId: paymentEvent.invoiceId,
          amount: paymentEvent.amount,
          token: paymentEvent.token,
          merchantId: MERCHANT_ID,
          date: new Date(paymentEvent.timestamp * 1000),
        }),
      });
      expect(prismaMock.adminLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'invoice.paid',
          actorType: 'ANONYMOUS',
          actorId: null,
          actorLabel: paymentEvent.payer,
          targetType: 'Invoice',
          targetId: baseInvoice.id,
        }),
      });
    });

    test('marks the invoice PAID and sets datePaid when the payment completes it', async () => {
      prismaMock.invoice.findUnique.mockResolvedValue({
        ...baseInvoice,
        invoiceId: paymentEvent.invoiceId,
      } as any);
      prismaMock.invoice.findUniqueOrThrow.mockResolvedValue({
        ...baseInvoice,
        id: 'transaction-invoice-id',
        invoiceId: paymentEvent.invoiceId,
        amountPaid: 3500n,
      } as any);
      prismaMock.merchant.findUnique.mockResolvedValue(merchant as any);
      prismaMock.invoice.update.mockResolvedValue({ ...baseInvoice, status: 'PAID' } as any);
      prismaMock.transaction.create.mockResolvedValue({ id: 'transaction-1' } as any);

      await applyInvoicePayment(paymentEvent, 'tx-complete');

      expect(prismaMock.invoice.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { invoiceId: paymentEvent.invoiceId },
      });
      expect(prismaMock.invoice.update).toHaveBeenCalledWith({
        where: { id: 'transaction-invoice-id' },
        data: {
          status: 'PAID',
          payer: paymentEvent.payer,
          amountPaid: 5500n,
          datePaid: new Date(paymentEvent.timestamp * 1000),
        },
      });
    });

    test('logs and skips an on-chain payment whose invoice is not in the database', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      prismaMock.invoice.findUnique.mockResolvedValue(null);

      await expect(applyInvoicePayment(paymentEvent, 'tx-missing')).resolves.toBeNull();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('invoice is not in the database'));
      expect(prismaMock.merchant.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.adminLog.create).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
