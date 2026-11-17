import { getCurrentUser } from "./auth.js";

export async function registerAdminRoutes(app, pool) {
  app.get("/api/v1/admin/overview", async (request, reply) => {
    const user = await getCurrentUser(pool, request);
    if (!user) {
      return reply.code(401).send({ error: "Autenticação necessária." });
    }

    const [organizations, participants, transactions, payouts, providerEvents, recentTransactions] =
      await Promise.all([
        pool.query(`select
          count(*)::int as total,
          count(*) filter (where status = 'active')::int as active
          from public.zp_organizations`),
        pool.query(`select
          count(*)::int as total,
          count(*) filter (where status = 'active')::int as active,
          count(*) filter (where kyc_status in ('pending', 'under_review', 'action_required'))::int as kyc_pending
          from public.zp_participants`),
        pool.query(`select
          count(*)::int as total,
          count(*) filter (where status = 'posted')::int as posted,
          count(*) filter (where status = 'draft')::int as draft,
          count(*) filter (where status = 'reversed')::int as reversed
          from public.zp_ledger_transactions`),
        pool.query(`select
          count(*)::int as total,
          count(*) filter (where status in ('requested', 'approved', 'processing'))::int as pending
          from public.zp_payout_requests`),
        pool.query(`select
          count(*)::int as total,
          count(*) filter (where processed_at is null)::int as unprocessed
          from public.zp_provider_events`),
        pool.query(`select id, event_type, status, description, created_at
          from public.zp_ledger_transactions
          order by created_at desc
          limit 8`),
      ]);

    return {
      generatedAt: new Date().toISOString(),
      viewer: { id: user.id, email: user.email, role: user.role },
      organizations: organizations.rows[0],
      participants: participants.rows[0],
      ledger: transactions.rows[0],
      payouts: payouts.rows[0],
      providerEvents: providerEvents.rows[0],
      recentTransactions: recentTransactions.rows,
      moneyMovementEnabled: false,
    };
  });
}
