import type { Invoice, InvoiceStatus as PrismaInvoiceStatus, Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { AppError } from '../utils/errors.js';
import { generatePaymentSlug } from '../utils/slug.js';
import {
  AdminInvoiceListFilters,
  CreateInvoiceInput,
  InvoiceListFilters,
  InvoicePagination,
  parseAmount,
} from '../utils/invoice.validation.js';
import type {
  InvoiceCreatedEventData,
  InvoicePaidEventData,
  InvoicePartiallyRefundedEventData,
  InvoiceRefundedEventData,
} from '../indexer/types.js';
import type { OnChainInvoiceDetails } from '../indexer/contractReader.js';
import { recordDailyStats, recordVolumeEvent } from './analytics.services.js';
import { recordAuditLog, ActorType } from './audit-log.services.js';

const SLUG_MAX_RETRIES = 5;
const INVOICE_DESCRIPTION_MAX_LENGTH = 100;

// String constants matching the Prisma `Status` enum. Defined locally so this
// module never imports a runtime value from `@prisma/client` (the generated
// client is mocked in tests and not generated in CI).
const InvoiceStatus = {
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  PAID: 'PAID',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const satisfies Record<string, PrismaInvoiceStatus>;

const TransactionType = {
  INVOICE_PAYMENT: 'INVOICE_PAYMENT',
} as const;

/**
 * Public-facing view of an invoice. `amount` is serialized to a string because
 * `BigInt` is not JSON-serializable.
 */
export interface AmendInvoiceInput {
  email?: string | null;
  amount?: string | number;
  description?: string;
}

export const sanitizeInvoice = (invoice: Invoice) => ({
  id: invoice.id,
  paymentSlug: invoice.paymentSlug,
  description: invoice.description,
  amount: invoice.amount.toString(),
  token: invoice.token,
  status: invoice.status,
  merchantId: invoice.merchantId,
  email: invoice.email,
  expiresAt: invoice.expiresAt,
  datePaid: invoice.datePaid,
  createdAt: invoice.createdAt,
  updatedAt: invoice.updatedAt,
});

const isUniqueSlugError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const { code, meta } = error as { code?: string; meta?: { target?: unknown } };
  return code === 'P2002' && Array.isArray(meta?.target) && meta.target.includes('paymentSlug');
};

/**
 * Creates an invoice, retrying on the (vanishingly unlikely) event that the
 * generated payment slug collides with an existing one. `client` is either the
 * root Prisma client or an interactive-transaction client.
 */
const createInvoiceWithUniqueSlug = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  data: Omit<Prisma.InvoiceUncheckedCreateInput, 'paymentSlug'>,
): Promise<Invoice> => {
  for (let attempt = 0; attempt < SLUG_MAX_RETRIES; attempt++) {
    try {
      return await client.invoice.create({
        data: { ...data, paymentSlug: generatePaymentSlug() },
      });
    } catch (error) {
      if (isUniqueSlugError(error) && attempt < SLUG_MAX_RETRIES - 1) {
        continue;
      }
      throw error;
    }
  }

  throw new AppError(500, 'Failed to generate a unique payment slug');
};

export const createInvoice = async (merchantId: string, data: CreateInvoiceInput) => {
  const amount = parseAmount(data.amount);
  if (amount === null) {
    throw new AppError(400, 'amount must be a positive integer');
  }

  const status: PrismaInvoiceStatus = data.isDraft ? InvoiceStatus.DRAFT : InvoiceStatus.PENDING;
  const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;

  const invoice = await createInvoiceWithUniqueSlug(prisma, {
    merchantId,
    description: data.description.trim(),
    amount,
    token: data.token.trim(),
    email: data.payerEmail?.trim() ?? null,
    expiresAt,
    status,
  });

  return sanitizeInvoice(invoice);
};

