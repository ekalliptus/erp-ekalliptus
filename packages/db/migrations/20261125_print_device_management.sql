-- Idempotent migration: device dry_run_mode and remote web-to-bridge WhatsApp command queue.

ALTER TABLE public.print_devices
  ADD COLUMN IF NOT EXISTS dry_run_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pending_command text,
  ADD COLUMN IF NOT EXISTS pending_command_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pending_command_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_command_result text;
