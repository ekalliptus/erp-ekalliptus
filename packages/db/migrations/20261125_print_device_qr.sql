-- Idempotent migration: temporary WhatsApp QR / 8-digit pairing state for web-only Smart Printer pairing.

ALTER TABLE public.print_devices
  ADD COLUMN IF NOT EXISTS openwa_qr_code text,
  ADD COLUMN IF NOT EXISTS openwa_link_code text,
  ADD COLUMN IF NOT EXISTS openwa_qr_updated_at timestamptz;
