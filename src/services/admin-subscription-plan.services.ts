import type { Prisma, SubscriptionPlan } from '@prisma/client';
import prisma from '../config/prisma.js';
import { AppError } from '../utils/errors.js';
import type {
  AdminSubscriptionPlanListFilters,
  AdminSubscriptionPlanListPagination,
  PlanListSortBy,
  PlanListSortDir,
} from '../utils/admin-subscription-plan.validation.js';

export const sanitizeSubscriptionPlan = (plan: SubscriptionPlan) => ({
  id: plan.id,
  planId: plan.planId,
  merchantId: plan.merchantId,
  description: plan.description,
  token: plan.token,
  amount: plan.amount.toString(),
  interval: plan.interval,
  active: plan.active,
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
});

export const sanitizeSubscriptionPlanWithCount = (
  plan: SubscriptionPlan,
  subscriberCount: number,
) => ({
  ...sanitizeSubscriptionPlan(plan),
  subscriberCount,
});

export const listSubscriptionPlans = async (
  filters: AdminSubscriptionPlanListFilters,
  pagination: AdminSubscriptionPlanListPagination,
  sortBy: PlanListSortBy,
  sortDir: PlanListSortDir,
) => {
  const where: Prisma.SubscriptionPlanWhereInput = {};

  if (filters.token) {
    where.token = filters.token;
  }

  if (filters.active !== undefined) {
    where.active = filters.active;
  }

  if (filters.merchantAddress) {
    const merchant = await prisma.merchant.findUnique({
      where: { address: filters.merchantAddress },
      select: { id: true },
    });
    if (!merchant) {
      return { data: [], pagination: { ...pagination, total: 0 } };
    }
    where.merchantId = merchant.id;
  }

  const orderBy: Prisma.SubscriptionPlanOrderByWithRelationInput[] = [
    { [sortBy]: sortDir },
    { id: 'desc' },
  ];

  const [plans, total] = await Promise.all([
    prisma.subscriptionPlan.findMany({
      where,
      take: pagination.limit,
      skip: pagination.offset,
      orderBy,
    }),
    prisma.subscriptionPlan.count({ where }),
  ]);

  return {
    data: plans.map(sanitizeSubscriptionPlan),
    pagination: {
      limit: pagination.limit,
      offset: pagination.offset,
      total,
    },
  };
};

export const getSubscriptionPlan = async (id: string) => {
  const plan = await prisma.subscriptionPlan.findUnique({
    where: { id },
  });

  if (!plan) {
    throw new AppError(404, 'Subscription plan not found');
  }

  const subscriberCount = await prisma.subscription.count({
    where: { planId: id, status: 'ACTIVE' },
  });

  return sanitizeSubscriptionPlanWithCount(plan, subscriberCount);
};
