do $$
declare
  v_definition text;
  v_old text := 'when ''gmdss'' then case v_order.license_term when ''week'' then 15 when ''month'' then 50 when ''year'' then 350 else null end';
  v_new text := 'when ''gmdss'' then case v_order.license_term when ''week'' then 15 when ''month'' then 40 when ''year'' then 250 else null end';
begin
  select pg_get_functiondef('public.finalize_paymongo_checkout(uuid,text,text,text,text,bigint,text,text,text)'::regprocedure)
    into v_definition;
  if position(v_old in v_definition) = 0 then
    raise exception 'Expected original GMDSS price mapping was not found; no changes applied.';
  end if;
  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end $$;
