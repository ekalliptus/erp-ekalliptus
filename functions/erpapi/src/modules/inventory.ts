import {
  createItemSchema,
  createMovementSchema,
  createPurchaseOrderSchema,
  createSupplierSchema,
  createWarehouseSchema,
  updateItemSchema,
} from '@ekalliptus/contracts';
import {
  inventory_items,
  inventory_stocks,
  purchase_orders,
  stock_movements,
  suppliers,
  warehouses,
} from '@ekalliptus/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb, jsonSafe } from '../db.js';
import { emitErpEvent, writeAuditLog } from '../middleware/audit.js';
import { requirePermission } from '../middleware/rbac.js';
import { notifyUsersInTx, resolveModuleViewers } from '../services/notify.js';
import type { AppEnv } from '../types.js';
import type { ErpModulePlugin } from './plugin.js';

class HttpStatusError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

const router = new Hono<AppEnv>();

router.get('/warehouses', requirePermission('inventory', 'view'), async (c) => {
  const rows = await getDb().select().from(warehouses).orderBy(warehouses.name);
  return c.json({ warehouses: jsonSafe(rows) });
});

router.post('/warehouses', requirePermission('inventory', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createWarehouseSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const auth = c.get('auth');
  const [wh] = await getDb().insert(warehouses).values(parsed.data).returning();
  await writeAuditLog(getDb(), {
    actorId: auth.employee.id,
    platform: auth.platform,
    module: 'inventory',
    action: 'create_warehouse',
    entityId: wh.id,
    afterData: wh,
  });
  return c.json({ warehouse: jsonSafe(wh) }, 201);
});

router.get('/items', requirePermission('inventory', 'view'), async (c) => {
  const rows = await getDb()
    .select()
    .from(inventory_items)
    .orderBy(desc(inventory_items.created_at));
  return c.json({ items: jsonSafe(rows) });
});

router.post('/items', requirePermission('inventory', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createItemSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const auth = c.get('auth');

  const [item] = await getDb()
    .insert(inventory_items)
    .values({
      sku: parsed.data.sku,
      barcode: parsed.data.barcode ?? null,
      name: parsed.data.name,
      unit: parsed.data.unit,
      cost_price: parsed.data.cost_price,
      sell_price: parsed.data.sell_price,
      min_stock: parsed.data.min_stock,
      image_object_key: parsed.data.image_object_key ?? null,
    })
    .returning();

  await writeAuditLog(getDb(), {
    actorId: auth.employee.id,
    platform: auth.platform,
    module: 'inventory',
    action: 'create_item',
    entityId: item.id,
    afterData: item,
  });
  return c.json({ item: jsonSafe(item) }, 201);
});

router.patch('/items/:id', requirePermission('inventory', 'update'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing item id.' }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = updateItemSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const auth = c.get('auth');
  const db = getDb();

  const [before] = await db
    .select()
    .from(inventory_items)
    .where(eq(inventory_items.id, id))
    .limit(1);
  if (!before) return c.json({ error: 'Item not found.' }, 404);

  const [updated] = await db
    .update(inventory_items)
    .set(parsed.data)
    .where(eq(inventory_items.id, id))
    .returning();

  await writeAuditLog(db, {
    actorId: auth.employee.id,
    platform: auth.platform,
    module: 'inventory',
    action: 'update_item',
    entityId: id,
    beforeData: before,
    afterData: updated,
  });
  return c.json({ item: jsonSafe(updated) });
});

