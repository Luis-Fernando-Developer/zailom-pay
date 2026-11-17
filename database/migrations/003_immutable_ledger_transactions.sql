-- Keep posted ledger transactions append-only. Corrections must be new compensating transactions.
create or replace function public.zp_prevent_posted_transaction_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status in ('posted', 'reversed') then
    raise exception 'Posted ledger transactions are immutable; use a compensating transaction';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists zp_ledger_transactions_immutable on public.zp_ledger_transactions;
create trigger zp_ledger_transactions_immutable
before update or delete on public.zp_ledger_transactions
for each row execute function public.zp_prevent_posted_transaction_mutation();

comment on function public.zp_prevent_posted_transaction_mutation() is
  'Prevents modification or deletion of posted ledger history. Corrections use compensating transactions.';
