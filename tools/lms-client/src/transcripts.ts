import { ClientError } from './errors.js';
function invalid(): never {
  throw new ClientError('TRANSCRIPT_INVALID', 'Некоректний формат субтитрів VTT.', 5);
}
function timestamp(value: string): { milliseconds: number; label: string } {
  const match = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(value);
  if (!match) invalid();
  const hours = Number(match[1] ?? 0),
    minutes = Number(match[2]),
    seconds = Number(match[3]),
    ms = Number(match[4]);
  return {
    milliseconds: ((hours * 60 + minutes) * 60 + seconds) * 1000 + ms,
    label: `${String(hours).padStart(2, '0')}:${match[2] ?? ''}:${match[3] ?? ''}.${match[4] ?? ''}`,
  };
}
function cueText(value: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    nbsp: ' ',
    lrm: '',
    rlm: '',
  };
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|nbsp|lrm|rlm);/gi, (whole: string, key: string) => {
      if (!key.startsWith('#')) return entities[key.toLowerCase()] ?? whole;
      const number =
        key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}
export function vttToText(raw: string): string {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!/^WEBVTT(?:[ \t].*)?\n/.test(text)) invalid();
  const output: string[] = [];
  const seen = new Set<string>();
  let previous = { text: '', end: -1 };
  for (const block of text.split(/\n[ \t]*\n/).slice(1)) {
    const lines = block.trim().split('\n');
    if (!lines[0] || /^(NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0])) continue;
    const timingIndex = lines.findIndex(line => line.includes('-->'));
    if (timingIndex < 0 || timingIndex > 1) invalid();
    const timing = /^(\S+)\s+-->\s+(\S+)(?:[ \t].*)?$/.exec(lines[timingIndex] ?? '');
    if (!timing) invalid();
    const start = timestamp(timing[1] ?? ''),
      end = timestamp(timing[2] ?? '');
    if (end.milliseconds < start.milliseconds) invalid();
    const full = cueText(lines.slice(timingIndex + 1).join(' '));
    if (!full) continue;
    const key = `${String(start.milliseconds)}|${String(end.milliseconds)}|${full}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let content = full;
    if (start.milliseconds < previous.end) {
      const before = previous.text.split(' '),
        current = full.split(' ');
      for (let length = Math.min(before.length, current.length); length > 0; length--) {
        if (before.slice(-length).join(' ') === current.slice(0, length).join(' ')) {
          content = current.slice(length).join(' ');
          break;
        }
      }
    }
    if (content) output.push(`[${start.label}] ${content}`);
    previous = { text: full, end: end.milliseconds };
  }
  if (!output.length) invalid();
  return `${output.join('\n\n')}\n`;
}
