begin;

insert into stalls (id, slug, name, contact_phone) values
  ('00000000-0000-4000-8000-000000000001', 'yangmei-a', '阳美一号档口', '13800000001'),
  ('00000000-0000-4000-8000-000000000002', 'yangmei-b', '阳美二号档口', '13800000002')
on conflict (id) do update set name = excluded.name, contact_phone = excluded.contact_phone;

insert into staff (id, stall_id, code, name, role) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'owner-a', '林老板', 'owner'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'assistant-a', '小陈', 'assistant'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 'owner-b', '周老板', 'owner')
on conflict (id) do update set name = excluded.name, active = true;

insert into staff_permissions (staff_id, permission) values
  ('10000000-0000-4000-8000-000000000002', 'goods.edit')
on conflict do nothing;

insert into audience_groups (id, stall_id, name) values
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '熟客'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '直播客户'),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', '熟客'),
  ('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002', '同行')
on conflict (id) do update set name = excluded.name;

insert into customers (id, stall_id, code, name, coefficient_bps) values
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'customer-multi', '多组客户', 8000),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'customer-grant', '单客授权客户', 9000),
  ('30000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'customer-list', '无系数客户', null),
  ('30000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002', 'customer-b', '二号客户', 8500)
on conflict (id) do update set name = excluded.name, coefficient_bps = excluded.coefficient_bps;

insert into customer_group_memberships (stall_id, customer_id, group_id) values
  ('00000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000003')
on conflict do nothing;

insert into goods (
  id, stall_id, code, name, public_visible, public_price_visible, attributes, certificate_source
) values
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'A-001', '冰种平安扣', true, true, '{"shape":"平安扣","color":"晴水"}', '合成证书样例 A001'),
  ('40000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'A-002', '飘花手镯', false, false, '{"shape":"手镯","size":"56"}', null),
  ('40000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'A-003', '紫罗兰蛋面', false, false, '{"shape":"蛋面","color":"紫罗兰"}', '合成证书样例 A003'),
  ('40000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002', 'B-001', '豆种如意', true, false, '{"shape":"如意"}', null)
on conflict (id) do update set name = excluded.name, attributes = excluded.attributes,
  certificate_source = excluded.certificate_source, status = 'in_stock';

insert into goods_prices (goods_id, list_price_cents, cost_price_cents, floor_price_cents) values
  ('40000000-0000-4000-8000-000000000001', 20000, 10000, 12000),
  ('40000000-0000-4000-8000-000000000002', 880000, 500000, 620000),
  ('40000000-0000-4000-8000-000000000003', 360000, 220000, 280000),
  ('40000000-0000-4000-8000-000000000004', 96000, 50000, 70000)
on conflict (goods_id) do update set list_price_cents = excluded.list_price_cents,
  cost_price_cents = excluded.cost_price_cents, floor_price_cents = excluded.floor_price_cents;

insert into goods_groups (stall_id, goods_id, group_id) values
  ('00000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002')
on conflict do nothing;

insert into customer_goods_grants (stall_id, customer_id, goods_id) values
  ('00000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003')
on conflict (customer_id, goods_id) do update set revoked_at = null;

insert into customer_goods_overrides (stall_id, customer_id, goods_id, price_cents) values
  ('00000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 11000)
on conflict (customer_id, goods_id) do update set price_cents = excluded.price_cents;

insert into media_assets (
  id, stall_id, goods_id, kind, storage_key, mime_type, size_bytes, checksum, review_status
) values
  ('50000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'image', 'jade-a001.svg', 'image/svg+xml', 382, '32f8a11b92dfe9dac02fd5ead65811584f7d23f5627831f2178d2216849e38d7', 'approved'),
  ('50000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'image', 'jade-a002.svg', 'image/svg+xml', 433, '787845dad7cf4ef90d7506d3a4a72e7e3f4987bd22d5af27deecee21de5cd0ea', 'approved'),
  ('50000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', 'video', 'demo-video.mp4', 'video/mp4', 175200, '8844660959b3f9224f21e5c15a634a230d1307b0bfa7dd558a5778583f65b1da', 'pending')
on conflict (id) do update set
  storage_key = excluded.storage_key,
  mime_type = excluded.mime_type,
  size_bytes = excluded.size_bytes,
  checksum = excluded.checksum,
  review_status = excluded.review_status;

insert into batches (id, stall_id, title, status, version, published_at) values
  ('60000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '九月新款', 'published', 2, '2026-09-23 00:00:00+08'),
  ('60000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '待审视频款', 'draft', 1, null)
on conflict (id) do update set title = excluded.title, status = excluded.status,
  version = excluded.version, published_at = excluded.published_at;

insert into batch_items (stall_id, batch_id, goods_id, position) values
  ('00000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 0),
  ('00000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 1),
  ('00000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003', 0)
on conflict do nothing;

commit;
