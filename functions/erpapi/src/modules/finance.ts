import {
  createAccountSchema,
  createCategorySchema,
  createObligationSchema,
  createPosSaleSchema,
  createTransactionSchema,
  payObligationSchema,
  voidPosSaleSchema,
} from '@ekalliptus/contracts';
import {
  employees,
  finance_accounts,
  finance_categories,
  finance_obligations,
  finance_transactions,
  inventory_items,
  inventory_stocks,
  pos_sale_items,
  pos_sales,
  stock_movements,
  warehouses,
} from '@ekalliptus/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import crypto from 'node:crypto';
import { getDb, jsonSafe, txidExpr } from '../db.js';
import { emitErpEvent, writeAuditLog } from '../middleware/audit.js';
import { requirePermission } from '../middleware/rbac.js';
import { generateInvoicePdf, generatePosReceiptPdf } from '../services/pdf.js';
import { formatRupiah, notifyUsersInTx, resolveModuleViewers } from '../services/notify.js';
import { createPresignedDownloadUrl, uploadObject } from '../services/storage.js';
import type { AppEnv } from '../types.js';
import type { ErpModulePlugin } from './plugin.js';

const router = new Hono<AppEnv>();

router.get('/accounts', requirePermission('finance', 'view'), async (c) => {
  const rows = await getDb()
    .select()
    .from(finance_accounts)
    .orderBy(finance_accounts.name);
  return c.json({ accounts: jsonSafe(rows) });
});

router.post('/accounts', requirePermission('finance', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createAccountSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const auth = c.get('auth');
  const db = getDb();
  const data = parsed.data;

  const created = await db.transaction(async (tx) => {
    const [acc] = await tx
      .insert(finance_accounts)
      .values({
        name: data.name,
        type: data.type,
        account_number: data.account_number ?? null,
        balance: data.initial_balance,
      })
      .returning();

    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'finance',
      action: 'create_account',
      entityId: acc.id,
      afterData: acc,
    });
    await emitErpEvent(tx, 'erp:finance', 'account_created', { account_id: acc.id, name: acc.name });
    return acc;
  });

  return c.json({ account: jsonSafe(created) }, 201);
});

router.get('/categories', requirePermission('finance', 'view'), async (c) => {
  const rows = await getDb()
    .select()
    .from(finance_categories)
    .orderBy(finance_categories.kind, finance_categories.name);
  return c.json({ categories: jsonSafe(rows) });
});

router.post('/categories', requirePermission('finance', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createCategorySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const auth = c.get('auth');
  const [cat] = await getDb()
    .insert(finance_categories)
    .values(parsed.data)
    .returning();
  await writeAuditLog(getDb(), {
    actorId: auth.employee.id,
    platform: auth.platform,
    module: 'finance',
    action: 'create_category',
    entityId: cat.id,
    afterData: cat,
  });
  return c.json({ category: jsonSafe(cat) }, 201);
});

router.get('/transactions', requirePermission('finance', 'view'), async (c) => {
  const statusFilter = c.req.query('status');
  const typeFilter = c.req.query('type');
  const accountId = c.req.query('account_id');
  const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 300);

  const conditions = [];
  if (statusFilter === 'pending' || statusFilter === 'posted' || statusFilter === 'void') {
    conditions.push(eq(finance_transactions.status, statusFilter));
  }
  if (typeFilter === 'income' || typeFilter === 'expense' || typeFilter === 'transfer') {
    conditions.push(eq(finance_transactions.type, typeFilter));
  }
  if (accountId) {
    conditions.push(eq(finance_transactions.account_id, accountId));
  }

  const rows = await getDb()
    .select({
      id: finance_transactions.id,
      account_id: finance_transactions.account_id,
      target_account_id: finance_transactions.target_account_id,
      category_id: finance_transactions.category_id,
      type: finance_transactions.type,
      amount: finance_transactions.amount,
      description: finance_transactions.description,
      reference_type: finance_transactions.reference_type,
      reference_id: finance_transactions.reference_id,
      receipt_object_key: finance_transactions.receipt_object_key,
      status: finance_transactions.status,
      created_by: finance_transactions.created_by,
      approved_by: finance_transactions.approved_by,
      transacted_at: finance_transactions.transacted_at,
      account_name: finance_accounts.name,
      category_name: finance_categories.name,
    })
    .from(finance_transactions)
    .innerJoin(finance_accounts, eq(finance_accounts.id, finance_transactions.account_id))
    .leftJoin(finance_categories, eq(finance_categories.id, finance_transactions.category_id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(finance_transactions.transacted_at))
    .limit(limit);

  return c.json({ transactions: jsonSafe(rows) });
});

