export interface TextChunk {
  content: string;
  start: number;
  end: number;
}

export function chunkText(input: string, chunkSize: number, overlap: number): string[] {
  return chunkTextWithOffsets(input, chunkSize, overlap).map((chunk) => chunk.content);
}

export function chunkTextWithOffsets(input: string, chunkSize: number, overlap: number): TextChunk[] {
  const text = input.trim();
  if (!text) {
    return [];
  }

  if (text.length <= chunkSize) {
    return [{ content: text, start: 0, end: text.length }];
  }

  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(text.length, start + chunkSize);
    const content = text.slice(start, end).trim();
    if (content) {
      chunks.push({ content, start, end });
    }
    if (end === text.length) {
      break;
    }
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

export function lexicalScore(query: string, content: string): number {
  const q = tokenize(query);
  const c = tokenize(content);

  if (q.length === 0 || c.length === 0) {
    return 0;
  }

  const set = new Set(c);
  let hits = 0;
  for (const token of q) {
    if (set.has(token)) {
      hits += 1;
    }
  }

  return hits / q.length;
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean);
}