export const listInvoices = async (
  merchantId: string,
  filters: InvoiceListFilters,
  pagination: InvoicePagination,
) => {
  const where: Prisma.InvoiceWhereInput = { merchantId };

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.token) {
    where.token = filters.token;
  }

  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) where.createdAt.gte = filters.startDate;
    if (filters.endDate) where.createdAt.lte = filters.endDate;
  }

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      take: pagination.limit,
      skip: pagination.offset,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.invoice.count({ where }),
  ]);

  return {
    data: invoices.map(sanitizeInvoice),
    pagination: {
      limit: pagination.limit,
      offset: pagination.offset,
      total,
    },
  };
};

export const getInvoice = async (merchantId: string, id: string) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id, merchantId },
  });

  if (!invoice) {
    throw new AppError(404, 'Invoice not found');
  }

  return sanitizeInvoice(invoice);
};

export const listAdminInvoices = async (
  filters: AdminInvoiceListFilters,
  pagination: InvoicePagination,
) => {
  const where: Prisma.InvoiceWhereInput = {};

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.merchantAddress) {
    where.merchant = { address: filters.merchantAddress };
  }

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      take: pagination.limit,
      skip: pagination.offset,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
    prisma.invoice.count({ where }),
  ]);

  return {
    data: invoices.map(sanitizeInvoice),
    pagination: {
      limit: pagination.limit,
      offset: pagination.offset,
      total,
    },
  };
};

export const getAdminInvoice = async (id: string) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
  });

  if (!invoice) {
    throw new AppError(404, 'Invoice not found');
  }

  return sanitizeInvoice(invoice);
};

/**
 * Fetches the raw invoice + merchant records, scoped to the owning merchant,
 * for the PDF/email flows that need fields beyond the sanitized public view
 * (payer address, fiat breakdown, merchant logo).
 */
export const getInvoiceWithMerchant = async (merchantId: string, id: string) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id, merchantId },
    include: { merchant: true },
  });

  if (!invoice) {
    throw new AppError(404, 'Invoice not found');
  }

  return invoice;
};

export const amendInvoice = async (merchantId: string, id: string, data: AmendInvoiceInput) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id, merchantId },
  });

  if (!invoice) {
    throw new AppError(404, 'Invoice not found');
  }

  if (invoice.status !== InvoiceStatus.PENDING) {
    throw new AppError(400, 'Only pending invoices can be amended');
  }

  const updateData: Prisma.InvoiceUpdateInput = {};

  if (data.email !== undefined) {
    updateData.email = data.email === null ? null : data.email.trim();
  }

  if (data.amount !== undefined) {
    const amount = parseAmount(data.amount);
    if (amount === null) {
      throw new AppError(400, 'amount must be a positive integer');
    }
    updateData.amount = amount;
  }

  if (data.description !== undefined) {
    const description =
      typeof data.description === 'string' ? data.description.trim() : data.description;
    if (typeof description !== 'string') {
      throw new AppError(400, 'description must be a string');
    }
    if (description.length > INVOICE_DESCRIPTION_MAX_LENGTH) {
      throw new AppError(400, 'description exceeds the maximum length of 100 characters');
    }
    updateData.description = description;
  }

  if (Object.keys(updateData).length === 0) {
    return sanitizeInvoice(invoice);
  }

  // This endpoint updates the DB record only. On-chain amend_invoice reconciliation is intentionally out of scope.
  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: updateData,
  });

  return sanitizeInvoice(updated);
};

export const voidInvoice = async (merchantId: string, id: string) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id, merchantId },
  });

  if (!invoice) {
    throw new AppError(404, 'Invoice not found');
  }

  if (invoice.status !== InvoiceStatus.PENDING) {
    throw new AppError(400, 'Only pending invoices can be voided');
  }

  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: InvoiceStatus.CANCELLED },
  });

  return sanitizeInvoice(updated);
};

