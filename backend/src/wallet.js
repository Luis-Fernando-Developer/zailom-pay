import { getCurrentUser } from "./auth.js";

async function requireAdmin(pool, request, reply) {
  const user = await getCurrentUser(pool, request);
  if (!user) {
    reply.code(401).send({ error: "Autenticação necessária." });
    return null;
  }
  if (!["superadmin", "admin"].includes(user.role)) {
    reply.code(403).send({ error: "Permissão insuficiente." });
    return null;
  }
  return user;
}

export async function registerWalletRoutes(app, pool) {
  app.get("/api/v1/admin/wallet", async (request, reply) => {
    if (!await requireAdmin(pool, request, reply)) return;
    const result = await pool.query(`
      select a.account_code, a.account_name, a.account_type,
        coalesce(sum(case
          when t.id is not null and e.direction = 'debit' then e.amount_minor
          else 0
        end), 0)::text as debit_balance,
        coalesce(sum(case
          when t.id is not null and e.direction = 'credit' then e.amount_minor
          else 0
        end), 0)::text as credit_balance
      from public.zp_ledger_accounts a
      left join public.zp_ledger_entries e on e.account_id = a.id
      left join public.zp_ledger_transactions t
        on t.id = e.transaction_id and t.status = 'posted'
      where a.participant_id is null and a.product_id is null
        and a.currency = 'BRL'
        and a.account_code in ('platform_cash','provider_clearing','platform_fee_revenue','provider_fee_expense','platform_payouts_payable')
      group by a.account_code, a.account_name, a.account_type
    `);
    const history = await pool.query(`
      select id, amount_minor::text, currency, status, destination_label, requested_at, processed_at
      from public.zp_platform_payout_requests
      order by requested_at desc limit 20
    `);
    const balances = Object.fromEntries(result.rows.map(row => [row.account_code, row]));
    const debitBalance = code => BigInt(balances[code]?.debit_balance ?? "0");
    const creditBalance = code => BigInt(balances[code]?.credit_balance ?? "0");
    const available = debitBalance("platform_cash") - creditBalance("platform_cash")
      - (creditBalance("platform_payouts_payable") - debitBalance("platform_payouts_payable"));
    const revenue = creditBalance("platform_fee_revenue") - debitBalance("platform_fee_revenue");
    const clearing = debitBalance("provider_clearing") - creditBalance("provider_clearing");
    const providerFees = debitBalance("provider_fee_expense") - creditBalance("provider_fee_expense");
    const money = value => value.toString();
    return {
      currency: "BRL",
      balances: {
        availableMinor: money(available > 0n ? available : 0n),
        cashLedgerMinor: money(debitBalance("platform_cash") - creditBalance("platform_cash")),
        feesEarnedMinor: money(revenue),
        awaitingSettlementMinor: money(clearing),
        providerFeesMinor: money(providerFees),
      },
      withdrawals: history.rows,
      withdrawalExecutionEnabled: false,
      note: "Os valores refletem somente lançamentos contabilizados no ledger. Saques reais ainda dependem da integração e autorização do provedor."
    };
  });
}