router.post('/transactions', requirePermission('finance', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createTransactionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const auth = c.get('auth');
  const data = parsed.data;
  const db = getDb();

  try {
    const result = await db.transaction(async (tx) => {
      const lockIds =
        data.type === 'transfer' && data.target_account_id
          ? [data.account_id, data.target_account_id].sort()
          : [data.account_id];

      const lockedAccounts = new Map<string, { id: string; name: string; balance: bigint }>();
      for (const accId of lockIds) {
        const [acc] = await tx
          .select({
            id: finance_accounts.id,
            name: finance_accounts.name,
            balance: finance_accounts.balance,
          })
          .from(finance_accounts)
          .where(eq(finance_accounts.id, accId))
          .for('update');
        if (!acc) {
          throw new HttpStatusError(404, `Finance account ${accId} not found.`);
        }
        lockedAccounts.set(accId, acc);
      }

      const sourceAcc = lockedAccounts.get(data.account_id)!;
      const beforeBalances: Record<string, string> = {
        [sourceAcc.id]: sourceAcc.balance.toString(),
      };
      const afterBalances: Record<string, string> = {};

      if (data.status === 'posted') {
        if (data.type === 'income') {
          const nextBal = sourceAcc.balance + data.amount;
          await tx
            .update(finance_accounts)
            .set({ balance: nextBal })
            .where(eq(finance_accounts.id, sourceAcc.id));
          afterBalances[sourceAcc.id] = nextBal.toString();
        } else if (data.type === 'expense') {
          if (sourceAcc.balance < data.amount) {
            throw new HttpStatusError(
              400,
              `Insufficient balance in ${sourceAcc.name} (${sourceAcc.balance.toString()} < ${data.amount.toString()}).`,
            );
          }
          const nextBal = sourceAcc.balance - data.amount;
          await tx
            .update(finance_accounts)
            .set({ balance: nextBal })
            .where(eq(finance_accounts.id, sourceAcc.id));
          afterBalances[sourceAcc.id] = nextBal.toString();
        } else if (data.type === 'transfer' && data.target_account_id) {
          const targetAcc = lockedAccounts.get(data.target_account_id)!;
          beforeBalances[targetAcc.id] = targetAcc.balance.toString();
          if (sourceAcc.balance < data.amount) {
            throw new HttpStatusError(
              400,
              `Insufficient balance in ${sourceAcc.name} for transfer.`,
            );
          }
          const nextSource = sourceAcc.balance - data.amount;
          const nextTarget = targetAcc.balance + data.amount;
          await tx
            .update(finance_accounts)
            .set({ balance: nextSource })
            .where(eq(finance_accounts.id, sourceAcc.id));
          await tx
            .update(finance_accounts)
            .set({ balance: nextTarget })
            .where(eq(finance_accounts.id, targetAcc.id));
          afterBalances[sourceAcc.id] = nextSource.toString();
          afterBalances[targetAcc.id] = nextTarget.toString();
        }
      }

      const [inserted] = await tx
        .insert(finance_transactions)
        .values({
          account_id: data.account_id,
          target_account_id: data.type === 'transfer' ? (data.target_account_id ?? null) : null,
          category_id: data.category_id ?? null,
          type: data.type,
          amount: data.amount,
          description: data.description,
          reference_type: data.reference_type ?? null,
          reference_id: data.reference_id ?? null,
          receipt_object_key: data.receipt_object_key ?? null,
          status: data.status,
          created_by: auth.employee.id,
          approved_by: data.status === 'posted' ? auth.employee.id : null,
        })
        .returning({
          id: finance_transactions.id,
          account_id: finance_transactions.account_id,
          target_account_id: finance_transactions.target_account_id,
          category_id: finance_transactions.category_id,
          type: finance_transactions.type,
          amount: finance_transactions.amount,
          description: finance_transactions.description,
          status: finance_transactions.status,
          receipt_object_key: finance_transactions.receipt_object_key,
          transacted_at: finance_transactions.transacted_at,
          txid: txidExpr,
        });

      await writeAuditLog(tx, {
        actorId: auth.employee.id,
        platform: auth.platform,
        module: 'finance',
        action: `create_${data.type}`,
        entityId: inserted.id,
        beforeData: { balances: beforeBalances },
        afterData: { transaction: inserted, balances: afterBalances },
      });

      await emitErpEvent(tx, 'erp:finance', 'transaction_recorded', {
        transaction_id: inserted.id,
        type: inserted.type,
        amount: inserted.amount.toString(),
        status: inserted.status,
        account_id: inserted.account_id,
        balances: afterBalances,
      });

      const financeViewers = await resolveModuleViewers(tx, 'finance');
      await notifyUsersInTx(tx, {
        module: 'finance',
        eventType: 'transaction_recorded',
        title:
          data.type === 'income'
            ? 'Kas masuk dicatat'
            : data.type === 'expense'
              ? 'Kas keluar dicatat'
              : 'Transfer antar kas dicatat',
        body: `${data.status === 'pending' ? 'Menunggu persetujuan: ' : ''}${sourceAcc.name}: ${formatRupiah(data.amount)}${data.description ? ` (${data.description})` : ''}`,
        recipients: financeViewers,
        excludeAuthUserId: auth.authUserId,
        actorEmployeeId: auth.employee.id,
        entityId: inserted.id,
      });

      return inserted;
    });

    return c.json({ transaction: jsonSafe(result), txid: result.txid }, 201);
  } catch (err) {
    if (err instanceof HttpStatusError) {
      return c.json({ error: err.message }, err.status);
    }
    throw err;
  }
});

router.post('/transactions/:id/approve', requirePermission('finance', 'approve'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing transaction id.' }, 400);
  const auth = c.get('auth');
  const db = getDb();

  try {
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(finance_transactions)
        .where(eq(finance_transactions.id, id))
        .for('update');
      if (!row) throw new HttpStatusError(404, 'Transaction not found.');
      if (row.status !== 'pending') {
        throw new HttpStatusError(400, `Cannot approve transaction in status ${row.status}.`);
      }

      const lockIds =
        row.type === 'transfer' && row.target_account_id
          ? [row.account_id, row.target_account_id].sort()
          : [row.account_id];
      const accounts = new Map<string, { id: string; name: string; balance: bigint }>();
      for (const accId of lockIds) {
        const [acc] = await tx
          .select({ id: finance_accounts.id, name: finance_accounts.name, balance: finance_accounts.balance })
          .from(finance_accounts)
          .where(eq(finance_accounts.id, accId))
          .for('update');
        if (!acc) throw new HttpStatusError(404, 'Account not found.');
        accounts.set(accId, acc);
      }

      const src = accounts.get(row.account_id)!;
      if (row.type === 'income') {
        await tx
          .update(finance_accounts)
          .set({ balance: src.balance + row.amount })
          .where(eq(finance_accounts.id, src.id));
      } else if (row.type === 'expense') {
        if (src.balance < row.amount) {
          throw new HttpStatusError(400, `Insufficient balance in ${src.name}.`);
        }
        await tx
          .update(finance_accounts)
          .set({ balance: src.balance - row.amount })
          .where(eq(finance_accounts.id, src.id));
      } else if (row.type === 'transfer' && row.target_account_id) {
        const dst = accounts.get(row.target_account_id)!;
        if (src.balance < row.amount) {
          throw new HttpStatusError(400, `Insufficient balance in ${src.name}.`);
        }
        await tx
          .update(finance_accounts)
          .set({ balance: src.balance - row.amount })
          .where(eq(finance_accounts.id, src.id));
        await tx
          .update(finance_accounts)
          .set({ balance: dst.balance + row.amount })
          .where(eq(finance_accounts.id, dst.id));
      }

      const [posted] = await tx
        .update(finance_transactions)
        .set({ status: 'posted', approved_by: auth.employee.id })
        .where(eq(finance_transactions.id, row.id))
        .returning({ id: finance_transactions.id, status: finance_transactions.status, txid: txidExpr });

      await writeAuditLog(tx, {
        actorId: auth.employee.id,
        platform: auth.platform,
        module: 'finance',
        action: 'approve_transaction',
        entityId: row.id,
        beforeData: row,
        afterData: posted,
      });

      await emitErpEvent(tx, 'erp:finance', 'transaction_approved', {
        transaction_id: row.id,
        amount: row.amount.toString(),
      });

      const financeViewers = await resolveModuleViewers(tx, 'finance');
      await notifyUsersInTx(tx, {
        module: 'finance',
        eventType: 'transaction_approved',
        title: 'Transaksi disetujui',
        body: `${row.type === 'transfer' ? 'Transfer' : row.type === 'income' ? 'Kas masuk' : 'Kas keluar'} ${formatRupiah(row.amount)} disetujui oleh ${auth.employee.full_name}.`,
        recipients: financeViewers,
        excludeAuthUserId: auth.authUserId,
        actorEmployeeId: auth.employee.id,
        entityId: row.id,
      });

      return posted;
    });

    return c.json({ transaction: jsonSafe(updated) });
  } catch (err) {
    if (err instanceof HttpStatusError) {
      return c.json({ error: err.message }, err.status);
    }
    throw err;
  }
});

