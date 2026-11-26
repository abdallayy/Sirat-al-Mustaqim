export function selectDailyItems<T>(
  items: readonly T[],
  dateKey: string,
  session: string,
  count: number,
): T[] {
  const shuffled = [...items];
  let seed = 0;
  for (const character of `${dateKey}:${session}`) {
    seed = (seed * 31 + character.charCodeAt(0)) >>> 0;
  }
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const swapIndex = seed % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, Math.min(Math.max(0, count), shuffled.length));
}
