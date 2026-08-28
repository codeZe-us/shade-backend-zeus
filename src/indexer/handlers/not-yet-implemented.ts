/**
 * Audit-log catalog rows with no working call site yet.
 *
 * This file intentionally registers nothing with `registerEventHandler` — it
 * exists so the gap between the full audit-log Action Catalog and what this
 * backend actually implements is discoverable in review/grep, rather than
 * silently absent. `dispatch()` in ../registry.ts already logs "No handler
 * registered for topic X, skipping" for any of the on-chain topics below, so
 * there is no behavior change here, only documentation.
 *
 * None of these topic strings have been observed against a live deployment —
 * they are inferred from the naming convention that the handled events do
 * confirm (`#[contractevent] InvoicePaidEvent` -> topic "invoice_paid_event").
 * Do not build a decoder from this file alone; verify the actual event payload
 * shape against a real testnet event first. That check is not a formality: the
 * payload is routinely narrower than the struct it is named after —
 * `SubscriptionPlanCreatedEvent` omits the plan's `description`, and
 * `InvoiceCreatedEvent` omits both `description` and any timestamp.
 *
 * When wiring one of these for real: add a decoder to ../types.ts, a handler
 * to ../handlers/ (see invoicePaid.ts for the pattern), register it in
 * ../handlers/index.ts, and call recordAuditLog (../../services/audit-log.services.ts)
 * at the point of DB mutation — then delete that line from this file.
 *
 * ---- On-chain events: Governance & Config (no service/handler exists) ----
 * governance.admin_transfer_proposed / _accepted <- AdminTransferProposed / AdminTransferAccepted
 * governance.token_added / token_removed          <- TokenAdded / TokenRemoved
 * governance.fee_proposed / fee_set               <- FeeProposed / FeeSet
 * governance.platform_account_set                 <- PlatformAccountSet
 * governance.token_oracle_set                     <- TokenOracleSet
 * governance.account_wasm_hash_set                <- AccountWasmHashSet
 * governance.contract_paused / _unpaused           <- ContractPaused / ContractUnpaused
 * governance.contract_upgraded                     <- ContractUpgraded
 * governance.role_granted / role_revoked           <- RoleGranted / RoleRevoked
 *
 * ---- On-chain events: Merchant Lifecycle (beyond InvoicePaid) ----
 * merchant.registered (on-chain)     <- MerchantRegistered
 * merchant.account_deployed          <- MerchantAccountDeployed
 * merchant.status_changed            <- MerchantStatusChanged
 * merchant.verified                  <- MerchantVerified
 * merchant.webhook_set (on-chain)    <- MerchantWebhookSet (the off-chain webhook
 *                                        field set via PATCH /merchants/me is
 *                                        already covered by merchant.profile_updated)
 * merchant.key_set (on-chain)        <- MerchantKeySet
 * merchant.tokens_set / token_removed <- MerchantTokensSet / MerchantTokenRemoved
 * merchant.account_restricted        <- AccountRestricted
 *
 * ---- On-chain events: Invoice Lifecycle (beyond InvoicePaid) ----
 * invoice.payment_split_routed        <- PaymentSplitRouted
 * invoice.refunded / partially_refunded <- InvoiceRefunded / InvoicePartiallyRefunded
 * invoice.cancelled (on-chain)        <- InvoiceCancelled
 * invoice.amended (on-chain)          <- InvoiceAmended (the off-chain PATCH
 *                                        .../amend route is already covered by
 *                                        the real invoice.amended call site)
 * invoice.fiat_priced                 <- FiatInvoicePriced
 *
 * ---- On-chain events: Subscription Lifecycle ----
 * subscription_plan.deactivated <- PlanDeactivated
 * subscription.cancelled        <- SubscriptionCancelled
 * (subscription_plan.created, subscription.created and subscription.charged are
 *  implemented — see ../handlers/subscriptionPlanCreated.ts, ./subscribed.ts and
 *  ./subscriptionCharged.ts)
 *
 * ---- On-chain events: Account Contract / Withdrawals ----
 * account.initialized / verified <- AccountInitialized / AccountVerified
 * account.withdrawal             <- WithdrawalTo
 * account.refund_processed       <- RefundProcessed
 * (account.restricted duplicates merchant.account_restricted above — same
 *  AccountRestricted event, listed once)
 *
 * ---- Off-chain actions with no endpoint yet ----
 * (admin.created is implemented — POST /admin/admins records it; see
 *  createAdminController in ../../controllers/admin-auth.controllers.ts)
 *
 * ---- Explicitly excluded, not gaps (per the issue) ----
 * NonceInvalidatedEvent   - not a state change worth auditing
 * InitializedEvent        - one-time contract deploy, not an admin action
 * FeeDiscountAppliedEvent - computed side-effect of invoice.paid/subscription.charged
 * BridgePlaceholderEvent  - placeholder, no real state change yet
 */
export {};