router.get('/stocks', requirePermission('inventory', 'view'), async (c) => {
  const rows = await getDb()
    .select({
      item_id: inventory_items.id,
      sku: inventory_items.sku,
      barcode: inventory_items.barcode,
      name: inventory_items.name,
      unit: inventory_items.unit,
      cost_price: inventory_items.cost_price,
      sell_price: inventory_items.sell_price,
      min_stock: inventory_items.min_stock,
      image_object_key: inventory_items.image_object_key,
      is_active: inventory_items.is_active,
      warehouse_id: warehouses.id,
      warehouse_name: warehouses.name,
      qty: sql<number>`coalesce(${inventory_stocks.qty}, 0)`,
      is_low_stock: sql<boolean>`coalesce(${inventory_stocks.qty}, 0) <= ${inventory_items.min_stock}`,
    })
    .from(inventory_items)
    .innerJoin(inventory_stocks, eq(inventory_stocks.item_id, inventory_items.id))
    .innerJoin(warehouses, eq(warehouses.id, inventory_stocks.warehouse_id))
    .orderBy(inventory_items.name);

  return c.json({ stocks: jsonSafe(rows) });
});

router.get('/movements', requirePermission('inventory', 'view'), async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 300);
  const rows = await getDb()
    .select({
      id: stock_movements.id,
      item_id: stock_movements.item_id,
      item_name: inventory_items.name,
      sku: inventory_items.sku,
      warehouse_id: stock_movements.warehouse_id,
      warehouse_name: warehouses.name,
      movement_type: stock_movements.movement_type,
      qty_delta: stock_movements.qty_delta,
      unit_cost: stock_movements.unit_cost,
      note: stock_movements.note,
      created_by: stock_movements.created_by,
      created_at: stock_movements.created_at,
    })
    .from(stock_movements)
    .innerJoin(inventory_items, eq(inventory_items.id, stock_movements.item_id))
    .innerJoin(warehouses, eq(warehouses.id, stock_movements.warehouse_id))
    .orderBy(desc(stock_movements.created_at))
    .limit(limit);

  return c.json({ movements: jsonSafe(rows) });
});

