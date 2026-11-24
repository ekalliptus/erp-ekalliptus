-- Idempotent migration for portfolio_projects and RBAC portfolio permissions.
CREATE TABLE IF NOT EXISTS public.portfolio_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  tagline text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'website',
  offer_type text NOT NULL DEFAULT 'hybrid',
  availability_status text NOT NULL DEFAULT 'available',
  price_type text NOT NULL DEFAULT 'fixed',
  price_amount bigint,
  original_price_amount bigint,
  currency text NOT NULL DEFAULT 'IDR',
  client_name text,
  delivery_estimate text,
  demo_url text,
  cover_image_key text,
  cover_image_url text,
  gallery_image_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  gallery_image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  tech_stack jsonb NOT NULL DEFAULT '[]'::jsonb,
  highlights jsonb NOT NULL DEFAULT '[]'::jsonb,
  whatsapp_prefill text,
  is_featured boolean NOT NULL DEFAULT false,
  is_published boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  published_at timestamptz,
  created_by uuid REFERENCES public.employees(id),
  updated_by uuid REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portfolio_projects_category_chk CHECK (
    category IN ('website', 'mobile_app', 'erp_system', 'ui_ux', 'automation', 'other')
  ),
  CONSTRAINT portfolio_projects_offer_type_chk CHECK (
    offer_type IN ('ready_to_buy', 'custom_similar', 'hybrid')
  ),
  CONSTRAINT portfolio_projects_availability_chk CHECK (
    availability_status IN ('available', 'custom_only', 'sold')
  ),
  CONSTRAINT portfolio_projects_price_type_chk CHECK (
    price_type IN ('fixed', 'starting_from', 'negotiable')
  ),
  CONSTRAINT portfolio_projects_price_nonneg_chk CHECK (
    price_amount IS NULL OR price_amount >= 0
  ),
  CONSTRAINT portfolio_projects_orig_price_nonneg_chk CHECK (
    original_price_amount IS NULL OR original_price_amount >= 0
  )
);

CREATE INDEX IF NOT EXISTS portfolio_projects_pub_order_idx
  ON public.portfolio_projects (is_published, is_featured, sort_order, created_at DESC);

CREATE INDEX IF NOT EXISTS portfolio_projects_category_idx
  ON public.portfolio_projects (category);

INSERT INTO public.permissions (module, action)
VALUES
  ('portfolio', 'view'),
  ('portfolio', 'create'),
  ('portfolio', 'update'),
  ('portfolio', 'delete'),
  ('portfolio', 'approve'),
  ('portfolio', 'export')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code = 'owner'
  AND p.module = 'portfolio'
ON CONFLICT (role_id, permission_id) DO NOTHING;
