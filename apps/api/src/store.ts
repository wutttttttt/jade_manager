import { createHash } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { MAX_PRICE_CENTS, canView, quote, type GoodsForViewer, type Viewer } from './domain.ts'

type Row = GoodsForViewer & {
  code: string
  name: string
  status: string
  version: number
  attributes: Record<string, string>
  certificateSource: string | null
  priceVersion: number
  overrideVersion: number | null
  overrideCents: number | null
  media: Array<{ id: string; kind: string }>
}

const permissions = [
  'goods.edit', 'media.publish', 'customer.manage',
  'price.list.edit', 'price.cost.edit', 'price.floor.edit',
] as const
type Permission = typeof permissions[number]

export class Store {
  readonly pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString })
  }

  async close() { await this.pool.end() }

  async health() {
    const result = await this.pool.query('select current_database() as database')
    return result.rows[0]
  }

  async staffWorkspace(stallSlug: string, staffCode: string) {
    return this.transaction(async (client) => {
      const actor = await this.authorizeOwner(client, stallSlug, staffCode)
      const staff = await client.query(
        `select s.id, s.code, s.name, s.role, s.active, s.version,
          coalesce(array_agg(p.permission order by p.permission)
            filter (where p.permission is not null), '{}') permissions
         from staff s left join staff_permissions p on p.staff_id = s.id
         where s.stall_id = $1 group by s.id order by s.role desc, s.code`,
        [actor.stallId],
      )
      return { permissions, staff: staff.rows }
    })
  }

  async createAssistant(
    stallSlug: string, staffCode: string, input: Record<string, unknown>, requestId: string,
  ) {
    const code = requiredText(input.code, '员工编号', 40)
    const name = requiredText(input.name, '员工姓名', 80)
    requireRequestId(requestId)
    const assistant = { code, name }
    return this.transaction(async (client) => {
      const actor = await this.authorizeOwner(client, stallSlug, staffCode)
      const prior = await this.idempotent(client, actor.stallId, requestId, assistant)
      if (prior) return prior
      const created = await client.query(
        `insert into staff (stall_id, code, name, role) values ($1, $2, $3, 'assistant')
         on conflict (stall_id, code) do nothing
         returning id, code, name, role, active, version`,
        [actor.stallId, code, name],
      )
      if (!created.rowCount) throw new HttpError(409, '员工编号已存在')
      const result = { ...created.rows[0], permissions: [] }
      await client.query(
        `insert into audit_entries (stall_id, staff_id, action, subject_type, subject_id)
         values ($1, $2, 'staff.created', 'staff', $3)`,
        [actor.stallId, actor.staffId, result.id],
      )
      await this.saveIdempotent(client, actor.stallId, requestId, assistant, result)
      return result
    })
  }

  async updateStaffAccess(
    stallSlug: string, staffCode: string, staffId: string, input: Record<string, unknown>, requestId: string,
  ) {
    const version = Number(input.version)
    const granted = input.permissions
    if (!uuid(staffId) || !Number.isSafeInteger(version) || version < 1 || typeof input.active !== 'boolean'
      || !Array.isArray(granted) || new Set(granted).size !== granted.length
      || granted.some((permission) => typeof permission !== 'string' || !permissions.includes(permission as Permission))) {
      throw new HttpError(400, '员工权限设置格式错误')
    }
    requireRequestId(requestId)
    const access = { staffId, version, active: input.active, permissions: granted }
    return this.transaction(async (client) => {
      const actor = await this.authorizeOwner(client, stallSlug, staffCode)
      const prior = await this.idempotent(client, actor.stallId, requestId, access)
      if (prior) return prior
      const changed = await client.query(
        `update staff set active = $1, version = version + 1, updated_at = now()
         where id = $2 and stall_id = $3 and role = 'assistant' and version = $4
         returning id, code, name, role, active, version`,
        [input.active, staffId, actor.stallId, version],
      )
      if (!changed.rowCount) throw new HttpError(409, '员工版本冲突、不存在或不允许修改老板')
      await client.query('delete from staff_permissions where staff_id = $1', [staffId])
      for (const permission of granted) await client.query(
        'insert into staff_permissions (staff_id, permission) values ($1, $2)', [staffId, permission],
      )
      await client.query(
        `insert into audit_entries (stall_id, staff_id, action, subject_type, subject_id, summary)
         values ($1, $2, 'staff.access_changed', 'staff', $3, $4)`,
        [actor.stallId, actor.staffId, staffId, { active: input.active, permissions: granted }],
      )
      const result = { ...changed.rows[0], permissions: granted }
      await this.saveIdempotent(client, actor.stallId, requestId, access, result)
      return result
    })
  }

  async showroom(stallSlug: string, customerCode?: string, batchId?: string) {
    if (batchId && !uuid(batchId)) throw new HttpError(400, '批次格式错误')
    const stall = await this.pool.query('select id, name, contact_phone from stalls where slug = $1', [stallSlug])
    if (!stall.rowCount) return null
    const stallId = stall.rows[0].id as string
    const batch = batchId ? (await this.pool.query(
      `select id, title, published_at as "publishedAt" from batches
       where id = $1 and stall_id = $2 and status = 'published'`,
      [batchId, stallId],
    )).rows[0] : null
    if (batchId && !batch) throw new HttpError(404, '批次不存在或未发布')
    let viewer: Viewer = null
    if (customerCode) {
      const customer = await this.pool.query(
        `select c.id, c.version, c.coefficient_bps,
          coalesce(array_agg(distinct cgm.group_id) filter (where cgm.group_id is not null), '{}') group_ids,
          coalesce(array_agg(distinct cg.goods_id) filter (where cg.goods_id is not null), '{}') granted_goods_ids
         from customers c
         left join customer_group_memberships cgm on cgm.customer_id = c.id
         left join customer_goods_grants cg on cg.customer_id = c.id and cg.revoked_at is null
         where c.stall_id = $1 and c.code = $2 and c.active
         group by c.id`,
        [stallId, customerCode],
      )
      if (customer.rowCount) viewer = {
        customerId: customer.rows[0].id,
        version: customer.rows[0].version,
        coefficientBps: customer.rows[0].coefficient_bps,
        groupIds: customer.rows[0].group_ids,
        grantedGoodsIds: customer.rows[0].granted_goods_ids,
      }
    }

    const rows = await this.pool.query(
      `select g.id, g.code, g.name, g.status, g.version, g.attributes,
        g.certificate_source as "certificateSource",
        g.public_visible as "publicVisible", g.public_price_visible as "publicPriceVisible",
        (g.status = 'in_stock') as available,
        p.list_price_cents::double precision as "listPriceCents", p.version as "priceVersion",
        p.floor_price_cents::double precision as "floorPriceCents",
        coalesce(array_agg(distinct gg.group_id) filter (where gg.group_id is not null), '{}') as "groupIds",
        coalesce(jsonb_agg(distinct jsonb_build_object('id', m.id, 'kind', m.kind))
          filter (where m.id is not null and m.review_status = 'approved'), '[]') as media,
        o.price_cents::double precision as "overrideCents", o.version as "overrideVersion"
       from goods g
       join goods_prices p on p.goods_id = g.id
       left join goods_groups gg on gg.goods_id = g.id
       left join media_assets m on m.goods_id = g.id
       left join customer_goods_overrides o on o.goods_id = g.id and o.customer_id = $2
       left join batch_items selected_bi on selected_bi.goods_id = g.id
         and selected_bi.batch_id = $3 and selected_bi.stall_id = $1
       where g.stall_id = $1 and ($3::uuid is null or selected_bi.goods_id is not null)
       group by g.id, p.list_price_cents, p.floor_price_cents, p.version,
         o.price_cents, o.version, selected_bi.position
       order by selected_bi.position nulls last, g.created_at, g.code`,
      [stallId, viewer?.customerId ?? null, batchId ?? null],
    )
    const goods = (rows.rows as Row[]).flatMap((item) => {
      const effective = quote(item, viewer, item.overrideCents)
      if (!canView(item, viewer)) return []
      return [{
        id: item.id, code: item.code, name: item.name, status: item.status,
        attributes: item.attributes, certificateSource: item.certificateSource,
        version: item.version, media: item.media,
        quote: effective ? { priceYuan: effective.priceYuan, currency: 'CNY', display: 'numeric',
          version: `${item.priceVersion}:${viewer?.version ?? 0}:${item.overrideVersion ?? 0}` } : null,
      }]
    })
    return { stall: stall.rows[0], batch, viewer: customerCode ? { code: customerCode, recognized: !!viewer } : null,
      goods }
  }

  async media(stallSlug: string, mediaId: string, customerCode?: string) {
    const view = await this.showroom(stallSlug, customerCode)
    if (!view) return null
    const allowed = new Set(view.goods.flatMap((item) => item.media.map((media) => media.id)))
    if (!allowed.has(mediaId)) return null
    const result = await this.pool.query(
      `select storage_key, mime_type from media_assets where id = $1 and review_status = 'approved'`,
      [mediaId],
    )
    return result.rows[0] ?? null
  }

  async staffMedia(stallSlug: string, staffCode: string, mediaId: string) {
    if (!uuid(mediaId)) return null
    return this.transaction(async (client) => {
      const actor = await this.authorize(client, stallSlug, staffCode, ['media.publish'])
      const result = await client.query(
        'select storage_key, mime_type from media_assets where id = $1 and stall_id = $2',
        [mediaId, actor.stallId],
      )
      return result.rows[0] ?? null
    })
  }

  async createGoods(stallSlug: string, staffCode: string, input: Record<string, unknown>, requestId: string) {
    const code = requiredText(input.code, '货号', 40)
    const name = requiredText(input.name, '名称', 100)
    const shape = optionalText(input.shape, '器型', 60)
    const color = optionalText(input.color, '颜色', 60)
    const certificateSource = optionalText(input.certificateSource, '证书来源', 120)
    const attributes = Object.fromEntries(Object.entries({ shape, color }).filter(([, value]) => value !== null))
    const listPrice = cents(input.listPriceCents, '挂牌价')
    const costPrice = cents(input.costPriceCents, '成本价')
    const floorPrice = cents(input.floorPriceCents, '最低可售价')
    if (typeof input.publicVisible !== 'boolean' || typeof input.publicPriceVisible !== 'boolean') {
      throw new HttpError(400, '商品公开设置格式错误')
    }
    if (floorPrice > listPrice) throw new HttpError(400, '最低可售价不能高于挂牌价')
    requireRequestId(requestId)
    const goodsInput = { code, name, attributes, certificateSource, listPrice, costPrice, floorPrice,
      publicVisible: input.publicVisible, publicPriceVisible: input.publicPriceVisible }
    return this.transaction(async (client) => {
      const actor = await this.authorize(client, stallSlug, staffCode,
        ['goods.edit', 'price.list.edit', 'price.cost.edit', 'price.floor.edit'])
      const prior = await this.idempotent(client, actor.stallId, requestId, goodsInput)
      if (prior) return prior
      const created = await client.query(
        `insert into goods
          (stall_id, code, name, attributes, certificate_source, public_visible, public_price_visible)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (stall_id, code) do nothing
         returning id, code, name, attributes, certificate_source as "certificateSource", version`,
        [actor.stallId, code, name, attributes, certificateSource,
          goodsInput.publicVisible, goodsInput.publicPriceVisible],
      )
      if (!created.rowCount) throw new HttpError(409, '货号已存在')
      await client.query(
        `insert into goods_prices (goods_id, list_price_cents, cost_price_cents, floor_price_cents)
         values ($1, $2, $3, $4)`,
        [created.rows[0].id, listPrice, costPrice, floorPrice],
      )
      await client.query(
        `insert into audit_entries (stall_id, staff_id, action, subject_type, subject_id)
         values ($1, $2, 'goods.created', 'goods', $3)`,
        [actor.stallId, actor.staffId, created.rows[0].id],
      )
      await this.saveIdempotent(client, actor.stallId, requestId, goodsInput, created.rows[0])
      return created.rows[0]
    })
  }

  async updateGoodsStatus(
    stallSlug: string, staffCode: string, goodsId: string, status: string, version: number, requestId: string,
  ) {
    if (!uuid(goodsId) || !Number.isSafeInteger(version) || version < 1) throw new HttpError(400, '货品或版本格式错误')
    requireRequestId(requestId)
    const input = { goodsId, status, version }
    return this.transaction(async (client) => {
      const actor = await this.authorize(client, stallSlug, staffCode, ['goods.edit'])
      const prior = await this.idempotent(client, actor.stallId, requestId, input)
      if (prior) return prior
      if (!['in_stock', 'withdrawn'].includes(status)) throw new HttpError(400, 'T1 仅允许在库或撤销')
      const changed = await client.query(
        `update goods set status = $1, version = version + 1, updated_at = now()
         where id = $2 and stall_id = $3 and version = $4 returning id, status, version`,
        [status, goodsId, actor.stallId, version],
      )
      if (!changed.rowCount) throw new HttpError(409, '版本冲突或货品不存在')
      await client.query(
        `insert into audit_entries (stall_id, staff_id, action, subject_type, subject_id, summary)
         values ($1, $2, 'goods.status_changed', 'goods', $3, $4)`,
        [actor.stallId, actor.staffId, goodsId, { status, version: changed.rows[0].version }],
      )
      await this.saveIdempotent(client, actor.stallId, requestId, input, changed.rows[0])
      return changed.rows[0]
    })
  }

  async createMedia(
    stallSlug: string, staffCode: string, goodsId: string, kind: string, storageKey: string,
    mimeType: string, sizeBytes: number, checksum: string, requestId: string, persist: () => Promise<void>,
  ) {
    if (!uuid(goodsId) || !['image', 'video'].includes(kind) || !storageKey || !mimeType
      || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 20 * 1024 * 1024
      || !/^[0-9a-f]{64}$/.test(checksum)) throw new HttpError(400, '媒体参数格式错误')
    requireRequestId(requestId)
    const input = { goodsId, kind, storageKey, mimeType, sizeBytes, checksum }
    return this.transaction(async (client) => {
      const actor = await this.authorize(client, stallSlug, staffCode, ['media.publish'])
      const prior = await this.idempotent(client, actor.stallId, requestId, input)
      if (prior) {
        await persist()
        return prior
      }
      const goods = await client.query('select id from goods where id = $1 and stall_id = $2', [goodsId, actor.stallId])
      if (!goods.rowCount) throw new HttpError(404, '货品不存在')
      const created = await client.query(
        `insert into media_assets
          (stall_id, goods_id, kind, storage_key, mime_type, size_bytes, checksum, review_status)
         values ($1, $2, $3, $4, $5, $6, $7, 'pending')
         returning id, kind, review_status as status, version, storage_key as "storageKey"`,
        [actor.stallId, goodsId, kind, storageKey, mimeType, sizeBytes, checksum],
      )
      await client.query(
        `insert into audit_entries (stall_id, staff_id, action, subject_type, subject_id, summary)
         values ($1, $2, 'media.uploaded', 'media', $3, $4)`,
        [actor.stallId, actor.staffId, created.rows[0].id, { goodsId, kind, sizeBytes, checksum }],
      )
      await this.saveIdempotent(client, actor.stallId, requestId, input, created.rows[0])
      await persist()
      return created.rows[0]
    })
  }

  async reviewMedia(
    stallSlug: string, staffCode: string, mediaId: string, status: string, version: number, requestId: string,
  ) {
    if (!uuid(mediaId) || !Number.isSafeInteger(version) || version < 1) throw new HttpError(400, '媒体或版本格式错误')
    if (!['approved', 'rejected', 'withdrawn'].includes(status)) throw new HttpError(400, '媒体审核状态错误')
    requireRequestId(requestId)
    const input = { mediaId, status, version }
    return this.transaction(async (client) => {
      const actor = await this.authorize(client, stallSlug, staffCode, ['media.publish'])
      const prior = await this.idempotent(client, actor.stallId, requestId, input)
      if (prior) return prior
      const changed = await client.query(
        `update media_assets set review_status = $1, version = version + 1,
           reviewed_at = now(), reviewed_by = $2
         where id = $3 and stall_id = $4 and version = $5
         returning id, kind, review_status as status, version`,
        [status, actor.staffId, mediaId, actor.stallId, version],
      )
      if (!changed.rowCount) throw new HttpError(409, '版本冲突或媒体不存在')
      await client.query(
        `insert into audit_entries (stall_id, staff_id, action, subject_type, subject_id, summary)
         values ($1, $2, 'media.reviewed', 'media', $3, $4)`,
        [actor.stallId, actor.staffId, mediaId, { status, version: changed.rows[0].version }],
      )
      await this.saveIdempotent(client, actor.stallId, requestId, input, changed.rows[0])
      return changed.rows[0]
    })
  }

  async publishingWorkspace(stallSlug: string, staffCode: string) {
    return this.transaction(async (client) => {
      const actor = await this.authorize(client, stallSlug, staffCode, ['media.publish'])
      const [goods, batches] = await Promise.all([
        client.query(
          `select g.id, g.code, g.name, g.status, g.version, g.attributes,
            g.certificate_source as "certificateSource",
            coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'status', m.review_status,
              'version', m.version))
              filter (where m.id is not null), '[]') media
           from goods g left join media_assets m on m.goods_id = g.id
           where g.stall_id = $1 group by g.id order by g.code`,
          [actor.stallId],
        ),
        client.query(
          `select b.id, b.title, b.status, b.version, b.published_at as "publishedAt",
            coalesce(array_agg(bi.goods_id order by bi.position) filter (where bi.goods_id is not null), '{}') as "goodsIds"
           from batches b left join batch_items bi on bi.batch_id = b.id
           where b.stall_id = $1 group by b.id order by b.created_at desc`,
          [actor.stallId],
        ),
      ])
      return { goods: goods.rows, batches: batches.rows }
    })
  }

  async customerWorkspace(stallSlug: string, staffCode: string) {
    return this.transaction(async (client) => {
      const actor = await this.authorize(client, stallSlug, staffCode, ['customer.manage', 'price.list.edit'])
      const [customers, groups, goods] = await Promise.all([
        client.query(
          `select c.id, c.code, c.name, c.coefficient_bps as "coefficientBps", c.active, c.version,
            coalesce((select array_agg(m.group_id order by m.group_id)
              from customer_group_memberships m where m.customer_id = c.id), '{}') as "groupIds",
            coalesce((select array_agg(g.goods_id order by g.goods_id)
              from customer_goods_grants g where g.customer_id = c.id and g.revoked_at is null), '{}') as "grantedGoodsIds",
            coalesce((select jsonb_agg(jsonb_build_object('goodsId', o.goods_id,
              'priceCents', o.price_cents::double precision, 'version', o.version) order by o.goods_id)
              from customer_goods_overrides o where o.customer_id = c.id), '[]') as overrides
           from customers c where c.stall_id = $1 order by c.code`,
          [actor.stallId],
        ),
        client.query('select id, name from audience_groups where stall_id = $1 order by name', [actor.stallId]),
        client.query(
          `select g.id, g.code, g.name, g.status, g.version,
            g.public_visible as "publicVisible", g.public_price_visible as "publicPriceVisible",
            coalesce(array_agg(gg.group_id order by gg.group_id) filter (where gg.group_id is not null), '{}') as "groupIds"
           from goods g left join goods_groups gg on gg.goods_id = g.id
           where g.stall_id = $1 group by g.id order by g.code`,
          [actor.stallId],
        ),
      ])
      return { customers: customers.rows, groups: groups.rows, goods: goods.rows }
    })
  }

  async pricingWorkspace(stallSlug: string, staffCode: string) {
    return this.transaction(async (client) => {
      const actor = await this.authorize(client, stallSlug, staffCode, [])
      const allowed = await this.pricePermissions(client, actor)
      if (!allowed.size) throw new HttpError(403, '无价格权限')
      const result = await client.query(
        `select g.id, g.code, g.name, p.version,
          p.list_price_cents::double precision as "listPriceCents",
          p.cost_price_cents::double precision as "costPriceCents",
          p.floor_price_cents::double precision as "floorPriceCents"
         from goods g join goods_prices p on p.goods_id = g.id
         where g.stall_id = $1 order by g.code`,
        [actor.stallId],
      )
      return { goods: result.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, version: row.version,
        ...(allowed.has('price.list.edit') ? { listPriceCents: row.listPriceCents } : {}),
        ...(allowed.has('price.cost.edit') ? { costPriceCents: row.costPriceCents } : {}),
        ...(allowed.has('price.floor.edit') ? { floorPriceCents: row.floorPriceCents } : {}),
      })) }
    })
  }

  async updateGoodsPrices(
    stallSlug: string, staffCode: string, goodsId: string, input: Record<string, unknown>, requestId: string,
  ) {
    const version = Number(input.version)
    if (!uuid(goodsId) || !Number.isSafeInteger(version) || version < 1) throw new HttpError(400, '商品价格版本错误')
    const specified = {
      listPriceCents: input.listPriceCents === undefined ? undefined : cents(input.listPriceCents, '挂牌价'),
      costPriceCents: input.costPriceCents === undefined ? undefined : cents(input.costPriceCents, '成本价'),
      floorPriceCents: input.floorPriceCents === undefined ? undefined : cents(input.floorPriceCents, '最低可售价'),
    }
    if (Object.values(specified).every((value) => value === undefined)) throw new HttpError(400, '至少提交一项价格')
    requireRequestId(requestId)
    const prices = { goodsId, version, ...specified }
    return this.transaction(async (client) => {
      const actor = await this.authorize(client, stallSlug, staffCode, [])
      const allowed = await this.pricePermissions(client, actor)
      const required = Object.entries(specified).flatMap(([field, value]) => value === undefined ? [] : [{
        listPriceCents: 'price.list.edit', costPriceCents: 'price.cost.edit', floorPriceCents: 'price.floor.edit',
      }[field] as Permission])
      if (required.some((permission) => !allowed.has(permission))) throw new HttpError(403, '无价格字段权限')
      const prior = await this.idempotent(client, actor.stallId, requestId, prices)
      if (prior) return prior
      const current = await client.query(
        `select p.version, p.list_price_cents::double precision as "listPriceCents",
           p.cost_price_cents::double precision as "costPriceCents",
           p.floor_price_cents::double precision as "floorPriceCents"
         from goods_prices p join goods g on g.id = p.goods_id
         where p.goods_id = $1 and g.stall_id = $2 for update`,
        [goodsId, actor.stallId],
      )
      if (!current.rowCount || current.rows[0].version !== version) {
        throw new HttpError(409, '价格版本冲突或商品不存在')
      }
      const listPriceCents = specified.listPriceCents ?? current.rows[0].listPriceCents
      const costPriceCents = specified.costPriceCents ?? current.rows[0].costPriceCents
      const floorPriceCents = specified.floorPriceCents ?? current.rows[0].floorPriceCents
      if (floorPriceCents > listPriceCents) throw new HttpError(400, '最低可售价不能高于挂牌价')
      const changed = await client.query(
        `update goods_prices p set list_price_cents = $1, cost_price_cents = $2,
           floor_price_cents = $3, version = p.version + 1
         from goods g where p.goods_id = $4 and g.id = p.goods_id and g.stall_id = $5 and p.version = $6
         returning p.goods_id as id, p.version,
           p.list_price_cents::double precision as "listPriceCents",
           p.cost_price_cents::double precision as "costPriceCents",
           p.floor_price_cents::double precision as "floorPriceCents"`,
        [listPriceCents, costPriceCents, floorPriceCents, goodsId, actor.stallId, version],
      )
      if (!changed.rowCount) throw new HttpError(409, '价格版本冲突或商品不存在')
      await client.query(
        `insert into audit_entries (stall_id, staff_id, action, subject_type, subject_id, summary)
         values ($1, $2, 'goods.prices_changed', 'goods', $3, $4)`,
        [actor.stallId, actor.staffId, goodsId, Object.fromEntries(
          Object.entries(specified).filter(([, value]) => value !== undefined))],
      )
      const result = { id: changed.rows[0].id, version: changed.rows[0].version,
        ...(allowed.has('price.list.edit') ? { listPriceCents: changed.rows[0].listPriceCents } : {}),
        ...(allowed.has('price.cost.edit') ? { costPriceCents: changed.rows[0].costPriceCents } : {}),
        ...(allowed.has('price.floor.edit') ? { floorPriceCents: changed.rows[0].floorPriceCents } : {}),
      }
      await this.saveIdempotent(client, actor.stallId, requestId, prices, result)
      return result
    })
  }

  async createAudienceGroup(stallSlug: string, staffCode: string, nameValue: unknown, requestId: string) {
    const name = requiredText(nameValue, '商品组名称', 60)
    requireRequestId(requestId)
    const input = { name }
    return this.transaction(async (client) => {
      const actor = await this.authorize(client, stallSlug, staffCode, ['customer.manage'])
      const prior = await this.idempotent(client, actor.stallId, requestId, input)
      if (prior) return prior
      const inserted = await client.query(
        `insert into audience_groups (stall_id, name) values ($1, $2)
         on conflict (stall_id, name) do nothing returning id, name`,
        [actor.stallId, name],
      )
      const group = inserted.rows[0] ?? (await client.query(
        'select id, name from audience_groups where stall_id = $1 and name = $2', [actor.stallId, name],
      )).rows[0]
      if (inserted.rowCount) await client.query(
        `insert into audit_entries (stall_id, staff_id, action, subject_type, subject_id)
         values ($1, $2, 'audience_group.created', 'audience_group', $3)`,
        [actor.stallId, actor.staffId, group.id],
      )
      await this.saveIdempotent(client, actor.stallId, requestId, input, group)
      return group
    })
  }

  async updateGoodsAudience(
    stallSlug: string, staffCode: string, goodsId: string, input: Record<string, unknown>, requestId: string,
  ) {
    const version = Number(input.version)
    const groupIds = input.groupIds
    if (!uuid(goodsId) || !Number.isSafeInteger(version) || version < 1 || !uuidArray(groupIds)
      || typeof input.publicVisible !== 'boolean' || typeof input.publicPriceVisible !== 'boolean') {
      throw new HttpError(400, '商品可见设置格式错误')
    }
    requireRequestId(requestId)
    const audience = { goodsId, version, groupIds,
      publicVisible: input.publicVisible, publicPriceVisible: input.publicPriceVisible }
    return this.transaction(async (client) => {
      const actor = await this.authorize(client, stallSlug, staffCode, ['goods.edit', 'customer.manage'])
      const prior = await this.idempotent(client, actor.stallId, requestId, audience)
      if (prior) return prior
      const valid = await client.query(
        'select id from audience_groups where stall_id = $1 and id = any($2::uuid[])', [actor.stallId, groupIds],
      )
      if (valid.rowCount !== groupIds.length) throw new HttpError(400, '商品组含跨档口或不存在对象')
      const changed = await client.query(
        `update goods set public_visible = $1, public_price_visible = $2,
           version = version + 1, updated_at = now()
         where id = $3 and stall_id = $4 and version = $5
         returning id, code, version, public_visible as "publicVisible",
           public_price_visible as "publicPriceVisible"`,
        [input.publicVisible, input.publicPriceVisible, goodsId, actor.stallId, version],
      )
      if (!changed.rowCount) throw new HttpError(409, '商品版本冲突或不存在')
      await client.query('delete from goods_groups where goods_id = $1 and stall_id = $2', [goodsId, actor.stallId])
      for (const groupId of groupIds) await client.query(
        'insert into goods_groups (stall_id, goods_id, group_id) values ($1, $2, $3)',
        [actor.stallId, goodsId, groupId],
      )
      await client.query(
        `insert into audit_entries (stall_id, staff_id, action, subject_type, subject_id, summary)
         values ($1, $2, 'goods.audience_changed', 'goods', $3, $4)`,
        [actor.stallId, actor.staffId, goodsId,
          { publicVisible: input.publicVisible, publicPriceVisible: input.publicPriceVisible, groupCount: groupIds.length }],
      )
      const result = { ...changed.rows[0], groupIds }
      await this.saveIdempotent(client, actor.stallId, requestId, audience, result)
      return result
    })
  }

  async updateCustomerSettings(
    stallSlug: string, staffCode: string, customerId: string, input: Record<string, unknown>, requestId: string,
  ) {
    const version = Number(input.version)
    const coefficientBps = input.coefficientBps === null ? null : Number(input.coefficientBps)
    const groupIds = input.groupIds
    const grantedGoodsIds = input.grantedGoodsIds
    if (!uuid(customerId) || !Number.isSafeInteger(version) || version < 1
      || typeof input.active !== 'boolean'
      || (coefficientBps !== null && (!Number.isSafeInteger(coefficientBps) || coefficientBps < 1 || coefficientBps > 100000))
      || !uuidArray(groupIds) || !uuidArray(grantedGoodsIds)) throw new HttpError(400, '客户设置格式错误')
    requireRequestId(requestId)
    const settings = { customerId, version, active: input.active, coefficientBps, groupIds, grantedGoodsIds }
    return this.transaction(async (client) => {
      const actor = await this.authorize(client, stallSlug, staffCode, ['customer.manage', 'price.list.edit'])
      const prior = await this.idempotent(client, actor.stallId, requestId, settings)
      if (prior) return prior
      const [validGroups, validGoods] = await Promise.all([
        client.query('select id from audience_groups where stall_id = $1 and id = any($2::uuid[])',
          [actor.stallId, groupIds]),
        client.query('select id from goods where stall_id = $1 and id = any($2::uuid[])',
          [actor.stallId, grantedGoodsIds]),
      ])
      if (validGroups.rowCount !== groupIds.length || validGoods.rowCount !== grantedGoodsIds.length) {
        throw new HttpError(400, '客户设置含跨档口或不存在对象')
      }
      const changed = await client.query(
        `update customers set coefficient_bps = $1, active = $2, version = version + 1, updated_at = now()
         where id = $3 and stall_id = $4 and version = $5
         returning id, code, coefficient_bps as "coefficientBps", active, version`,
        [coefficientBps, input.active, customerId, actor.stallId, version],
      )
      if (!changed.rowCount) throw new HttpError(409, '客户版本冲突或不存在')
      await client.query('delete from customer_group_memberships where customer_id = $1 and stall_id = $2',
        [customerId, actor.stallId])
      for (const groupId of groupIds) await client.query(
        'insert into customer_group_memberships (stall_id, customer_id, group_id) values ($1, $2, $3)',
        [actor.stallId, customerId, groupId],
      )
      await client.query(
        'update customer_goods_grants set revoked_at = now() where customer_id = $1 and stall_id = $2 and revoked_at is null',
        [customerId, actor.stallId],
      )
      for (const goodsId of grantedGoodsIds) await client.query(
        `insert into customer_goods_grants (stall_id, customer_id, goods_id, revoked_at)
         values ($1, $2, $3, null) on conflict (customer_id, goods_id) do update set revoked_at = null`,
        [actor.stallId, customerId, goodsId],
      )
      await client.query(
        `insert into audit_entries (stall_id, staff_id, action, subject_type, subject_id, summary)
         values ($1, $2, 'customer.settings_changed', 'customer', $3, $4)`,
        [actor.stallId, actor.staffId, customerId,
          { active: input.active, coefficientBps, groupCount: groupIds.length, grantCount: grantedGoodsIds.length }],
      )
      const result = { ...changed.rows[0], groupIds, grantedGoodsIds }
      await this.saveIdempotent(client, actor.stallId, requestId, settings, result)
      return result
    })
  }

  async updateCustomerOverride(
    stallSlug: string, staffCode: string, customerId: string, goodsId: string,
    input: Record<string, unknown>, requestId: string,
  ) {
    const customerVersion = Number(input.customerVersion)
    const priceCents = input.priceCents === null ? null : cents(input.priceCents, '单客商品价')
    if (!uuid(customerId) || !uuid(goodsId) || !Number.isSafeInteger(customerVersion) || customerVersion < 1) {
      throw new HttpError(400, '单客商品价格式错误')
    }
    requireRequestId(requestId)
    const settings = { customerId, goodsId, customerVersion, priceCents }
    return this.transaction(async (client) => {
      const actor = await this.authorize(client, stallSlug, staffCode,
        ['customer.manage', 'price.list.edit', 'price.floor.edit'])
      const prior = await this.idempotent(client, actor.stallId, requestId, settings)
      if (prior) return prior
      const changed = await client.query(
        `update customers set version = version + 1, updated_at = now()
         where id = $1 and stall_id = $2 and version = $3 returning version`,
        [customerId, actor.stallId, customerVersion],
      )
      if (!changed.rowCount) throw new HttpError(409, '客户版本冲突或不存在')
      const goods = await client.query('select id from goods where id = $1 and stall_id = $2', [goodsId, actor.stallId])
      if (!goods.rowCount) throw new HttpError(400, '商品不存在或跨档口')
      let override = null
      if (priceCents === null) {
        await client.query(
          'delete from customer_goods_overrides where customer_id = $1 and goods_id = $2 and stall_id = $3',
          [customerId, goodsId, actor.stallId],
        )
      } else {
        const saved = await client.query(
          `insert into customer_goods_overrides (stall_id, customer_id, goods_id, price_cents)
           values ($1, $2, $3, $4)
           on conflict (customer_id, goods_id) do update
             set price_cents = excluded.price_cents, version = customer_goods_overrides.version + 1
           returning goods_id as "goodsId", price_cents::double precision as "priceCents", version`,
          [actor.stallId, customerId, goodsId, priceCents],
        )
        override = saved.rows[0]
      }
      await client.query(
        `insert into audit_entries (stall_id, staff_id, action, subject_type, subject_id, summary)
         values ($1, $2, 'customer.override_changed', 'customer', $3, $4)`,
        [actor.stallId, actor.staffId, customerId, { goodsId, hasOverride: priceCents !== null }],
      )
      const result = { customerId, customerVersion: changed.rows[0].version, override }
      await this.saveIdempotent(client, actor.stallId, requestId, settings, result)
      return result
    })
  }

  async createBatchDraft(
    stallSlug: string, staffCode: string, titleValue: unknown, goodsIds: string[], requestId: string,
  ) {
    if (!Array.isArray(goodsIds) || !goodsIds.length || new Set(goodsIds).size !== goodsIds.length
      || goodsIds.some((id) => !uuid(id))) {
      throw new HttpError(400, 'goodsIds 必须是非空 UUID 数组')
    }
    const title = requiredText(titleValue, '批次名称', 100)
    requireRequestId(requestId)
    const input = { title, goodsIds }
    return this.transaction(async (client) => {
      const actor = await this.authorize(client, stallSlug, staffCode, ['media.publish'])
      const prior = await this.idempotent(client, actor.stallId, requestId, input)
      if (prior) return prior
      const valid = await client.query(
        `select id from goods where stall_id = $1 and status = 'in_stock' and id = any($2::uuid[])`,
        [actor.stallId, goodsIds],
      )
      if (valid.rowCount !== goodsIds.length) throw new HttpError(400, '批次含不可售或跨档口货品')
      const batch = await client.query(
        `insert into batches (stall_id, title, status)
         values ($1, $2, 'draft') returning id, title, status, version`,
        [actor.stallId, title],
      )
      for (const [position, goodsId] of goodsIds.entries()) {
        await client.query('insert into batch_items (stall_id, batch_id, goods_id, position) values ($1, $2, $3, $4)',
          [actor.stallId, batch.rows[0].id, goodsId, position])
      }
      await client.query(
        `insert into audit_entries (stall_id, staff_id, action, subject_type, subject_id, summary)
         values ($1, $2, 'batch.draft_created', 'batch', $3, $4)`,
        [actor.stallId, actor.staffId, batch.rows[0].id, { goodsIds }],
      )
      await this.saveIdempotent(client, actor.stallId, requestId, input, batch.rows[0])
      return batch.rows[0]
    })
  }

  async publishBatch(
    stallSlug: string, staffCode: string, batchId: string, version: number, requestId: string,
  ) {
    if (!uuid(batchId) || !Number.isSafeInteger(version) || version < 1) throw new HttpError(400, '批次或版本格式错误')
    requireRequestId(requestId)
    const input = { batchId, version }
    return this.transaction(async (client) => {
      const actor = await this.authorize(client, stallSlug, staffCode, ['media.publish'])
      const prior = await this.idempotent(client, actor.stallId, requestId, input)
      if (prior) return prior
      const batch = await client.query(
        `select id, status, version from batches where id = $1 and stall_id = $2 for update`,
        [batchId, actor.stallId],
      )
      if (!batch.rowCount) throw new HttpError(404, '批次不存在')
      if (batch.rows[0].status !== 'draft') throw new HttpError(409, '批次已发布或撤销')
      if (batch.rows[0].version !== version) throw new HttpError(409, '批次版本冲突')
      const readiness = await client.query(
        `select bool_and(g.status = 'in_stock'
          and exists (select 1 from media_assets m where m.goods_id = g.id and m.review_status = 'approved')
          and not exists (select 1 from media_assets m where m.goods_id = g.id and m.review_status <> 'approved')) ready
         from batch_items bi join goods g on g.id = bi.goods_id
         where bi.batch_id = $1 and bi.stall_id = $2`,
        [batchId, actor.stallId],
      )
      if (!readiness.rows[0]?.ready) throw new HttpError(400, '批次含不可售或媒体未全部审核通过的货品')
      const published = await client.query(
        `update batches set status = 'published', version = version + 1, published_at = now()
         where id = $1 and stall_id = $2 and version = $3
         returning id, title, status, version, published_at`,
        [batchId, actor.stallId, version],
      )
      await client.query(
        `insert into audit_entries (stall_id, staff_id, action, subject_type, subject_id)
         values ($1, $2, 'batch.published', 'batch', $3)`,
        [actor.stallId, actor.staffId, batchId],
      )
      await this.saveIdempotent(client, actor.stallId, requestId, input, published.rows[0])
      return published.rows[0]
    })
  }

  private async authorize(client: PoolClient, stallSlug: string, staffCode: string, needed: Permission[]) {
    if (needed.some((permission) => !permissions.includes(permission))) throw new HttpError(403, '未知权限')
    const result = await client.query(
      `select s.id staff_id, s.stall_id, s.role from staff s join stalls st on st.id = s.stall_id
       where st.slug = $1 and s.code = $2 and s.active
       and (s.role = 'owner' or (select count(*) from staff_permissions p
         where p.staff_id = s.id and p.permission = any($3::text[])) = cardinality($3::text[]))`,
      [stallSlug, staffCode, needed],
    )
    if (!result.rowCount) throw new HttpError(403, '无权限')
    return { staffId: result.rows[0].staff_id as string, stallId: result.rows[0].stall_id as string,
      role: result.rows[0].role as 'owner' | 'assistant' }
  }

  private async pricePermissions(
    client: PoolClient, actor: { staffId: string; role: 'owner' | 'assistant' },
  ): Promise<Set<Permission>> {
    if (actor.role === 'owner') return new Set(permissions.filter((permission) => permission.startsWith('price.')))
    const result = await client.query(
      `select permission from staff_permissions
       where staff_id = $1 and permission = any($2::text[])`,
      [actor.staffId, permissions.filter((permission) => permission.startsWith('price.'))],
    )
    return new Set(result.rows.map((row) => row.permission as Permission))
  }

  private async authorizeOwner(client: PoolClient, stallSlug: string, staffCode: string) {
    const result = await client.query(
      `select s.id staff_id, s.stall_id from staff s join stalls st on st.id = s.stall_id
       where st.slug = $1 and s.code = $2 and s.role = 'owner' and s.active`,
      [stallSlug, staffCode],
    )
    if (!result.rowCount) throw new HttpError(403, '仅老板可配置员工权限')
    return { staffId: result.rows[0].staff_id as string, stallId: result.rows[0].stall_id as string }
  }

  private async idempotent(client: PoolClient, stallId: string, requestId: string, input: unknown) {
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`${stallId}:${requestId}`])
    const result = await client.query(
      'select request_hash, response_body from idempotency_keys where stall_id = $1 and request_id = $2 for update',
      [stallId, requestId],
    )
    if (!result.rowCount) return null
    if (result.rows[0].request_hash !== digest) throw new HttpError(409, '请求标识已用于不同内容')
    return result.rows[0].response_body
  }

  private async saveIdempotent(client: PoolClient, stallId: string, requestId: string, input: unknown, response: unknown) {
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    await client.query(
      `insert into idempotency_keys (stall_id, request_id, request_hash, response_body)
       values ($1, $2, $3, $4)`,
      [stallId, requestId, digest, response],
    )
  }

  private async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      const result = await run(client)
      await client.query('commit')
      return result
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }
}

export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function requiredText(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, `${label}格式错误`)
  return value.trim()
}

function optionalText(value: unknown, label: string, max: number) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.trim().length > max) throw new HttpError(400, `${label}格式错误`)
  return value.trim() || null
}

function cents(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MAX_PRICE_CENTS) {
    throw new HttpError(400, `${label}必须是安全范围内的非负整数分`)
  }
  return Number(value)
}

function requireRequestId(value: string) {
  if (value.length < 8 || value.length > 200) throw new HttpError(400, '缺少有效 Idempotency-Key')
}

function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function uuidArray(value: unknown): value is string[] {
  return Array.isArray(value) && new Set(value).size === value.length && value.every((item) => typeof item === 'string' && uuid(item))
}
