/**
 * Simple RFC-style CSV parser (handles quoted fields and escaped quotes).
 */
export function parseCsvText(text: string): string[][] {
  const result: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        currentRow.push(currentField);
        currentField = '';
      } else if (c === '\r') {
        if (i + 1 < text.length && text[i + 1] === '\n') i++;
        currentRow.push(currentField);
        currentField = '';
        result.push(currentRow);
        currentRow = [];
      } else if (c === '\n') {
        currentRow.push(currentField);
        currentField = '';
        result.push(currentRow);
        currentRow = [];
      } else {
        currentField += c;
      }
    }
    i++;
  }
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    result.push(currentRow);
  }
  return result;
}