router.post('/transactions/:id/void', requirePermission('finance', 'approve'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing transaction id.' }, 400);
  const auth = c.get('auth');
  const db = getDb();

  try {
    const voided = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(finance_transactions)
        .where(eq(finance_transactions.id, id))
        .for('update');
      if (!row) throw new HttpStatusError(404, 'Transaction not found.');
      if (row.status === 'void') {
        throw new HttpStatusError(400, 'Transaction is already void.');
      }

      if (row.status === 'posted') {
        const lockIds =
          row.type === 'transfer' && row.target_account_id
            ? [row.account_id, row.target_account_id].sort()
            : [row.account_id];
        const accounts = new Map<string, { id: string; name: string; balance: bigint }>();
        for (const accId of lockIds) {
          const [acc] = await tx
            .select({ id: finance_accounts.id, name: finance_accounts.name, balance: finance_accounts.balance })
            .from(finance_accounts)
            .where(eq(finance_accounts.id, accId))
            .for('update');
          if (!acc) throw new HttpStatusError(404, 'Account not found.');
          accounts.set(accId, acc);
        }

        const src = accounts.get(row.account_id)!;
        if (row.type === 'income') {
          if (src.balance < row.amount) {
            throw new HttpStatusError(400, `Cannot void income: ${src.name} balance is lower than amount.`);
          }
          await tx
            .update(finance_accounts)
            .set({ balance: src.balance - row.amount })
            .where(eq(finance_accounts.id, src.id));
        } else if (row.type === 'expense') {
          await tx
            .update(finance_accounts)
            .set({ balance: src.balance + row.amount })
            .where(eq(finance_accounts.id, src.id));
        } else if (row.type === 'transfer' && row.target_account_id) {
          const dst = accounts.get(row.target_account_id)!;
          if (dst.balance < row.amount) {
            throw new HttpStatusError(400, `Cannot void transfer: ${dst.name} balance is lower than amount.`);
          }
          await tx
            .update(finance_accounts)
            .set({ balance: src.balance + row.amount })
            .where(eq(finance_accounts.id, src.id));
          await tx
            .update(finance_accounts)
            .set({ balance: dst.balance - row.amount })
            .where(eq(finance_accounts.id, dst.id));
        }
      }

      const [res] = await tx
        .update(finance_transactions)
        .set({ status: 'void' })
        .where(eq(finance_transactions.id, row.id))
        .returning({ id: finance_transactions.id, status: finance_transactions.status, txid: txidExpr });

      await writeAuditLog(tx, {
        actorId: auth.employee.id,
        platform: auth.platform,
        module: 'finance',
        action: 'void_transaction',
        entityId: row.id,
        beforeData: row,
        afterData: res,
      });

      await emitErpEvent(tx, 'erp:finance', 'transaction_voided', {
        transaction_id: row.id,
      });

      const financeViewers = await resolveModuleViewers(tx, 'finance');
      await notifyUsersInTx(tx, {
        module: 'finance',
        eventType: 'transaction_voided',
        title: 'Transaksi dibatalkan',
        body: `${row.type === 'transfer' ? 'Transfer' : row.type === 'income' ? 'Kas masuk' : 'Kas keluar'} ${formatRupiah(row.amount)} dibatalkan oleh ${auth.employee.full_name}.`,
        recipients: financeViewers,
        excludeAuthUserId: auth.authUserId,
        actorEmployeeId: auth.employee.id,
        entityId: row.id,
      });

      return res;
    });

    return c.json({ transaction: jsonSafe(voided) });
  } catch (err) {
    if (err instanceof HttpStatusError) {
      return c.json({ error: err.message }, err.status);
    }
    throw err;
  }
});

router.get('/transactions/:id/invoice-pdf', requirePermission('finance', 'export'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing transaction id.' }, 400);
  const db = getDb();

  const [row] = await db
    .select({
      id: finance_transactions.id,
      type: finance_transactions.type,
      amount: finance_transactions.amount,
      description: finance_transactions.description,
      status: finance_transactions.status,
      transacted_at: finance_transactions.transacted_at,
      account_name: finance_accounts.name,
      category_name: finance_categories.name,
      creator_name: employees.full_name,
    })
    .from(finance_transactions)
    .innerJoin(finance_accounts, eq(finance_accounts.id, finance_transactions.account_id))
    .leftJoin(finance_categories, eq(finance_categories.id, finance_transactions.category_id))
    .innerJoin(employees, eq(employees.id, finance_transactions.created_by))
    .where(eq(finance_transactions.id, id))
    .limit(1);

  if (!row) {
    return c.json({ error: 'Transaction not found.' }, 404);
  }

  const pdfBytes = await generateInvoicePdf({
    id: row.id,
    accountName: row.account_name,
    categoryName: row.category_name,
    type: row.type,
    amount: row.amount,
    description: row.description,
    status: row.status,
    transactedAt: row.transacted_at,
    createdByName: row.creator_name,
  });

  const objectKey = `invoices/${row.id}.pdf`;
  await uploadObject({
    key: objectKey,
    body: pdfBytes,
    contentType: 'application/pdf',
  });
  const downloadUrl = await createPresignedDownloadUrl({ key: objectKey, expiresIn: 3600 });

  return c.json({ object_key: objectKey, download_url: downloadUrl });
});

