export function padEnd(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }
  return value + " ".repeat(width - value.length);
}

export function padStart(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }
  return " ".repeat(width - value.length) + value;
}

export function columnWidth(values: readonly string[], min = 8): number {
  let max = min;
  for (const value of values) {
    if (value.length > max) {
      max = value.length;
    }
  }
  return max;
}
