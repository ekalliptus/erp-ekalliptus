import {
  createPayrollRunSchema,
  payPayrollRunSchema,
  updatePayrollItemSchema,
} from '@ekalliptus/contracts';
import {
  attendances,
  employees,
  finance_accounts,
  finance_categories,
  finance_transactions,
  payroll_items,
  payroll_runs,
} from '@ekalliptus/db';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, jsonSafe, txidExpr } from '../db.js';
import { emitErpEvent, writeAuditLog } from '../middleware/audit.js';
import { requirePermission } from '../middleware/rbac.js';
import { generatePayrollSlipPdf } from '../services/pdf.js';
import { createPresignedDownloadUrl, uploadObject } from '../services/storage.js';
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

router.get('/runs', requirePermission('payroll', 'view'), async (c) => {
  const rows = await getDb()
    .select()
    .from(payroll_runs)
    .orderBy(desc(payroll_runs.created_at));
  return c.json({ runs: jsonSafe(rows) });
});

router.get('/runs/:id', requirePermission('payroll', 'view'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing payroll run id.' }, 400);
  const auth = c.get('auth');
  const db = getDb();

  const [run] = await db.select().from(payroll_runs).where(eq(payroll_runs.id, id)).limit(1);
  if (!run) return c.json({ error: 'Payroll run not found.' }, 404);

  const canViewAll =
    auth.roleCode === 'owner' || auth.roleCode === 'hr' || auth.roleCode === 'finance';

  const items = await db
    .select({
      id: payroll_items.id,
      payroll_run_id: payroll_items.payroll_run_id,
      employee_id: payroll_items.employee_id,
      employee_code: employees.employee_code,
      full_name: employees.full_name,
      email: employees.email,
      base_salary: payroll_items.base_salary,
      allowances: payroll_items.allowances,
      overtime_pay: payroll_items.overtime_pay,
      deductions: payroll_items.deductions,
      net_salary: payroll_items.net_salary,
      slip_pdf_object_key: payroll_items.slip_pdf_object_key,
      finance_transaction_id: payroll_items.finance_transaction_id,
    })
    .from(payroll_items)
    .innerJoin(employees, eq(employees.id, payroll_items.employee_id))
    .where(
      canViewAll
        ? eq(payroll_items.payroll_run_id, id)
        : and(eq(payroll_items.payroll_run_id, id), eq(payroll_items.employee_id, auth.employee.id)),
    )
    .orderBy(employees.employee_code);

  return c.json({ run: jsonSafe(run), items: jsonSafe(items) });
});

router.post('/runs', requirePermission('payroll', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createPayrollRunSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const { period_start, period_end } = parsed.data;
  const db = getDb();

  const created = await db.transaction(async (tx) => {
    const activeEmployees = await tx
      .select()
      .from(employees)
      .where(eq(employees.is_active, true))
      .orderBy(employees.employee_code);

    const periodAttendance = await tx
      .select({
        employee_id: attendances.employee_id,
        total_overtime: sql<number>`coalesce(sum(${attendances.overtime_minutes}), 0)`,
        total_late: sql<number>`coalesce(sum(${attendances.late_minutes}), 0)`,
      })
      .from(attendances)
      .where(
        and(
          gte(attendances.attendance_date, period_start),
          lte(attendances.attendance_date, period_end),
        ),
      )
      .groupBy(attendances.employee_id);

    const attendanceStats = new Map<string, { overtime: number; late: number }>();
    for (const row of periodAttendance) {
      attendanceStats.set(row.employee_id, {
        overtime: Number(row.total_overtime ?? 0),
        late: Number(row.total_late ?? 0),
      });
    }

    const [run] = await tx
      .insert(payroll_runs)
      .values({
        period_start,
        period_end,
        status: 'draft',
        total_disbursed: 0n,
        created_by: auth.employee.id,
      })
      .returning();

    let totalDisbursed = 0n;
    const insertedItems = [];

    for (const emp of activeEmployees) {
      const stats = attendanceStats.get(emp.id) ?? { overtime: 0, late: 0 };
      const overtimePay = BigInt(stats.overtime) * 500n;
      const deductions = BigInt(stats.late) * 1000n;
      const net = emp.base_salary + overtimePay - deductions;
      totalDisbursed += net > 0n ? net : 0n;

      const [item] = await tx
        .insert(payroll_items)
        .values({
          payroll_run_id: run.id,
          employee_id: emp.id,
          base_salary: emp.base_salary,
          allowances: 0n,
          overtime_pay: overtimePay,
          deductions,
        })
        .returning();
      insertedItems.push(item);
    }

    const [finalRun] = await tx
      .update(payroll_runs)
      .set({ total_disbursed: totalDisbursed })
      .where(eq(payroll_runs.id, run.id))
      .returning();

    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'payroll',
      action: 'create_payroll_run',
      entityId: run.id,
      afterData: { run: finalRun, item_count: insertedItems.length },
    });

    return { run: finalRun, items: insertedItems };
  });

  return c.json(jsonSafe(created), 201);
});

