// DDL guard used for a reviewed migration or safety rollback. Never cleans data.
export function guardedProgressRevisionSql(definitions, ledgerSql = '') {
  return `begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
lock table public.user_learning_progress in share row exclusive mode;
lock table public.user_learning_progress_revisions in share row exclusive mode;
create temporary table revision_record_guard(kind text,row_key text,fingerprint text,primary key(kind,row_key)) on commit drop;
insert into revision_record_guard
select 'current',p.user_id::text,encode(sha256(convert_to(row_to_json(p)::text,'UTF8')),'hex') from public.user_learning_progress p
union all
select 'revision',r.id::text,encode(sha256(convert_to(row_to_json(r)::text,'UTF8')),'hex') from public.user_learning_progress_revisions r;
${definitions}
do $guard$
begin
 if exists(with after_records as(
  select 'current' kind,p.user_id::text row_key,encode(sha256(convert_to(row_to_json(p)::text,'UTF8')),'hex') fingerprint from public.user_learning_progress p
  union all select 'revision',r.id::text,encode(sha256(convert_to(row_to_json(r)::text,'UTF8')),'hex') from public.user_learning_progress_revisions r
 )select 1 from revision_record_guard before_records full join after_records using(kind,row_key)
 where before_records.fingerprint is distinct from after_records.fingerprint)then
  raise exception 'Non-destructive migration guard: a current or revision record changed. Rolling back.';
 end if;
end $guard$;
${ledgerSql}
commit;`
}