/**
 * Applies an on-chain `InvoiceCreatedEvent` to the backend projection.
 *
 * ---------------------------------------------------------------------------
 * WARNING: the correlation performed here is a best-effort heuristic, not a
 * guaranteed-correct match. It is not a solved problem yet.
 * ---------------------------------------------------------------------------
 *
 * Invoices in this backend are created off-chain first: POST /invoices writes
 * an Invoice row with `invoiceId: null` before anything touches the chain, and
 * nothing in this codebase currently submits `create_invoice` /
 * `create_invoice_signed` on a merchant's behalf. So there is no established
 * link between an off-chain row and the on-chain invoice id, and two different
 * futures are both still open:
 *
 *   1. A relay path where this backend submits `create_invoice_signed` at the
 *      moment POST /invoices is called and captures `invoice_id` synchronously
 *      from the transaction result. If that lands, this function becomes a
 *      backup/reconciliation path rather than the primary way `invoiceId` gets
 *      set — and it already tolerates that: an invoice whose `invoiceId` the
 *      relay already filled in is left alone.
 *   2. Invoices that originate entirely on-chain, from a merchant's own SDK
 *      integration calling `create_invoice` directly and bypassing our API. For
 *      those this handler is the only way the backend ever learns the invoice
 *      exists, so an unmatched event creates a row rather than being dropped.
 *
 * The clean fix is correlation by nonce: `create_invoice_signed` already takes
 * a `nonce: BytesN<32>` for replay protection, and a future relay issue could
 * set that nonce to the off-chain `Invoice.id` before submitting, turning this
 * guesswork into an exact lookup. That depends on the relay existing first, so
 * it is deliberately not implemented here.
 *
 * Until then the match is: an unlinked (`invoiceId: null`) invoice for the same
 * merchant, amount, token and description. `InvoiceCreatedEvent` does not carry
 * a description (verified against a live testnet event), so the description
 * comes from reading `get_invoice` back off the contract; when that read fails
 * the match falls back to merchant + amount + token alone, which is weaker, and
 * says so in the log. Candidates are restricted to DRAFT/PENDING because the
 * contract only emits this event for an invoice it has just put in `Pending` —
 * linking a cancelled, paid or refunded off-chain row would be wrong.
 *
 * More than one candidate is ambiguous. Rather than guess, it logs loudly and
 * creates a separate row, so the duplicate is visible and repairable instead of
 * silently attached to the wrong invoice.
 *
 * The IndexerEvent table remains the only replay guard; the `invoiceId` lookup
 * below is a natural-key existence check that makes "link or create" work, not
 * a second idempotency mechanism.
 */
