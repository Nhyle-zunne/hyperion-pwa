export function fitPosterText(
  text: string,
  options: { maxWidth: number; preferredSize: number; minSize: number; maxLines: number },
  measureWidth: (text: string, fontSize: number) => number,
): { fontSize: number; lines: string[] } | null
