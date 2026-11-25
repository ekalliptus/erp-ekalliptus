-- Idempotent migration for Smart Printer Otomatis tables, indexes, RBAC permissions, finance category, and default pricing rules.

CREATE TABLE IF NOT EXISTS public.print_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_name text NOT NULL,
  host text,
  mdns_host text,
  model text NOT NULL DEFAULT 'HP Smart Tank 580-590 series',
  agent_token_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_heartbeat_at timestamptz,
  printer_state text NOT NULL DEFAULT 'unknown',
  printer_state_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ink_levels jsonb NOT NULL DEFAULT '[]'::jsonb,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  openwa_status text NOT NULL DEFAULT 'disconnected',
  created_by uuid REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.print_pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_size text NOT NULL,
  color_mode text NOT NULL,
  price_per_page bigint NOT NULL,
  duplex_discount_per_page bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'IDR',
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.employees(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT print_pricing_rules_paper_color_uq UNIQUE (paper_size, color_mode),
  CONSTRAINT print_pricing_rules_paper_chk CHECK (
    paper_size IN ('a4', 'f4', 'legal', 'letter', 'a5', '4x6', '5x7')
  ),
  CONSTRAINT print_pricing_rules_color_chk CHECK (color_mode IN ('color', 'mono')),
  CONSTRAINT print_pricing_rules_price_nonneg_chk CHECK (price_per_page >= 0),
  CONSTRAINT print_pricing_rules_duplex_nonneg_chk CHECK (duplex_discount_per_page >= 0)
);

CREATE TABLE IF NOT EXISTS public.print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_code text NOT NULL UNIQUE,
  source text NOT NULL DEFAULT 'whatsapp',
  device_id uuid REFERENCES public.print_devices(id),
  wa_message_id text,
  wa_chat_id text,
  customer_name text,
  customer_phone text,
  customer_note text,
  file_name text NOT NULL,
  file_mime text NOT NULL,
  file_size_bytes bigint NOT NULL,
  file_object_key text NOT NULL,
  detected_page_count integer NOT NULL DEFAULT 1,
  paper_size text NOT NULL DEFAULT 'a4',
  color_mode text NOT NULL DEFAULT 'color',
  quality text NOT NULL DEFAULT 'normal',
  copies integer NOT NULL DEFAULT 1,
  orientation text NOT NULL DEFAULT 'auto',
  fit text NOT NULL DEFAULT 'contain',
  borderless boolean NOT NULL DEFAULT false,
  duplex boolean NOT NULL DEFAULT false,
  page_range text,
  pages_to_print integer NOT NULL DEFAULT 1,
  unit_price_per_page bigint NOT NULL DEFAULT 0,
  discount_amount bigint NOT NULL DEFAULT 0,
  total_price bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending_approval',
  reject_reason text,
  ipp_job_id integer,
  error_message text,
  finance_account_id uuid REFERENCES public.finance_accounts(id),
  finance_transaction_id uuid REFERENCES public.finance_transactions(id),
  finance_posted_at timestamptz,
  approved_by uuid REFERENCES public.employees(id),
  approved_at timestamptz,
  printed_at timestamptz,
  file_deleted_at timestamptz,
  created_by uuid REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT print_jobs_source_chk CHECK (source IN ('whatsapp', 'manual_web', 'manual_mobile')),
  CONSTRAINT print_jobs_paper_chk CHECK (
    paper_size IN ('a4', 'f4', 'legal', 'letter', 'a5', '4x6', '5x7')
  ),
  CONSTRAINT print_jobs_color_chk CHECK (color_mode IN ('color', 'mono')),
  CONSTRAINT print_jobs_quality_chk CHECK (quality IN ('draft', 'normal', 'high')),
  CONSTRAINT print_jobs_orientation_chk CHECK (orientation IN ('auto', 'portrait', 'landscape')),
  CONSTRAINT print_jobs_fit_chk CHECK (fit IN ('contain', 'cover', 'stretch')),
  CONSTRAINT print_jobs_status_chk CHECK (
    status IN ('pending_approval', 'approved', 'queued', 'printing', 'printed', 'rejected', 'failed', 'cancelled')
  ),
  CONSTRAINT print_jobs_copies_chk CHECK (copies >= 1 AND copies <= 99),
  CONSTRAINT print_jobs_discount_nonneg_chk CHECK (discount_amount >= 0),
  CONSTRAINT print_jobs_total_nonneg_chk CHECK (total_price >= 0)
);

CREATE INDEX IF NOT EXISTS print_jobs_status_created_idx
  ON public.print_jobs (status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS print_jobs_wa_message_uq
  ON public.print_jobs (wa_message_id)
  WHERE wa_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.print_wa_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.print_jobs(id) ON DELETE CASCADE,
  device_id uuid REFERENCES public.print_devices(id),
  wa_chat_id text NOT NULL,
  kind text NOT NULL,
  message_text text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT print_wa_outbox_kind_chk CHECK (
    kind IN ('received', 'approved', 'printed', 'rejected', 'failed')
  ),
  CONSTRAINT print_wa_outbox_status_chk CHECK (status IN ('pending', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS print_wa_outbox_device_status_idx
  ON public.print_wa_outbox (device_id, status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS print_wa_outbox_job_kind_uq
  ON public.print_wa_outbox (job_id, kind)
  WHERE job_id IS NOT NULL;

INSERT INTO public.permissions (module, action)
VALUES
  ('printer', 'view'),
  ('printer', 'create'),
  ('printer', 'update'),
  ('printer', 'delete'),
  ('printer', 'approve'),
  ('printer', 'export')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE (
  (r.code = 'owner' AND p.module = 'printer')
  OR (r.code = 'finance' AND p.module = 'printer' AND p.action IN ('view', 'approve', 'update'))
  OR (r.code = 'staff' AND p.module = 'printer' AND p.action IN ('view', 'create', 'approve'))
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.finance_categories (name, kind)
VALUES ('Jasa Cetak & Print', 'income')
ON CONFLICT (name, kind) DO NOTHING;

INSERT INTO public.print_pricing_rules (paper_size, color_mode, price_per_page, duplex_discount_per_page, currency, is_active)
VALUES
  ('a4', 'mono', 500, 0, 'IDR', true),
  ('a4', 'color', 1500, 0, 'IDR', true),
  ('f4', 'mono', 600, 0, 'IDR', true),
  ('f4', 'color', 1800, 0, 'IDR', true),
  ('legal', 'mono', 600, 0, 'IDR', true),
  ('legal', 'color', 1800, 0, 'IDR', true),
  ('letter', 'mono', 500, 0, 'IDR', true),
  ('letter', 'color', 1500, 0, 'IDR', true),
  ('a5', 'mono', 400, 0, 'IDR', true),
  ('a5', 'color', 1000, 0, 'IDR', true),
  ('4x6', 'mono', 2000, 0, 'IDR', true),
  ('4x6', 'color', 3500, 0, 'IDR', true),
  ('5x7', 'mono', 3000, 0, 'IDR', true),
  ('5x7', 'color', 5000, 0, 'IDR', true)
ON CONFLICT (paper_size, color_mode) DO NOTHING;