export const applyInvoiceCreated = async (
  event: InvoiceCreatedEventData,
  txHash: string,
  occurredAt: Date,
  /**
   * What `get_invoice` returned for this invoice, or null if the contract could
   * not be read. Passed in by the handler rather than fetched here so the RPC
   * round-trip stays at the indexer edge and this service remains pure
   * persistence — see ../indexer/handlers/invoiceCreated.ts.
   */
  onChain: OnChainInvoiceDetails | null,
) => {
  // The event carries the merchant's Address, not the numeric merchant_id
  // (verified against a live testnet event), so it resolves via Merchant.address.
  const merchant = await prisma.merchant.findUnique({
    where: { address: event.merchant },
  });

  const description = onChain?.description ?? null;

  const outcome = await prisma.$transaction(async (tx: any) => {
    // The protocol-wide "new invoices today" counter is driven by the event
    // itself, not by whether a row could be linked or created, so growth
    // reporting is unchanged from when this event only recorded daily stats.
    await recordDailyStats(tx, occurredAt, { newInvoices: 1 });

    if (!merchant) {
      console.warn(
        `InvoiceCreated event for invoice ${event.invoiceId} (${txHash}) not applied: merchant ${event.merchant} is not in the database.`,
      );
      return null;
    }

    const alreadyLinked = await tx.invoice.findUnique({
      where: { invoiceId: event.invoiceId },
    });
    if (alreadyLinked) {
      return { invoice: alreadyLinked as Invoice, outcome: 'already-linked' as const };
    }

    const candidates: Invoice[] = await tx.invoice.findMany({
      where: {
        merchantId: merchant.id,
        invoiceId: null,
        amount: event.amount,
        token: event.token,
        status: { in: [InvoiceStatus.DRAFT, InvoiceStatus.PENDING] },
        ...(description === null ? {} : { description }),
      },
    });

    if (candidates.length === 1) {
      const linked = await tx.invoice.update({
        where: { id: candidates[0].id },
        data: { invoiceId: event.invoiceId, status: InvoiceStatus.PENDING },
      });
      return { invoice: linked as Invoice, outcome: 'linked' as const };
    }

    if (candidates.length > 1) {
      console.error(
        `AMBIGUOUS InvoiceCreated correlation: on-chain invoice ${event.invoiceId} (${txHash}) matched ${candidates.length} unlinked invoices for merchant ${event.merchant} ` +
          `[${candidates.map(candidate => candidate.id).join(', ')}]. ` +
          'Refusing to guess; creating a separate invoice row instead. ' +
          'These rows need manual reconciliation, and correlation needs the nonce-based fix described on applyInvoiceCreated.',
      );
    } else if (description === null) {
      console.warn(
        `InvoiceCreated correlation for invoice ${event.invoiceId} (${txHash}) ran without an on-chain description; matched on merchant, amount and token only.`,
      );
    }

    const created = await createInvoiceWithUniqueSlug(tx, {
      invoiceId: event.invoiceId,
      merchantId: merchant.id,
      // The event has no description and the contract read did not produce one,
      // so this placeholder marks the row as needing reconciliation rather than
      // inventing a plausible-looking description.
      description: description ?? `On-chain invoice #${event.invoiceId}`,
      amount: event.amount,
      token: event.token,
      // The contract emits this event only for invoices it has just moved into
      // `Pending`; `create_invoice_draft` deliberately emits nothing.
      status: InvoiceStatus.PENDING,
      expiresAt: onChain?.expiresAt ?? null,
      // Backdated to the ledger close time so a historical replay does not
      // report every on-chain invoice as created on the day of the replay.
      createdAt: occurredAt,
    });

    return {
      invoice: created,
      outcome: (candidates.length > 1 ? 'created-ambiguous' : 'created') as
        | 'created'
        | 'created-ambiguous',
    };
  });

  if (!outcome || outcome.outcome === 'already-linked') {
    return outcome;
  }

  await recordAuditLog({
    action: 'invoice.created',
    actorType: ActorType.MERCHANT,
    actorId: merchant?.id,
    actorLabel: event.merchant,
    targetType: 'Invoice',
    targetId: outcome.invoice.id,
    metadata: {
      // Distinguishes this from the off-chain POST /invoices call site, which
      // records the same action.
      source: 'on-chain',
      correlation: outcome.outcome,
      invoiceId: event.invoiceId,
      amount: event.amount.toString(),
      token: event.token,
      txHash,
    },
  });

  return outcome;
};

/**
 * Applies a confirmed on-chain invoice payment to the backend projection.
 *
 * The indexer's IndexerEvent table is the only replay guard. Do not add an
 * event-level guard here: this service deliberately owns state mutation only.
 * Deposit-account payment detection is intentionally out of scope; it will be
 * handled by a dedicated indexer handler in a follow-up issue.
 */
