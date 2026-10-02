import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'MyEkalliptus | Operasional', description: 'Ruang kerja ritel, servis, proyek, dan keuangan.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
