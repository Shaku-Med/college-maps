/**
 * The same color with a new opacity, for map paint, which takes rgba but not theme variables or color-mix.
 * Accepts #rgb, #rrggbb, rgb() and rgba(); anything else comes back unchanged.
 */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].replace(/./g, (digit) => digit + digit) : hex[1];
    const [r, g, b] = [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const rgb = color.trim().match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  return rgb ? `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})` : color;
}

const channels = (color: string): [number, number, number] | null => {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].replace(/./g, (digit) => digit + digit) : hex[1];
    return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)) as [number, number, number];
  }
  const rgb = color.trim().match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
};

/** A solid color part way from one theme color to another, for map paint; `from` comes back when either cannot be read. */
export function mixColor(from: string, to: string, share: number): string {
  const a = channels(from);
  const b = channels(to);
  if (!a || !b) return from;
  const [r, g, bl] = a.map((value, i) => Math.round(value + (b[i] - value) * share));
  return `rgb(${r}, ${g}, ${bl})`;
}