router.post('/movements', requirePermission('inventory', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createMovementSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const data = parsed.data;
  const db = getDb();

  try {
    const result = await db.transaction(async (tx) => {
      const [item] = await tx
        .select()
        .from(inventory_items)
        .where(eq(inventory_items.id, data.item_id))
        .limit(1);
      if (!item) throw new HttpStatusError(404, 'Inventory item not found.');

      const [wh] = await tx
        .select()
        .from(warehouses)
        .where(eq(warehouses.id, data.warehouse_id))
        .limit(1);
      if (!wh) throw new HttpStatusError(404, 'Warehouse not found.');

      await tx
        .insert(inventory_stocks)
        .values({ item_id: data.item_id, warehouse_id: data.warehouse_id, qty: 0 })
        .onConflictDoNothing({ target: [inventory_stocks.item_id, inventory_stocks.warehouse_id] });

      const [stockRow] = await tx
        .select()
        .from(inventory_stocks)
        .where(
          and(
            eq(inventory_stocks.item_id, data.item_id),
            eq(inventory_stocks.warehouse_id, data.warehouse_id),
          ),
        )
        .for('update');

      const currentQty = stockRow?.qty ?? 0;
      const unitCost = data.unit_cost ?? item.cost_price;

      if (data.movement_type === 'transfer' && data.target_warehouse_id) {
        const [targetWh] = await tx
          .select()
          .from(warehouses)
          .where(eq(warehouses.id, data.target_warehouse_id))
          .limit(1);
        if (!targetWh) throw new HttpStatusError(404, 'Target warehouse not found.');

        if (currentQty < data.qty) {
          throw new HttpStatusError(400, `Insufficient stock in ${wh.name} (${currentQty} < ${data.qty}).`);
        }

        await tx
          .insert(inventory_stocks)
          .values({ item_id: data.item_id, warehouse_id: data.target_warehouse_id, qty: 0 })
          .onConflictDoNothing({
            target: [inventory_stocks.item_id, inventory_stocks.warehouse_id],
          });

        const [targetStock] = await tx
          .select()
          .from(inventory_stocks)
          .where(
            and(
              eq(inventory_stocks.item_id, data.item_id),
              eq(inventory_stocks.warehouse_id, data.target_warehouse_id),
            ),
          )
          .for('update');

        const nextSourceQty = currentQty - data.qty;
        const nextTargetQty = (targetStock?.qty ?? 0) + data.qty;

        await tx
          .update(inventory_stocks)
          .set({ qty: nextSourceQty })
          .where(
            and(
              eq(inventory_stocks.item_id, data.item_id),
              eq(inventory_stocks.warehouse_id, data.warehouse_id),
            ),
          );
        await tx
          .update(inventory_stocks)
          .set({ qty: nextTargetQty })
          .where(
            and(
              eq(inventory_stocks.item_id, data.item_id),
              eq(inventory_stocks.warehouse_id, data.target_warehouse_id),
            ),
          );

        const [outMove] = await tx
          .insert(stock_movements)
          .values({
            item_id: data.item_id,
            warehouse_id: data.warehouse_id,
            movement_type: 'transfer',
            qty_delta: -data.qty,
            unit_cost: unitCost,
            note: data.note ?? `Transfer ke ${targetWh.name}`,
            created_by: auth.employee.id,
          })
          .returning();

        const [inMove] = await tx
          .insert(stock_movements)
          .values({
            item_id: data.item_id,
            warehouse_id: data.target_warehouse_id,
            movement_type: 'transfer',
            qty_delta: data.qty,
            unit_cost: unitCost,
            note: data.note ?? `Transfer dari ${wh.name}`,
            created_by: auth.employee.id,
          })
          .returning();

        const isLow = nextSourceQty <= item.min_stock;
        await writeAuditLog(tx, {
          actorId: auth.employee.id,
          platform: auth.platform,
          module: 'inventory',
          action: 'transfer_stock',
          entityId: outMove.id,
          beforeData: { source_qty: currentQty, target_qty: targetStock?.qty ?? 0 },
          afterData: { source_qty: nextSourceQty, target_qty: nextTargetQty, movement: outMove },
        });
        await emitErpEvent(tx, 'erp:inventory', isLow ? 'low_stock_alert' : 'stock_transferred', {
          item_id: item.id,
          sku: item.sku,
          warehouse_id: wh.id,
          qty: nextSourceQty,
          min_stock: item.min_stock,
          low_stock: isLow,
        });

        const inventoryViewers = await resolveModuleViewers(tx, 'inventory');
        await notifyUsersInTx(tx, {
          module: 'inventory',
          eventType: 'stock_transferred',
          title: 'Stok dipindahkan',
          body: `${item.name} (${item.sku}): ${data.qty} unit dari ${wh.name} ke ${targetWh.name}.${isLow ? ` Stok sumber menipis (${nextSourceQty}).` : ''}`,
          recipients: inventoryViewers,
          excludeAuthUserId: auth.authUserId,
          actorEmployeeId: auth.employee.id,
          entityId: outMove.id,
        });

        return { movement: outMove, paired: inMove, qty: nextSourceQty, low_stock_alert: isLow };
      }

      const delta =
        data.movement_type === 'in'
          ? data.qty
          : data.movement_type === 'out'
            ? -data.qty
            : data.qty;

      const nextQty = currentQty + delta;
      if (nextQty < 0) {
        throw new HttpStatusError(400, `Insufficient stock in ${wh.name} (${currentQty} + ${delta} < 0).`);
      }

      await tx
        .update(inventory_stocks)
        .set({ qty: nextQty })
        .where(
          and(
            eq(inventory_stocks.item_id, data.item_id),
            eq(inventory_stocks.warehouse_id, data.warehouse_id),
          ),
        );

      const [movement] = await tx
        .insert(stock_movements)
        .values({
          item_id: data.item_id,
          warehouse_id: data.warehouse_id,
          movement_type: data.movement_type,
          qty_delta: delta,
          unit_cost: unitCost,
          note: data.note ?? null,
          created_by: auth.employee.id,
        })
        .returning();

      const isLow = nextQty <= item.min_stock;
      await writeAuditLog(tx, {
        actorId: auth.employee.id,
        platform: auth.platform,
        module: 'inventory',
        action: `stock_${data.movement_type}`,
        entityId: movement.id,
        beforeData: { qty: currentQty },
        afterData: { qty: nextQty, movement },
      });

      await emitErpEvent(tx, 'erp:inventory', isLow ? 'low_stock_alert' : 'stock_updated', {
        item_id: item.id,
        sku: item.sku,
        name: item.name,
        warehouse_id: wh.id,
        qty: nextQty,
        min_stock: item.min_stock,
        low_stock: isLow,
      });

      const inventoryViewers = await resolveModuleViewers(tx, 'inventory');
      await notifyUsersInTx(tx, {
        module: 'inventory',
        eventType: isLow ? 'low_stock_alert' : 'stock_updated',
        title:
          data.movement_type === 'in'
            ? 'Stok masuk dicatat'
            : data.movement_type === 'out'
              ? 'Stok keluar dicatat'
              : 'Penyesuaian stok dicatat',
        body: `${item.name} (${item.sku}) di ${wh.name}: ${nextQty} unit.${isLow ? ` Menyentuh batas minimum (${item.min_stock}).` : ''}`,
        recipients: inventoryViewers,
        excludeAuthUserId: auth.authUserId,
        actorEmployeeId: auth.employee.id,
        entityId: movement.id,
      });

      return { movement, qty: nextQty, low_stock_alert: isLow };
    });

    return c.json(jsonSafe(result), 201);
  } catch (err) {
    if (err instanceof HttpStatusError) {
      return c.json({ error: err.message }, err.status);
    }
    throw err;
  }
});