router.get('/summary', requirePermission('finance', 'view'), async (c) => {
  const db = getDb();
  const [cashTotals] = await db
    .select({
      total_balance: sql<string>`coalesce(sum(${finance_accounts.balance}), 0)::text`,
    })
    .from(finance_accounts)
    .where(eq(finance_accounts.is_active, true));

  const [pnl] = await db
    .select({
      total_income: sql<string>`coalesce(sum(case when ${finance_transactions.type} = 'income' and ${finance_transactions.status} = 'posted' then ${finance_transactions.amount} else 0 end), 0)::text`,
      total_expense: sql<string>`coalesce(sum(case when ${finance_transactions.type} = 'expense' and ${finance_transactions.status} = 'posted' then ${finance_transactions.amount} else 0 end), 0)::text`,
    })
    .from(finance_transactions);

  const dailySeries = await db.execute(sql`
    SELECT
      to_char(date_trunc('day', transacted_at AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD') AS day,
      coalesce(sum(case when type = 'income' and status = 'posted' then amount else 0 end), 0)::text AS income,
      coalesce(sum(case when type = 'expense' and status = 'posted' then amount else 0 end), 0)::text AS expense
    FROM finance_transactions
    WHERE transacted_at >= now() - interval '30 days'
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  const obligationTotals = await db.execute(sql`
    SELECT
      coalesce(sum(case when kind = 'receivable' and status in ('open', 'partial') then amount - paid_amount else 0 end), 0)::text AS open_receivable,
      coalesce(sum(case when kind = 'payable' and status in ('open', 'partial') then amount - paid_amount else 0 end), 0)::text AS open_payable
    FROM finance_obligations
  `);

  const incomeBig = BigInt(pnl?.total_income ?? '0');
  const expenseBig = BigInt(pnl?.total_expense ?? '0');

  return c.json({
    total_balance: cashTotals?.total_balance ?? '0',
    total_income: incomeBig.toString(),
    total_expense: expenseBig.toString(),
    net_profit: (incomeBig - expenseBig).toString(),
    open_receivable: (obligationTotals.rows[0]?.open_receivable as string) ?? '0',
    open_payable: (obligationTotals.rows[0]?.open_payable as string) ?? '0',
    daily_cashflow: dailySeries.rows,
  });
});

router.get('/obligations', requirePermission('finance', 'view'), async (c) => {
  const rows = await getDb()
    .select()
    .from(finance_obligations)
    .orderBy(desc(finance_obligations.created_at));
  return c.json({ obligations: jsonSafe(rows) });
});

router.post('/obligations', requirePermission('finance', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createObligationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const auth = c.get('auth');
  const data = parsed.data;
  const [created] = await getDb()
    .insert(finance_obligations)
    .values({
      kind: data.kind,
      counterparty_name: data.counterparty_name,
      amount: data.amount,
      due_date: data.due_date ?? null,
      note: data.note ?? null,
      created_by: auth.employee.id,
    })
    .returning();

  await writeAuditLog(getDb(), {
    actorId: auth.employee.id,
    platform: auth.platform,
    module: 'finance',
    action: 'create_obligation',
    entityId: created.id,
    afterData: created,
  });

  return c.json({ obligation: jsonSafe(created) }, 201);
});

router.post('/obligations/:id/pay', requirePermission('finance', 'approve'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing obligation id.' }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = payObligationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const auth = c.get('auth');
  const data = parsed.data;
  const db = getDb();

  try {
    const out = await db.transaction(async (tx) => {
      const [ob] = await tx
        .select()
        .from(finance_obligations)
        .where(eq(finance_obligations.id, id))
        .for('update');
      if (!ob) throw new HttpStatusError(404, 'Obligation not found.');
      if (ob.status === 'paid' || ob.status === 'void') {
        throw new HttpStatusError(400, `Obligation is already ${ob.status}.`);
      }

      const remaining = ob.amount - ob.paid_amount;
      if (data.amount > remaining) {
        throw new HttpStatusError(400, `Payment exceeds remaining obligation (${remaining.toString()}).`);
      }

      const [acc] = await tx
        .select()
        .from(finance_accounts)
        .where(eq(finance_accounts.id, data.account_id))
        .for('update');
      if (!acc) throw new HttpStatusError(404, 'Finance account not found.');

      const txType = ob.kind === 'receivable' ? 'income' : 'expense';
      if (txType === 'expense' && acc.balance < data.amount) {
        throw new HttpStatusError(400, `Insufficient balance in ${acc.name}.`);
      }

      const nextBalance = txType === 'income' ? acc.balance + data.amount : acc.balance - data.amount;
      await tx
        .update(finance_accounts)
        .set({ balance: nextBalance })
        .where(eq(finance_accounts.id, acc.id));

      const nextPaid = ob.paid_amount + data.amount;
      const nextStatus = nextPaid >= ob.amount ? 'paid' : 'partial';

      const [updatedOb] = await tx
        .update(finance_obligations)
        .set({ paid_amount: nextPaid, status: nextStatus })
        .where(eq(finance_obligations.id, ob.id))
        .returning();

      const [finTx] = await tx
        .insert(finance_transactions)
        .values({
          account_id: acc.id,
          type: txType,
          amount: data.amount,
          description:
            data.note ||
            `${ob.kind === 'receivable' ? 'Pelunasan Piutang' : 'Pembayaran Hutang'}: ${ob.counterparty_name}`,
          reference_type: 'obligation',
          reference_id: ob.id,
          receipt_object_key: data.receipt_object_key ?? null,
          status: 'posted',
          created_by: auth.employee.id,
          approved_by: auth.employee.id,
        })
        .returning();

      await writeAuditLog(tx, {
        actorId: auth.employee.id,
        platform: auth.platform,
        module: 'finance',
        action: 'pay_obligation',
        entityId: ob.id,
        beforeData: ob,
        afterData: { obligation: updatedOb, transaction: finTx },
      });

      await emitErpEvent(tx, 'erp:finance', 'obligation_paid', {
        obligation_id: ob.id,
        transaction_id: finTx.id,
        amount: data.amount.toString(),
      });

      const financeViewers = await resolveModuleViewers(tx, 'finance');
      await notifyUsersInTx(tx, {
        module: 'finance',
        eventType: 'obligation_paid',
        title: ob.kind === 'receivable' ? 'Piutang dibayar' : 'Hutang dibayar',
        body: `${ob.counterparty_name}: ${formatRupiah(data.amount)} (sisa ${formatRupiah(updatedOb.amount - updatedOb.paid_amount)}).`,
        recipients: financeViewers,
        excludeAuthUserId: auth.authUserId,
        actorEmployeeId: auth.employee.id,
        entityId: ob.id,
      });

      return { obligation: updatedOb, transaction: finTx };
    });

    return c.json(jsonSafe(out));
  } catch (err) {
    if (err instanceof HttpStatusError) {
      return c.json({ error: err.message }, err.status);
    }
    throw err;
  }
});

function jakartaYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(date);
}

function buildPosSaleNumber(now: Date): string {
  const compact = jakartaYmd(now).slice(2).replace(/-/g, '');
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `POS-${compact}-${suffix}`;
}

function computePosDiscount(
  subtotal: bigint,
  type: 'none' | 'amount' | 'percent',
  rawVal: bigint | number,
): bigint {
  const val = BigInt(rawVal ?? 0);
  if (type === 'none') return 0n;
  if (type === 'percent') {
    if (val < 0n || val > 100n) {
      throw new HttpStatusError(400, 'Diskon persentase harus antara 0 sampai 100%.');
    }
    return (subtotal * val) / 100n;
  }
  if (val < 0n || val > subtotal) {
    throw new HttpStatusError(400, 'Diskon nominal tidak boleh melebihi subtotal.');
  }
  return val;
}

router.get('/pos/catalog', requirePermission('finance', 'view'), async (c) => {
  const db = getDb();
  const [whRows, accRows, itemRows, stockRows] = await Promise.all([
    db.select().from(warehouses).orderBy(desc(warehouses.is_default), warehouses.name),
    db
      .select()
      .from(finance_accounts)
      .where(eq(finance_accounts.is_active, true))
      .orderBy(finance_accounts.name),
    db
      .select()
      .from(inventory_items)
      .where(eq(inventory_items.is_active, true))
      .orderBy(inventory_items.name),
    db.select().from(inventory_stocks),
  ]);

  const stockMap = new Map<string, Record<string, number>>();
  for (const row of stockRows) {
    const byWh = stockMap.get(row.item_id) ?? {};
    byWh[row.warehouse_id] = Number(row.qty ?? 0);
    stockMap.set(row.item_id, byWh);
  }

  const defaultWh = whRows.find((w) => w.is_default) ?? whRows[0] ?? null;
  const products = itemRows.map((item) => {
    const stocksByWarehouse = stockMap.get(item.id) ?? {};
    const totalStock = Object.values(stocksByWarehouse).reduce((acc, q) => acc + q, 0);
    return {
      ...item,
      stocks_by_warehouse: stocksByWarehouse,
      total_stock: totalStock,
    };
  });

  return c.json({
    warehouses: jsonSafe(whRows),
    default_warehouse_id: defaultWh?.id ?? null,
    accounts: jsonSafe(accRows),
    products: jsonSafe(products),
  });
});

router.get('/pos/sales', requirePermission('finance', 'view'), async (c) => {
  const statusFilter = c.req.query('status');
  const methodFilter = c.req.query('payment_method');
  const limit = Math.min(Number(c.req.query('limit') ?? 80) || 80, 200);
  const db = getDb();

  const conditions = [];
  if (statusFilter === 'completed' || statusFilter === 'void') {
    conditions.push(eq(pos_sales.status, statusFilter));
  }
  if (
    methodFilter === 'cash' ||
    methodFilter === 'qris' ||
    methodFilter === 'transfer' ||
    methodFilter === 'ewallet'
  ) {
    conditions.push(eq(pos_sales.payment_method, methodFilter));
  }

  const salesRows = await db
    .select({
      id: pos_sales.id,
      sale_number: pos_sales.sale_number,
      warehouse_id: pos_sales.warehouse_id,
      warehouse_name: warehouses.name,
      account_id: pos_sales.account_id,
      account_name: finance_accounts.name,
      finance_transaction_id: pos_sales.finance_transaction_id,
      cashier_id: pos_sales.cashier_id,
      cashier_name: employees.full_name,
      customer_name: pos_sales.customer_name,
      payment_method: pos_sales.payment_method,
      subtotal: pos_sales.subtotal,
      discount_type: pos_sales.discount_type,
      discount_value: pos_sales.discount_value,
      discount_amount: pos_sales.discount_amount,
      tax_percent: pos_sales.tax_percent,
      tax_amount: pos_sales.tax_amount,
      total_amount: pos_sales.total_amount,
      paid_amount: pos_sales.paid_amount,
      change_amount: pos_sales.change_amount,
      status: pos_sales.status,
      note: pos_sales.note,
      void_reason: pos_sales.void_reason,
      voided_at: pos_sales.voided_at,
      created_at: pos_sales.created_at,
    })
    .from(pos_sales)
    .innerJoin(employees, eq(employees.id, pos_sales.cashier_id))
    .innerJoin(finance_accounts, eq(finance_accounts.id, pos_sales.account_id))
    .leftJoin(warehouses, eq(warehouses.id, pos_sales.warehouse_id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(pos_sales.created_at))
    .limit(limit);

  const saleIds = salesRows.map((s) => s.id);
  const itemRows = saleIds.length
    ? await db
        .select()
        .from(pos_sale_items)
        .where(inArray(pos_sale_items.sale_id, saleIds))
    : [];

  const itemsBySale = new Map<string, typeof itemRows>();
  for (const row of itemRows) {
    const bucket = itemsBySale.get(row.sale_id) ?? [];
    bucket.push(row);
    itemsBySale.set(row.sale_id, bucket);
  }

  const todayYmd = jakartaYmd(new Date());
  const [aggRows, methodRows, topProductRows, accountRows] = await Promise.all([
    db.execute(sql`
      SELECT
        coalesce(sum(case when status = 'completed' and to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') = ${todayYmd} then total_amount else 0 end), 0)::text AS today_revenue,
        count(*) FILTER (WHERE status = 'completed' AND to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') = ${todayYmd})::int AS today_count,
        coalesce(sum(case when status = 'completed' then total_amount else 0 end), 0)::text AS period_revenue,
        count(*) FILTER (WHERE status = 'completed')::int AS period_count,
        coalesce(sum(case when status = 'completed' then discount_amount else 0 end), 0)::text AS period_discount_total,
        coalesce(sum(case when status = 'completed' then tax_amount else 0 end), 0)::text AS period_tax_total,
        count(*) FILTER (WHERE status = 'void')::int AS void_count
      FROM pos_sales
    `),
    db.execute(sql`
      SELECT
        payment_method,
        count(*)::int AS tx_count,
        coalesce(sum(total_amount), 0)::text AS total_amount
      FROM pos_sales
      WHERE status = 'completed'
      GROUP BY payment_method
    `),
    db.execute(sql`
      SELECT
        coalesce(psi.sku, '') AS sku,
        psi.item_name,
        psi.unit,
        sum(psi.qty)::int AS qty_sold,
        coalesce(sum(psi.line_total), 0)::text AS revenue
      FROM pos_sale_items psi
      INNER JOIN pos_sales ps ON ps.id = psi.sale_id
      WHERE ps.status = 'completed'
      GROUP BY coalesce(psi.sku, ''), psi.item_name, psi.unit
      ORDER BY sum(psi.line_total) DESC
      LIMIT 5
    `),
    db
      .select()
      .from(finance_accounts)
      .where(eq(finance_accounts.is_active, true))
      .orderBy(finance_accounts.name),
  ]);

  const agg = (aggRows.rows[0] ?? {}) as Record<string, unknown>;
  const todayRev = BigInt((agg.today_revenue as string) ?? '0');
  const todayCount = Number(agg.today_count ?? 0);
  const todayAvg = todayCount > 0 ? todayRev / BigInt(todayCount) : 0n;

  const byMethod: Record<'cash' | 'qris' | 'transfer' | 'ewallet', { count: number; total: string }> = {
    cash: { count: 0, total: '0' },
    qris: { count: 0, total: '0' },
    transfer: { count: 0, total: '0' },
    ewallet: { count: 0, total: '0' },
  };
  for (const r of methodRows.rows) {
    const m = String(r.payment_method) as 'cash' | 'qris' | 'transfer' | 'ewallet';
    if (m in byMethod) {
      byMethod[m] = {
        count: Number(r.tx_count ?? 0),
        total: String(r.total_amount ?? '0'),
      };
    }
  }

  const enrichedSales = salesRows.map((s) => ({
    ...s,
    items: itemsBySale.get(s.id) ?? [],
  }));

  return c.json({
    sales: jsonSafe(enrichedSales),
    report: {
      today_revenue: todayRev.toString(),
      today_count: todayCount,
      today_avg_ticket: todayAvg.toString(),
      period_revenue: String(agg.period_revenue ?? '0'),
      period_count: Number(agg.period_count ?? 0),
      period_discount_total: String(agg.period_discount_total ?? '0'),
      period_tax_total: String(agg.period_tax_total ?? '0'),
      void_count: Number(agg.void_count ?? 0),
      by_payment_method: byMethod,
      top_products: topProductRows.rows,
      accounts: jsonSafe(accountRows),
    },
  });
});

router.post('/pos/sales', requirePermission('finance', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createPosSaleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const auth = c.get('auth');
  const data = parsed.data;
  const db = getDb();

  try {
    const out = await db.transaction(async (tx) => {
      const [acc] = await tx
        .select()
        .from(finance_accounts)
        .where(eq(finance_accounts.id, data.account_id))
        .for('update');
      if (!acc) throw new HttpStatusError(404, 'Akun kas pembayaran tidak ditemukan.');
      if (!acc.is_active) throw new HttpStatusError(400, `Akun kas ${acc.name} sedang nonaktif.`);

      const needsInventoryWarehouse = data.items.some((i) => Boolean(i.inventory_item_id));
      let resolvedWh: { id: string; name: string } | null = null;
      if (data.warehouse_id) {
        const [wh] = await tx
          .select({ id: warehouses.id, name: warehouses.name })
          .from(warehouses)
          .where(eq(warehouses.id, data.warehouse_id))
          .limit(1);
        if (!wh) throw new HttpStatusError(404, 'Gudang outlet tidak ditemukan.');
        resolvedWh = wh;
      } else if (needsInventoryWarehouse) {
        const [wh] = await tx
          .select({ id: warehouses.id, name: warehouses.name })
          .from(warehouses)
          .orderBy(desc(warehouses.is_default), warehouses.name)
          .limit(1);
        if (!wh) {
          throw new HttpStatusError(400, 'Belum ada gudang terdaftar untuk memotong stok inventaris.');
        }
        resolvedWh = wh;
      }

      const saleNumber = buildPosSaleNumber(new Date());

      // Agregasikan qty yang dibutuhkan per inventory_item_id sebelum locking
      const qtyNeededByItem = new Map<string, number>();
      for (const line of data.items) {
        if (line.inventory_item_id) {
          qtyNeededByItem.set(
            line.inventory_item_id,
            (qtyNeededByItem.get(line.inventory_item_id) ?? 0) + line.qty,
          );
        }
      }

      const itemMetaMap = new Map<
        string,
        { id: string; sku: string; name: string; unit: string; cost_price: bigint; min_stock: number }
      >();
      const lowStockAlerts: Array<{ name: string; sku: string; qty: number }> = [];

      if (qtyNeededByItem.size > 0 && resolvedWh) {
        const sortedIds = [...qtyNeededByItem.keys()].sort();
        const invRows = await tx
          .select()
          .from(inventory_items)
          .where(inArray(inventory_items.id, sortedIds));

        for (const r of invRows) {
          if (!r.is_active) {
            throw new HttpStatusError(400, `Produk ${r.name} sedang dinonaktifkan.`);
          }
          itemMetaMap.set(r.id, r);
        }

        for (const itemId of sortedIds) {
          const item = itemMetaMap.get(itemId);
          if (!item) {
            throw new HttpStatusError(404, `Produk inventaris ${itemId} tidak ditemukan.`);
          }
          const needQty = qtyNeededByItem.get(itemId)!;

          await tx
            .insert(inventory_stocks)
            .values({ item_id: itemId, warehouse_id: resolvedWh.id, qty: 0 })
            .onConflictDoNothing({
              target: [inventory_stocks.item_id, inventory_stocks.warehouse_id],
            });

          const [stockRow] = await tx
            .select()
            .from(inventory_stocks)
            .where(
              and(
                eq(inventory_stocks.item_id, itemId),
                eq(inventory_stocks.warehouse_id, resolvedWh.id),
              ),
            )
            .for('update');

          const avail = Number(stockRow?.qty ?? 0);
          if (avail < needQty) {
            throw new HttpStatusError(
              400,
              `Stok ${item.name} di ${resolvedWh.name} tidak mencukupi (tersisa ${avail}, diminta ${needQty}).`,
            );
          }

          const nextQty = avail - needQty;
          await tx
            .update(inventory_stocks)
            .set({ qty: nextQty })
            .where(
              and(
                eq(inventory_stocks.item_id, itemId),
                eq(inventory_stocks.warehouse_id, resolvedWh.id),
              ),
            );

          await tx.insert(stock_movements).values({
            item_id: itemId,
            warehouse_id: resolvedWh.id,
            movement_type: 'out',
            qty_delta: -needQty,
            unit_cost: item.cost_price,
            note: `Penjualan POS ${saleNumber}`,
            created_by: auth.employee.id,
          });

          if (nextQty <= item.min_stock) {
            lowStockAlerts.push({ name: item.name, sku: item.sku, qty: nextQty });
          }
        }
      }

      let subtotal = 0n;
      const preparedItems = data.items.map((line) => {
        const meta = line.inventory_item_id ? itemMetaMap.get(line.inventory_item_id) : undefined;
        const unitPrice = BigInt(line.unit_price);
        const lineTotal = BigInt(line.qty) * unitPrice;
        subtotal += lineTotal;
        return {
          inventory_item_id: line.inventory_item_id ?? null,
          sku: meta?.sku ?? line.sku ?? null,
          item_name: line.item_name.trim(),
          unit: line.unit || meta?.unit || 'pcs',
          qty: line.qty,
          unit_price: unitPrice,
          unit_cost: meta?.cost_price ?? 0n,
          line_total: lineTotal,
        };
      });

      const discountValue = BigInt(data.discount_value ?? 0);
      const discountAmount = computePosDiscount(subtotal, data.discount_type, discountValue);
      const taxable = subtotal - discountAmount;
      const taxAmount = (taxable * BigInt(data.tax_percent)) / 100n;
      const totalAmount = taxable + taxAmount;
      if (totalAmount <= 0n) {
        throw new HttpStatusError(400, 'Total pembayaran POS harus lebih besar dari Rp 0.');
      }

      const paidAmount = data.paid_amount ? BigInt(data.paid_amount) : totalAmount;
      if (paidAmount < totalAmount) {
        throw new HttpStatusError(400, 'Nominal bayar kurang dari total tagihan POS.');
      }
      const changeAmount = paidAmount - totalAmount;

      const beforeAccBalance = acc.balance;
      const nextAccBalance = acc.balance + totalAmount;
      await tx
        .update(finance_accounts)
        .set({ balance: nextAccBalance })
        .where(eq(finance_accounts.id, acc.id));

      const customerSuffix = data.customer_name?.trim() ? ` - ${data.customer_name.trim()}` : '';
      const [finTx] = await tx
        .insert(finance_transactions)
        .values({
          account_id: acc.id,
          type: 'income',
          amount: totalAmount,
          description: `Penjualan POS ${saleNumber} (${data.payment_method.toUpperCase()})${customerSuffix}`,
          reference_type: 'pos_sale',
          status: 'posted',
          created_by: auth.employee.id,
          approved_by: auth.employee.id,
        })
        .returning({
          id: finance_transactions.id,
          txid: txidExpr,
        });

      const [sale] = await tx
        .insert(pos_sales)
        .values({
          sale_number: saleNumber,
          warehouse_id: resolvedWh?.id ?? null,
          account_id: acc.id,
          finance_transaction_id: finTx.id,
          cashier_id: auth.employee.id,
          customer_name: data.customer_name?.trim() || null,
          payment_method: data.payment_method,
          subtotal,
          discount_type: data.discount_type,
          discount_value: discountValue,
          discount_amount: discountAmount,
          tax_percent: data.tax_percent,
          tax_amount: taxAmount,
          total_amount: totalAmount,
          paid_amount: paidAmount,
          change_amount: changeAmount,
          status: 'completed',
          note: data.note?.trim() || null,
        })
        .returning();

      await tx
        .update(finance_transactions)
        .set({ reference_id: sale.id })
        .where(eq(finance_transactions.id, finTx.id));

      const insertedItems = await tx
        .insert(pos_sale_items)
        .values(preparedItems.map((it) => ({ ...it, sale_id: sale.id })))
        .returning();

      await writeAuditLog(tx, {
        actorId: auth.employee.id,
        platform: auth.platform,
        module: 'finance',
        action: 'pos_sale_created',
        entityId: sale.id,
        beforeData: { account_balance: beforeAccBalance.toString() },
        afterData: {
          sale_number: sale.sale_number,
          total_amount: sale.total_amount.toString(),
          payment_method: sale.payment_method,
          account_balance: nextAccBalance.toString(),
          items_count: insertedItems.length,
        },
      });

      await emitErpEvent(tx, 'erp:finance', 'pos_sale_created', {
        sale_id: sale.id,
        sale_number: sale.sale_number,
        total_amount: sale.total_amount.toString(),
        account_id: acc.id,
        account_balance: nextAccBalance.toString(),
      });

      if (qtyNeededByItem.size > 0) {
        await emitErpEvent(tx, 'erp:inventory', 'stock_movement_recorded', {
          sale_id: sale.id,
          warehouse_id: resolvedWh?.id ?? null,
          items_count: qtyNeededByItem.size,
        });
      }

      const financeViewers = await resolveModuleViewers(tx, 'finance');
      await notifyUsersInTx(tx, {
        module: 'finance',
        eventType: 'pos_sale_created',
        title: `Penjualan Kasir ${sale.sale_number}`,
        body: `${data.payment_method.toUpperCase()} via ${acc.name}: ${formatRupiah(totalAmount)}${customerSuffix}`,
        recipients: financeViewers,
        excludeAuthUserId: auth.authUserId,
        actorEmployeeId: auth.employee.id,
        entityId: sale.id,
      });

      if (lowStockAlerts.length > 0) {
        const invViewers = await resolveModuleViewers(tx, 'inventory');
        const firstLow = lowStockAlerts[0]!;
        await notifyUsersInTx(tx, {
          module: 'inventory',
          eventType: 'low_stock_alert',
          title: 'Stok menipis usai penjualan POS',
          body: `${firstLow.name} (${firstLow.sku}) tersisa ${firstLow.qty}.`,
          recipients: invViewers,
          excludeAuthUserId: auth.authUserId,
          actorEmployeeId: auth.employee.id,
          entityId: sale.id,
        });
      }

      return {
        sale: {
          ...sale,
          cashier_name: auth.employee.full_name,
          account_name: acc.name,
          warehouse_name: resolvedWh?.name ?? null,
          items: insertedItems,
        },
        txid: finTx.txid,
        low_stock_alerts: lowStockAlerts,
      };
    });

    return c.json(jsonSafe(out), 201);
  } catch (err) {
    if (err instanceof HttpStatusError) {
      return c.json({ error: err.message }, err.status);
    }
    throw err;
  }
});

router.get('/pos/sales/:id/receipt-pdf', requirePermission('finance', 'view'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing POS sale id.' }, 400);
  const db = getDb();

  const [saleRow] = await db
    .select({
      id: pos_sales.id,
      sale_number: pos_sales.sale_number,
      created_at: pos_sales.created_at,
      cashier_name: employees.full_name,
      customer_name: pos_sales.customer_name,
      warehouse_name: warehouses.name,
      account_name: finance_accounts.name,
      payment_method: pos_sales.payment_method,
      status: pos_sales.status,
      subtotal: pos_sales.subtotal,
      discount_type: pos_sales.discount_type,
      discount_value: pos_sales.discount_value,
      discount_amount: pos_sales.discount_amount,
      tax_percent: pos_sales.tax_percent,
      tax_amount: pos_sales.tax_amount,
      total_amount: pos_sales.total_amount,
      paid_amount: pos_sales.paid_amount,
      change_amount: pos_sales.change_amount,
      note: pos_sales.note,
    })
    .from(pos_sales)
    .innerJoin(employees, eq(employees.id, pos_sales.cashier_id))
    .innerJoin(finance_accounts, eq(finance_accounts.id, pos_sales.account_id))
    .leftJoin(warehouses, eq(warehouses.id, pos_sales.warehouse_id))
    .where(eq(pos_sales.id, id))
    .limit(1);

  if (!saleRow) {
    return c.json({ error: 'Transaksi POS tidak ditemukan.' }, 404);
  }

  const items = await db
    .select()
    .from(pos_sale_items)
    .where(eq(pos_sale_items.sale_id, saleRow.id));

  const pdfBytes = await generatePosReceiptPdf({
    saleNumber: saleRow.sale_number,
    createdAt: saleRow.created_at,
    cashierName: saleRow.cashier_name,
    customerName: saleRow.customer_name,
    warehouseName: saleRow.warehouse_name,
    accountName: saleRow.account_name,
    paymentMethod: saleRow.payment_method as 'cash' | 'qris' | 'transfer' | 'ewallet',
    status: saleRow.status as 'completed' | 'void',
    items: items.map((it) => ({
      itemName: it.item_name,
      qty: it.qty,
      unit: it.unit,
      unitPrice: it.unit_price,
      lineTotal: it.line_total,
    })),
    subtotal: saleRow.subtotal,
    discountType: saleRow.discount_type as 'none' | 'amount' | 'percent',
    discountValue: saleRow.discount_value,
    discountAmount: saleRow.discount_amount,
    taxPercent: saleRow.tax_percent,
    taxAmount: saleRow.tax_amount,
    totalAmount: saleRow.total_amount,
    paidAmount: saleRow.paid_amount,
    changeAmount: saleRow.change_amount,
    note: saleRow.note,
  });

  const objectKey = `receipt/pos-${saleRow.id}-${saleRow.status}.pdf`;
  await uploadObject({
    key: objectKey,
    body: pdfBytes,
    contentType: 'application/pdf',
  });
  await db
    .update(pos_sales)
    .set({ receipt_pdf_object_key: objectKey })
    .where(eq(pos_sales.id, saleRow.id));

  const downloadUrl = await createPresignedDownloadUrl({ key: objectKey, expiresIn: 3600 });
  return c.json({ object_key: objectKey, download_url: downloadUrl });
});

router.post('/pos/sales/:id/void', requirePermission('finance', 'approve'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing POS sale id.' }, 400);
  const rawBody = await c.req.json().catch(() => ({}));
  const parsed = voidPosSaleSchema.safeParse(rawBody ?? {});
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const auth = c.get('auth');
  const reason = parsed.data.reason?.trim() || 'Dibatalkan / Retur Kasir';
  const db = getDb();

  try {
    const voided = await db.transaction(async (tx) => {
      const [sale] = await tx
        .select()
        .from(pos_sales)
        .where(eq(pos_sales.id, id))
        .for('update');
      if (!sale) throw new HttpStatusError(404, 'Transaksi POS tidak ditemukan.');
      if (sale.status === 'void') {
        throw new HttpStatusError(400, 'Transaksi POS ini sudah dibatalkan (void).');
      }

      const [acc] = await tx
        .select()
        .from(finance_accounts)
        .where(eq(finance_accounts.id, sale.account_id))
        .for('update');
      if (!acc) throw new HttpStatusError(404, 'Akun kas tidak ditemukan.');
      if (acc.balance < sale.total_amount) {
        throw new HttpStatusError(
          400,
          `Saldo akun ${acc.name} tidak mencukupi untuk refund/void POS ini.`,
        );
      }

      const nextBalance = acc.balance - sale.total_amount;
      await tx
        .update(finance_accounts)
        .set({ balance: nextBalance })
        .where(eq(finance_accounts.id, acc.id));

      if (sale.finance_transaction_id) {
        await tx
          .update(finance_transactions)
          .set({ status: 'void' })
          .where(eq(finance_transactions.id, sale.finance_transaction_id));
      }

      const saleItems = await tx
        .select()
        .from(pos_sale_items)
        .where(eq(pos_sale_items.sale_id, sale.id));

      let restoredInventoryCount = 0;
      if (sale.warehouse_id) {
        const restoreByItem = new Map<string, { qty: number; unitCost: bigint }>();
        for (const it of saleItems) {
          if (it.inventory_item_id) {
            const prev = restoreByItem.get(it.inventory_item_id);
            restoreByItem.set(it.inventory_item_id, {
              qty: (prev?.qty ?? 0) + it.qty,
              unitCost: it.unit_cost,
            });
          }
        }
        const sortedIds = [...restoreByItem.keys()].sort();
        for (const itemId of sortedIds) {
          const restore = restoreByItem.get(itemId)!;
          await tx
            .insert(inventory_stocks)
            .values({ item_id: itemId, warehouse_id: sale.warehouse_id, qty: 0 })
            .onConflictDoNothing({
              target: [inventory_stocks.item_id, inventory_stocks.warehouse_id],
            });
          const [stockRow] = await tx
            .select()
            .from(inventory_stocks)
            .where(
              and(
                eq(inventory_stocks.item_id, itemId),
                eq(inventory_stocks.warehouse_id, sale.warehouse_id),
              ),
            )
            .for('update');
          const nextQty = Number(stockRow?.qty ?? 0) + restore.qty;
          await tx
            .update(inventory_stocks)
            .set({ qty: nextQty })
            .where(
              and(
                eq(inventory_stocks.item_id, itemId),
                eq(inventory_stocks.warehouse_id, sale.warehouse_id),
              ),
            );
          await tx.insert(stock_movements).values({
            item_id: itemId,
            warehouse_id: sale.warehouse_id,
            movement_type: 'in',
            qty_delta: restore.qty,
            unit_cost: restore.unitCost,
            note: `Retur/Void POS ${sale.sale_number}: ${reason}`,
            created_by: auth.employee.id,
          });
          restoredInventoryCount += 1;
        }
      }

      const [updatedSale] = await tx
        .update(pos_sales)
        .set({
          status: 'void',
          voided_by: auth.employee.id,
          voided_at: new Date(),
          void_reason: reason,
          receipt_pdf_object_key: null,
        })
        .where(eq(pos_sales.id, sale.id))
        .returning();

      await writeAuditLog(tx, {
        actorId: auth.employee.id,
        platform: auth.platform,
        module: 'finance',
        action: 'pos_sale_voided',
        entityId: sale.id,
        beforeData: {
          status: sale.status,
          total_amount: sale.total_amount.toString(),
          account_balance: acc.balance.toString(),
        },
        afterData: {
          status: 'void',
          void_reason: reason,
          account_balance: nextBalance.toString(),
          restored_inventory_items: restoredInventoryCount,
        },
      });

      await emitErpEvent(tx, 'erp:finance', 'pos_sale_voided', {
        sale_id: sale.id,
        sale_number: sale.sale_number,
        account_id: acc.id,
        account_balance: nextBalance.toString(),
      });

      if (restoredInventoryCount > 0) {
        await emitErpEvent(tx, 'erp:inventory', 'stock_movement_recorded', {
          sale_id: sale.id,
          warehouse_id: sale.warehouse_id,
          restored_items_count: restoredInventoryCount,
        });
      }

      return updatedSale;
    });

    return c.json({ sale: jsonSafe(voided) });
  } catch (err) {
    if (err instanceof HttpStatusError) {
      return c.json({ error: err.message }, err.status);
    }
    throw err;
  }
});

class HttpStatusError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export const financePlugin: ErpModulePlugin = {
  id: 'finance',
  basePath: '/finance',
  router,
};
