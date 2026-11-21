import {
  createAccountSchema,
  createCategorySchema,
  createObligationSchema,
  createTransactionSchema,
  payObligationSchema,
} from '@ekalliptus/contracts';
import {
  employees,
  finance_accounts,
  finance_categories,
  finance_obligations,
  finance_transactions,
} from '@ekalliptus/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, jsonSafe, txidExpr } from '../db.js';
import { emitErpEvent, writeAuditLog } from '../middleware/audit.js';
import { requirePermission } from '../middleware/rbac.js';
import { generateInvoicePdf } from '../services/pdf.js';
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
