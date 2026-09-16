let context: CanvasRenderingContext2D | null = null;

// MapLibre cannot parse oklch, so theme tokens are painted once and read back as rgba.
export function resolveCssColor(variable: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  if (!value) return fallback;

  context ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!context) return fallback;

  context.clearRect(0, 0, 1, 1);
  context.fillStyle = fallback;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}