router.get('/suppliers', requirePermission('inventory', 'view'), async (c) => {
  const rows = await getDb().select().from(suppliers).orderBy(suppliers.name);
  return c.json({ suppliers: jsonSafe(rows) });
});

router.post('/suppliers', requirePermission('inventory', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSupplierSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const auth = c.get('auth');
  const [sup] = await getDb().insert(suppliers).values(parsed.data).returning();
  await writeAuditLog(getDb(), {
    actorId: auth.employee.id,
    platform: auth.platform,
    module: 'inventory',
    action: 'create_supplier',
    entityId: sup.id,
    afterData: sup,
  });
  return c.json({ supplier: jsonSafe(sup) }, 201);
});

router.get('/purchase-orders', requirePermission('inventory', 'view'), async (c) => {
  const rows = await getDb()
    .select({
      id: purchase_orders.id,
      po_number: purchase_orders.po_number,
      supplier_id: purchase_orders.supplier_id,
      supplier_name: suppliers.name,
      warehouse_id: purchase_orders.warehouse_id,
      warehouse_name: warehouses.name,
      status: purchase_orders.status,
      total_amount: purchase_orders.total_amount,
      note: purchase_orders.note,
      created_at: purchase_orders.created_at,
    })
    .from(purchase_orders)
    .innerJoin(suppliers, eq(suppliers.id, purchase_orders.supplier_id))
    .innerJoin(warehouses, eq(warehouses.id, purchase_orders.warehouse_id))
    .orderBy(desc(purchase_orders.created_at));
  return c.json({ purchase_orders: jsonSafe(rows) });
});

