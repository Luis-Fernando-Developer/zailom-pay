-- Shared BRL chart of accounts for the first internal ledger workflows.
insert into public.zp_ledger_accounts
  (participant_id, product_id, account_code, account_name, account_type, currency)
select null, null, seed.account_code, seed.account_name, seed.account_type::public.zp_account_type, 'BRL'
from (values
  ('provider_clearing', 'Valores a liquidar pelo provedor', 'asset'),
  ('participants_payable', 'Valores devidos aos participantes', 'liability'),
  ('platform_fee_revenue', 'Receita de tarifas da plataforma', 'revenue'),
  ('provider_fee_expense', 'Despesas de tarifas do provedor', 'expense'),
  ('refunds_payable', 'Reembolsos a pagar', 'liability')
) as seed(account_code, account_name, account_type)
where not exists (
  select 1
  from public.zp_ledger_accounts existing
  where existing.participant_id is null
    and existing.product_id is null
    and existing.account_code = seed.account_code
    and existing.currency = 'BRL'
);

