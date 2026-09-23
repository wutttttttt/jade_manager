begin;

alter table media_assets add column if not exists size_bytes integer not null default 0;
alter table media_assets add column if not exists checksum text;
alter table media_assets add column if not exists version integer not null default 1;
alter table media_assets add column if not exists reviewed_at timestamptz;
alter table media_assets add column if not exists reviewed_by uuid references staff(id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'media_assets_size_bytes_check') then
    alter table media_assets add constraint media_assets_size_bytes_check
      check (size_bytes between 0 and 20971520);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_checksum_check') then
    alter table media_assets add constraint media_assets_checksum_check
      check (checksum is null or checksum ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_version_check') then
    alter table media_assets add constraint media_assets_version_check check (version >= 1);
  end if;
end $$;

create unique index if not exists media_assets_stall_storage_key_idx on media_assets(stall_id, storage_key);

commit;