router.post('/purchase-orders', requirePermission('inventory', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createPurchaseOrderSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const auth = c.get('auth');
  const poNumber =
    parsed.data.po_number ||
    `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

  const [po] = await getDb()
    .insert(purchase_orders)
    .values({
      po_number: poNumber,
      supplier_id: parsed.data.supplier_id,
      warehouse_id: parsed.data.warehouse_id,
      status: 'ordered',
      total_amount: parsed.data.total_amount,
      note: parsed.data.note ?? null,
      created_by: auth.employee.id,
    })
    .returning();

  await writeAuditLog(getDb(), {
    actorId: auth.employee.id,
    platform: auth.platform,
    module: 'inventory',
    action: 'create_purchase_order',
    entityId: po.id,
    afterData: po,
  });
  return c.json({ purchase_order: jsonSafe(po) }, 201);
});

const receivePoBodySchema = z.object({
  items: z
    .array(
      z.object({
        item_id: z.string().uuid(),
        qty: z.number().int().positive(),
        unit_cost: z
          .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
          .transform((v) => BigInt(v))
          .optional(),
      }),
    )
    .optional()
    .default([]),
});

router.post('/purchase-orders/:id/receive', requirePermission('inventory', 'approve'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing purchase order id.' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const parsed = receivePoBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const db = getDb();

  try {
    const received = await db.transaction(async (tx) => {
      const [po] = await tx
        .select()
        .from(purchase_orders)
        .where(eq(purchase_orders.id, id))
        .for('update');
      if (!po) throw new HttpStatusError(404, 'Purchase order not found.');
      if (po.status === 'received' || po.status === 'cancelled') {
        throw new HttpStatusError(400, `Purchase order is already ${po.status}.`);
      }

      for (const line of parsed.data.items) {
        const [item] = await tx
          .select()
          .from(inventory_items)
          .where(eq(inventory_items.id, line.item_id))
          .limit(1);
        if (!item) throw new HttpStatusError(404, `Item ${line.item_id} not found.`);

        await tx
          .insert(inventory_stocks)
          .values({ item_id: line.item_id, warehouse_id: po.warehouse_id, qty: 0 })
          .onConflictDoNothing({
            target: [inventory_stocks.item_id, inventory_stocks.warehouse_id],
          });

        const [stock] = await tx
          .select()
          .from(inventory_stocks)
          .where(
            and(
              eq(inventory_stocks.item_id, line.item_id),
              eq(inventory_stocks.warehouse_id, po.warehouse_id),
            ),
          )
          .for('update');

        const nextQty = (stock?.qty ?? 0) + line.qty;
        await tx
          .update(inventory_stocks)
          .set({ qty: nextQty })
          .where(
            and(
              eq(inventory_stocks.item_id, line.item_id),
              eq(inventory_stocks.warehouse_id, po.warehouse_id),
            ),
          );

        await tx.insert(stock_movements).values({
          item_id: line.item_id,
          warehouse_id: po.warehouse_id,
          movement_type: 'in',
          qty_delta: line.qty,
          unit_cost: line.unit_cost ?? item.cost_price,
          note: `Penerimaan PO ${po.po_number}`,
          created_by: auth.employee.id,
        });
      }

      const [updatedPo] = await tx
        .update(purchase_orders)
        .set({ status: 'received' })
        .where(eq(purchase_orders.id, po.id))
        .returning();

      await writeAuditLog(tx, {
        actorId: auth.employee.id,
        platform: auth.platform,
        module: 'inventory',
        action: 'receive_purchase_order',
        entityId: po.id,
        beforeData: po,
        afterData: updatedPo,
      });

      await emitErpEvent(tx, 'erp:inventory', 'po_received', {
        po_id: po.id,
        po_number: po.po_number,
        items_count: parsed.data.items.length,
      });

      const inventoryViewers = await resolveModuleViewers(tx, 'inventory');
      await notifyUsersInTx(tx, {
        module: 'inventory',
        eventType: 'po_received',
        title: 'PO diterima',
        body: `Purchase order ${po.po_number} diterima (${parsed.data.items.length} item).`,
        recipients: inventoryViewers,
        excludeAuthUserId: auth.authUserId,
        actorEmployeeId: auth.employee.id,
        entityId: po.id,
      });

      return updatedPo;
    });

    return c.json({ purchase_order: jsonSafe(received) });
  } catch (err) {
    if (err instanceof HttpStatusError) {
      return c.json({ error: err.message }, err.status);
    }
    throw err;
  }
});

export const inventoryPlugin: ErpModulePlugin = {
  id: 'inventory',
  basePath: '/inventory',
  router,
};
