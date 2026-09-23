begin;

create table if not exists stalls (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  contact_phone text,
  created_at timestamptz not null default now()
);

create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  stall_id uuid not null references stalls(id),
  code text not null,
  name text not null,
  role text not null check (role in ('owner', 'assistant')),
  active boolean not null default true,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stall_id, code)
);

create table if not exists staff_permissions (
  staff_id uuid not null references staff(id) on delete cascade,
  permission text not null check (permission in (
    'goods.edit', 'media.publish', 'customer.manage',
    'price.list.edit', 'price.cost.edit', 'price.floor.edit'
  )),
  primary key (staff_id, permission)
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  stall_id uuid not null references stalls(id),
  code text not null,
  name text not null,
  coefficient_bps integer check (coefficient_bps between 1 and 100000),
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stall_id, code),
  unique (stall_id, id)
);

create table if not exists audience_groups (
  id uuid primary key default gen_random_uuid(),
  stall_id uuid not null references stalls(id),
  name text not null,
  unique (stall_id, name),
  unique (stall_id, id)
);

create table if not exists customer_group_memberships (
  stall_id uuid not null references stalls(id),
  customer_id uuid not null,
  group_id uuid not null,
  foreign key (stall_id, customer_id) references customers(stall_id, id) on delete cascade,
  foreign key (stall_id, group_id) references audience_groups(stall_id, id) on delete cascade,
  primary key (customer_id, group_id)
);

create table if not exists goods (
  id uuid primary key default gen_random_uuid(),
  stall_id uuid not null references stalls(id),
  code text not null,
  name text not null,
  attributes jsonb not null default '{}',
  certificate_source text,
  status text not null default 'in_stock' check (status in ('in_stock', 'withdrawn')),
  public_visible boolean not null default false,
  public_price_visible boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stall_id, code),
  unique (stall_id, id)
);

create table if not exists goods_prices (
  goods_id uuid primary key references goods(id) on delete cascade,
  list_price_cents bigint check (list_price_cents is null or list_price_cents between 0 and 10000000000),
  cost_price_cents bigint check (cost_price_cents is null or cost_price_cents between 0 and 10000000000),
  floor_price_cents bigint check (floor_price_cents is null or floor_price_cents between 0 and 10000000000),
  version integer not null default 1,
  check (list_price_cents is null or floor_price_cents is null or floor_price_cents <= list_price_cents)
);

create table if not exists goods_groups (
  stall_id uuid not null references stalls(id),
  goods_id uuid not null,
  group_id uuid not null,
  foreign key (stall_id, goods_id) references goods(stall_id, id) on delete cascade,
  foreign key (stall_id, group_id) references audience_groups(stall_id, id) on delete cascade,
  primary key (goods_id, group_id)
);

create table if not exists customer_goods_grants (
  stall_id uuid not null references stalls(id),
  customer_id uuid not null,
  goods_id uuid not null,
  foreign key (stall_id, customer_id) references customers(stall_id, id) on delete cascade,
  foreign key (stall_id, goods_id) references goods(stall_id, id) on delete cascade,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (customer_id, goods_id)
);

create table if not exists customer_goods_overrides (
  stall_id uuid not null references stalls(id),
  customer_id uuid not null,
  goods_id uuid not null,
  foreign key (stall_id, customer_id) references customers(stall_id, id) on delete cascade,
  foreign key (stall_id, goods_id) references goods(stall_id, id) on delete cascade,
  price_cents bigint not null check (price_cents between 0 and 10000000000),
  version integer not null default 1,
  primary key (customer_id, goods_id)
);

create table if not exists media_assets (
  id uuid primary key default gen_random_uuid(),
  stall_id uuid not null references stalls(id),
  goods_id uuid not null,
  foreign key (stall_id, goods_id) references goods(stall_id, id) on delete cascade,
  kind text not null check (kind in ('image', 'video')),
  storage_key text not null,
  mime_type text not null,
  size_bytes integer not null default 0 check (size_bytes between 0 and 20971520),
  checksum text check (checksum is null or checksum ~ '^[0-9a-f]{64}$'),
  review_status text not null check (review_status in ('pending', 'approved', 'rejected', 'withdrawn')),
  version integer not null default 1 check (version >= 1),
  reviewed_at timestamptz,
  reviewed_by uuid references staff(id),
  created_at timestamptz not null default now()
);

create table if not exists batches (
  id uuid primary key default gen_random_uuid(),
  stall_id uuid not null references stalls(id),
  title text not null,
  status text not null check (status in ('draft', 'published', 'withdrawn')),
  version integer not null default 1,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (stall_id, id)
);

create table if not exists batch_items (
  stall_id uuid not null references stalls(id),
  batch_id uuid not null,
  goods_id uuid not null,
  foreign key (stall_id, batch_id) references batches(stall_id, id) on delete cascade,
  foreign key (stall_id, goods_id) references goods(stall_id, id),
  position integer not null,
  primary key (batch_id, goods_id),
  unique (batch_id, position)
);

create table if not exists audit_entries (
  id bigint generated always as identity primary key,
  stall_id uuid not null references stalls(id),
  staff_id uuid references staff(id),
  action text not null,
  subject_type text not null,
  subject_id uuid,
  summary jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists idempotency_keys (
  stall_id uuid not null references stalls(id),
  request_id text not null check (length(request_id) between 8 and 200),
  request_hash text not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (stall_id, request_id)
);

create index if not exists goods_stall_status_idx on goods(stall_id, status);
create index if not exists media_goods_review_idx on media_assets(goods_id, review_status);
create index if not exists batches_stall_created_idx on batches(stall_id, created_at desc);

commit;