export const applyInvoicePayment = async (event: InvoicePaidEventData, txHash: string) => {
  const invoice = await prisma.invoice.findUnique({
    where: { invoiceId: event.invoiceId },
  });

  if (!invoice) {
    console.warn(
      `InvoicePaid event for invoice ${event.invoiceId} (${txHash}) skipped: invoice is not in the database.`,
    );
    return null;
  }

  const merchant = await prisma.merchant.findUnique({
    where: { merchantId: event.merchantId },
  });

  if (!merchant) {
    console.warn(
      `InvoicePaid event for invoice ${event.invoiceId} (${txHash}) skipped: merchant ${event.merchantId} is not in the database.`,
    );
    return null;
  }

  if (invoice.merchantId !== merchant.id) {
    console.warn(
      `InvoicePaid event for invoice ${event.invoiceId} (${txHash}) skipped: invoice and event merchants do not match.`,
    );
    return null;
  }

  const paidAt = new Date(event.timestamp * 1000);
  const description = `Invoice #${event.invoiceId} payment${txHash ? ` (${txHash})` : ''}`;

  const result = await prisma.$transaction(async (tx: any) => {
    const transactionInvoice = await tx.invoice.findUniqueOrThrow({
      where: { invoiceId: event.invoiceId },
    });
    const amountPaid = transactionInvoice.amountPaid + event.amount;
    const status: PrismaInvoiceStatus =
      amountPaid >= transactionInvoice.amount ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;

    const updatedInvoice = await tx.invoice.update({
      where: { id: transactionInvoice.id },
      data: {
        status,
        payer: event.payer,
        amountPaid,
        datePaid: status === InvoiceStatus.PAID ? paidAt : null,
      },
    });

    const transaction = await tx.transaction.create({
      data: {
        transactionType: TransactionType.INVOICE_PAYMENT,
        refId: event.invoiceId,
        amount: event.amount,
        token: event.token,
        description,
        merchantId: merchant.id,
        date: paidAt,
      },
    });

    await recordVolumeEvent(tx, {
      merchantId: merchant.id,
      token: event.token,
      // The contract feeds its own analytics the gross amount and the fee taken
      // out of it, so the projection mirrors that rather than merchantAmount.
      volume: event.amount,
      fee: event.fee,
      occurredAt: paidAt,
    });

    return { invoice: updatedInvoice, transaction };
  });

  await recordAuditLog({
    action: 'invoice.paid',
    actorType: ActorType.ANONYMOUS,
    actorLabel: event.payer,
    targetType: 'Invoice',
    targetId: result.invoice.id,
    metadata: {
      amount: event.amount.toString(),
      fee: event.fee.toString(),
      merchantAmount: event.merchantAmount.toString(),
      token: event.token,
      txHash,
    },
  });

  return result;
};

const clampRefund = (reported: bigint, alreadyRefunded: bigint, invoiceAmount: bigint): bigint => {
  if (reported > invoiceAmount) return invoiceAmount;
  if (reported < alreadyRefunded) return alreadyRefunded;
  return reported;
};

/**
 * Applies a confirmed on-chain refund to the backend projection.
 *
 * Refunds deliberately do not touch MerchantAnalytics/TokenAnalytics/
 * PlatformDailyStats: the contract's `record_merchant_payment` is only reached
 * from the payment paths (invoice payment, subscription charge, ticket sale)
 * and never from `refund_invoice`/`refund_invoice_partial`, so on-chain
 * `total_volume` is not reduced by a refund. Refund totals are read back
 * separately from `Invoice.amountRefunded`.
 */
export const applyInvoiceRefund = async (
  event: InvoiceRefundedEventData | InvoicePartiallyRefundedEventData,
  txHash: string,
) => {
  const invoice = await prisma.invoice.findUnique({
    where: { invoiceId: event.invoiceId },
  });

  if (!invoice) {
    console.warn(
      `Refund event for invoice ${event.invoiceId} (${txHash}) skipped: invoice is not in the database.`,
    );
    return null;
  }

  return prisma.$transaction(async (tx: any) => {
    const current = await tx.invoice.findUniqueOrThrow({
      where: { invoiceId: event.invoiceId },
    });

    // Both refund events report an absolute total, never an increment: the
    // partial event carries `total_amount_refunded`, and the full event's
    // `amount` is the invoice's whole amount — `refund_invoice` and the
    // completing branch of `refund_invoice_partial` both pass `invoice.amount`,
    // not the chunk just refunded.
    const reportedRefund =
      'totalAmountRefunded' in event ? event.totalAmountRefunded : event.amount;

    // Clamped to the invoice total and never allowed to move backwards, so a
    // replayed or out-of-order refund event cannot skew the refund total that
    // /admin/analytics/summary reports.
    const amountRefunded = clampRefund(reportedRefund, current.amountRefunded, current.amount);

    const status: PrismaInvoiceStatus =
      amountRefunded >= current.amount ? InvoiceStatus.REFUNDED : InvoiceStatus.PARTIALLY_REFUNDED;

    return tx.invoice.update({
      where: { id: current.id },
      data: { amountRefunded, status },
    });
  });
};
