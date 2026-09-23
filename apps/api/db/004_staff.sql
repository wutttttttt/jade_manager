begin;

alter table staff add column if not exists version integer not null default 1;
alter table staff add column if not exists updated_at timestamptz not null default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'staff_version_check') then
    alter table staff add constraint staff_version_check check (version >= 1);
  end if;
end $$;

commit;
