-- Add 'web_mobile' category to portfolio_projects check constraint.
ALTER TABLE public.portfolio_projects
  DROP CONSTRAINT IF EXISTS portfolio_projects_category_chk;

ALTER TABLE public.portfolio_projects
  ADD CONSTRAINT portfolio_projects_category_chk CHECK (
    category IN ('website', 'mobile_app', 'web_mobile', 'erp_system', 'ui_ux', 'automation', 'other')
  );