router.patch('/runs/:id/items/:itemId', requirePermission('payroll', 'update'), async (c) => {
  const runId = c.req.param('id');
  const itemId = c.req.param('itemId');
  if (!runId || !itemId) return c.json({ error: 'Missing run or item id.' }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = updatePayrollItemSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const db = getDb();

  try {
    const out = await db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(payroll_runs)
        .where(eq(payroll_runs.id, runId))
        .for('update');
      if (!run) throw new HttpStatusError(404, 'Payroll run not found.');
      if (run.status !== 'draft') {
        throw new HttpStatusError(400, 'Can only modify items while payroll run is draft.');
      }

      const [before] = await tx
        .select()
        .from(payroll_items)
        .where(and(eq(payroll_items.id, itemId), eq(payroll_items.payroll_run_id, runId)))
        .for('update');
      if (!before) throw new HttpStatusError(404, 'Payroll item not found.');

      const [updatedItem] = await tx
        .update(payroll_items)
        .set(parsed.data)
        .where(eq(payroll_items.id, itemId))
        .returning();

      const [sumRow] = await tx
        .select({
          total: sql<string>`coalesce(sum(${payroll_items.net_salary}), 0)::text`,
        })
        .from(payroll_items)
        .where(eq(payroll_items.payroll_run_id, runId));

      await tx
        .update(payroll_runs)
        .set({ total_disbursed: BigInt(sumRow?.total ?? '0') })
        .where(eq(payroll_runs.id, runId));

      await writeAuditLog(tx, {
        actorId: auth.employee.id,
        platform: auth.platform,
        module: 'payroll',
        action: 'update_payroll_item',
        entityId: itemId,
        beforeData: before,
        afterData: updatedItem,
      });

      return updatedItem;
    });

    return c.json({ item: jsonSafe(out) });
  } catch (err) {
    if (err instanceof HttpStatusError) {
      return c.json({ error: err.message }, err.status);
    }
    throw err;
  }
});

router.post('/runs/:id/approve', requirePermission('payroll', 'approve'), async (c) => {
  const runId = c.req.param('id');
  if (!runId) return c.json({ error: 'Missing payroll run id.' }, 400);
  const auth = c.get('auth');
  const db = getDb();

  const [before] = await db.select().from(payroll_runs).where(eq(payroll_runs.id, runId)).limit(1);
  if (!before) return c.json({ error: 'Payroll run not found.' }, 404);
  if (before.status !== 'draft') {
    return c.json({ error: `Cannot approve payroll run in status ${before.status}.` }, 400);
  }

  const [updated] = await db
    .update(payroll_runs)
    .set({ status: 'approved', approved_by: auth.employee.id })
    .where(eq(payroll_runs.id, runId))
    .returning();

  await writeAuditLog(db, {
    actorId: auth.employee.id,
    platform: auth.platform,
    module: 'payroll',
    action: 'approve_payroll_run',
    entityId: runId,
    beforeData: before,
    afterData: updated,
  });

  await emitErpEvent(db, 'erp:attendance', 'payroll_approved', {
    payroll_run_id: runId,
    total_disbursed: updated.total_disbursed.toString(),
  });

  return c.json({ run: jsonSafe(updated) });
});

