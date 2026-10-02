export function toMinor(value: string | number): number {
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Nominal tidak valid. Gunakan maksimal dua desimal.');
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('Nominal terlalu besar.');
  return result;
}
export function cartTotal(lines: { price: string | number; quantity: number }[]): number {
  return lines.reduce((sum, line) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) throw new Error('Jumlah harus bilangan bulat positif.');
    const total = sum + toMinor(line.price) * line.quantity;
    if (!Number.isSafeInteger(total)) throw new Error('Total terlalu besar.');
    return total;
  }, 0);
}
export function rupiah(value: string | number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 2 }).format(Number(value));
}
