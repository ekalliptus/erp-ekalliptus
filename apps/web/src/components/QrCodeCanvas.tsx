import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';

interface QrCodeCanvasProps {
  value: string;
  size?: number;
  label?: string;
}

export function QrCodeCanvas({
  value,
  size = 220,
  label = 'QR Code pairing WhatsApp OpenWA',
}: QrCodeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value) return;

    let cancelled = false;
    setRenderError(false);

    QRCode.toCanvas(
      canvas,
      value,
      {
        width: size,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: {
          dark: '#0F172A',
          light: '#FFFFFF',
        },
      },
      (err) => {
        if (!cancelled && err) {
          setRenderError(true);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (renderError) {
    return (
      <div
        role="alert"
        className="flex items-center justify-center rounded-lg border border-border bg-canvas px-4 py-6 text-center text-xs text-text-secondary"
        style={{ width: size, height: size }}
      >
        Gagal merender QR Code. Tunggu QR berikutnya atau segarkan halaman.
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={label}
      className="inline-flex items-center justify-center rounded-lg border border-border bg-white p-3"
    >
      <canvas ref={canvasRef} width={size} height={size} className="block" />
    </div>
  );
}