router.post('/runs/:id/pay', requirePermission('payroll', 'approve'), async (c) => {
  const runId = c.req.param('id');
  if (!runId) return c.json({ error: 'Missing payroll run id.' }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = payPayrollRunSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const db = getDb();

  try {
    const paidAt = new Date();
    const txOut = await db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(payroll_runs)
        .where(eq(payroll_runs.id, runId))
        .for('update');
      if (!run) throw new HttpStatusError(404, 'Payroll run not found.');
      if (run.status !== 'approved') {
        throw new HttpStatusError(400, `Payroll run must be approved before payment (current: ${run.status}).`);
      }

      const items = await tx
        .select({
          id: payroll_items.id,
          employee_id: payroll_items.employee_id,
          base_salary: payroll_items.base_salary,
          allowances: payroll_items.allowances,
          overtime_pay: payroll_items.overtime_pay,
          deductions: payroll_items.deductions,
          net_salary: payroll_items.net_salary,
          employee_code: employees.employee_code,
          full_name: employees.full_name,
          email: employees.email,
        })
        .from(payroll_items)
        .innerJoin(employees, eq(employees.id, payroll_items.employee_id))
        .where(eq(payroll_items.payroll_run_id, runId));

      const totalNet = items.reduce((acc, item) => acc + (item.net_salary > 0n ? item.net_salary : 0n), 0n);

      const [account] = await tx
        .select()
        .from(finance_accounts)
        .where(eq(finance_accounts.id, parsed.data.finance_account_id))
        .for('update');
      if (!account) throw new HttpStatusError(404, 'Finance account not found.');
      if (account.balance < totalNet) {
        throw new HttpStatusError(
          400,
          `Insufficient balance in ${account.name} (${account.balance.toString()} < ${totalNet.toString()}).`,
        );
      }

      const [payrollCategory] = await tx
        .select()
        .from(finance_categories)
        .where(
          and(
            eq(finance_categories.kind, 'expense'),
            eq(finance_categories.name, 'Penggajian Karyawan'),
          ),
        )
        .limit(1);

      let finTxId: string | null = null;
      let txid = '';

      if (totalNet > 0n) {
        await tx
          .update(finance_accounts)
          .set({ balance: account.balance - totalNet })
          .where(eq(finance_accounts.id, account.id));

        const [finTx] = await tx
          .insert(finance_transactions)
          .values({
            account_id: account.id,
            category_id: payrollCategory?.id ?? null,
            type: 'expense',
            amount: totalNet,
            description: `Pembayaran Payroll Periode ${run.period_start} s/d ${run.period_end}`,
            reference_type: 'payroll_run',
            reference_id: run.id,
            status: 'posted',
            created_by: auth.employee.id,
            approved_by: auth.employee.id,
          })
          .returning({ id: finance_transactions.id, txid: txidExpr });

        finTxId = finTx.id;
        txid = finTx.txid;
      }

      const [paidRun] = await tx
        .update(payroll_runs)
        .set({
          status: 'paid',
          total_disbursed: totalNet,
          finance_account_id: account.id,
          paid_at: paidAt,
        })
        .where(eq(payroll_runs.id, run.id))
        .returning();

      for (const item of items) {
        const slipKey = `slips/${run.id}/${item.employee_code}.pdf`;
        await tx
          .update(payroll_items)
          .set({
            slip_pdf_object_key: slipKey,
            finance_transaction_id: finTxId,
          })
          .where(eq(payroll_items.id, item.id));
      }

      await writeAuditLog(tx, {
        actorId: auth.employee.id,
        platform: auth.platform,
        module: 'payroll',
        action: 'pay_payroll_run',
        entityId: run.id,
        beforeData: run,
        afterData: { run: paidRun, finance_transaction_id: finTxId, txid },
      });

      await emitErpEvent(tx, 'erp:finance', 'payroll_disbursed', {
        payroll_run_id: run.id,
        finance_transaction_id: finTxId,
        amount: totalNet.toString(),
      });
      await emitErpEvent(tx, 'erp:attendance', 'payroll_paid', {
        payroll_run_id: run.id,
        period_start: run.period_start,
        period_end: run.period_end,
      });

      return { run: paidRun, items, finance_transaction_id: finTxId, txid };
    });

    for (const item of txOut.items) {
      const pdfBytes = await generatePayrollSlipPdf({
        runId: txOut.run.id,
        periodStart: txOut.run.period_start,
        periodEnd: txOut.run.period_end,
        employeeCode: item.employee_code,
        employeeName: item.full_name,
        employeeEmail: item.email,
        baseSalary: item.base_salary,
        allowances: item.allowances,
        overtimePay: item.overtime_pay,
        deductions: item.deductions,
        netSalary: item.net_salary,
        paidAt,
      });
      await uploadObject({
        key: `slips/${txOut.run.id}/${item.employee_code}.pdf`,
        body: pdfBytes,
        contentType: 'application/pdf',
      });
    }

    return c.json({
      run: jsonSafe(txOut.run),
      finance_transaction_id: txOut.finance_transaction_id,
      txid: txOut.txid,
    });
  } catch (err) {
    if (err instanceof HttpStatusError) {
      return c.json({ error: err.message }, err.status);
    }
    throw err;
  }
});

