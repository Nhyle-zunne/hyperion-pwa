drop policy if exists "Users read own checkout batches" on public.checkout_batches;
create policy "Users read own checkout batches"
  on public.checkout_batches
  for select
  to authenticated
  using ((select auth.uid()) = user_id);