router.get('/items/:itemId/slip-url', requirePermission('payroll', 'view'), async (c) => {
  const itemId = c.req.param('itemId');
  if (!itemId) return c.json({ error: 'Missing payroll item id.' }, 400);
  const auth = c.get('auth');
  const db = getDb();

  const [row] = await db
    .select({
      id: payroll_items.id,
      payroll_run_id: payroll_items.payroll_run_id,
      employee_id: payroll_items.employee_id,
      slip_pdf_object_key: payroll_items.slip_pdf_object_key,
      base_salary: payroll_items.base_salary,
      allowances: payroll_items.allowances,
      overtime_pay: payroll_items.overtime_pay,
      deductions: payroll_items.deductions,
      net_salary: payroll_items.net_salary,
      employee_code: employees.employee_code,
      full_name: employees.full_name,
      email: employees.email,
      period_start: payroll_runs.period_start,
      period_end: payroll_runs.period_end,
      paid_at: payroll_runs.paid_at,
    })
    .from(payroll_items)
    .innerJoin(employees, eq(employees.id, payroll_items.employee_id))
    .innerJoin(payroll_runs, eq(payroll_runs.id, payroll_items.payroll_run_id))
    .where(eq(payroll_items.id, itemId))
    .limit(1);

  if (!row) return c.json({ error: 'Payroll item not found.' }, 404);

  const canViewAll =
    auth.roleCode === 'owner' || auth.roleCode === 'hr' || auth.roleCode === 'finance';
  if (!canViewAll && row.employee_id !== auth.employee.id) {
    return c.json({ error: 'Forbidden: cannot access another employee payroll slip.' }, 403);
  }

  const key = row.slip_pdf_object_key || `slips/${row.payroll_run_id}/${row.employee_code}.pdf`;
  if (!row.slip_pdf_object_key) {
    const pdfBytes = await generatePayrollSlipPdf({
      runId: row.payroll_run_id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      employeeCode: row.employee_code,
      employeeName: row.full_name,
      employeeEmail: row.email,
      baseSalary: row.base_salary,
      allowances: row.allowances,
      overtimePay: row.overtime_pay,
      deductions: row.deductions,
      netSalary: row.net_salary,
      paidAt: row.paid_at ?? new Date(),
    });
    await uploadObject({ key, body: pdfBytes, contentType: 'application/pdf' });
  }

  const downloadUrl = await createPresignedDownloadUrl({ key, expiresIn: 3600 });
  return c.json({ object_key: key, download_url: downloadUrl });
});

export const payrollPlugin: ErpModulePlugin = {
  id: 'payroll',
  basePath: '/payroll',
  router,
};
