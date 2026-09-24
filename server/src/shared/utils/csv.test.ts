import { describe, expect, it } from 'vitest';
import { neutralizeExportCell, toCsv } from './csv.js';

const COLS = [
  { key: 'a', header: 'A' },
  { key: 'b', header: 'B' },
];

describe('toCsv', () => {
  it.each(['=x', '+x', '-x', '@x', '\tx', '\rx'])('neutralizeExportCell neutralizes %j', (value) => {
    expect(neutralizeExportCell(value)).toBe(`'${value}`);
  });

  it('prepends a BOM, uses CRLF endings, and a trailing CRLF', () => {
    const out = toCsv([{ a: '1', b: '2' }], COLS);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out).toBe('﻿A,B\r\n1,2\r\n');
  });

  it('emits only the header row for an empty set', () => {
    expect(toCsv([], COLS)).toBe('﻿A,B\r\n');
  });

  it('serializes null/undefined as empty, Date as ISO, bigint as digits', () => {
    const out = toCsv([{ a: null, b: undefined }], COLS);
    expect(out).toBe('﻿A,B\r\n,\r\n');
    const date = new Date('2026-07-06T00:00:00.000Z');
    expect(toCsv([{ a: date, b: 42n }], COLS)).toBe('﻿A,B\r\n2026-07-06T00:00:00.000Z,42\r\n');
  });

  it('quotes and doubles embedded quotes / commas / newlines (RFC-4180)', () => {
    const out = toCsv([{ a: 'x,y', b: 'he said "hi"\nbye' }], COLS);
    expect(out).toBe('﻿A,B\r\n"x,y","he said ""hi""\nbye"\r\n');
  });

  it('neutralizes = formula injection (Excel/Sheets)', () => {
    const out = toCsv([{ a: '=HYPERLINK("evil")', b: 'safe' }], COLS);
    expect(out).toBe('﻿A,B\r\n"\'=HYPERLINK(""evil"")",safe\r\n');
  });

  it('neutralizes + formula injection', () => {
    const out = toCsv([{ a: '+1', b: 'x' }], COLS);
    expect(out).toBe('﻿A,B\r\n\'+1,x\r\n');
  });

  it('neutralizes - formula injection (negative numbers accepted tradeoff)', () => {
    const out = toCsv([{ a: '-2', b: 'x' }], COLS);
    expect(out).toBe('﻿A,B\r\n\'-2,x\r\n');
  });

  it('neutralizes @ formula injection', () => {
    const out = toCsv([{ a: '@cmd', b: 'x' }], COLS);
    expect(out).toBe('﻿A,B\r\n\'@cmd,x\r\n');
  });

  it('neutralizes tab-prefixed formula injection', () => {
    const out = toCsv([{ a: '\tX', b: 'x' }], COLS);
    // \t triggers RFC-4180 quote? No — the RFC-4180 pattern is [",\r\n]. Tab is not.
    // So the output is just "'\tX" without quoting.
    expect(out).toBe("﻿A,B\r\n'\tX,x\r\n");
  });

  it('neutralizes CR-prefixed formula injection', () => {
    const out = toCsv([{ a: '\rX', b: 'x' }], COLS);
    // CR triggers RFC-4180 quoting.
    expect(out).toBe('﻿A,B\r\n"\'\rX",x\r\n');
  });

  it('applies formula-neutralization before quote-wrapping (both conditions fire)', () => {
    const out = toCsv([{ a: '=a,b', b: 'x' }], COLS);
    expect(out).toBe('﻿A,B\r\n"\'=a,b",x\r\n');
  });

  it.each([' =SUM(A1)', '  =x', ' +1', '  -2', ' @cmd', ' =x'])(
    'neutralizes formula after leading whitespace (%j)',
    (value) => {
      expect(neutralizeExportCell(value)).toBe(`'${value}`);
    },
  );

  it('leaves plain, Date, bigint and null cells unchanged (no false-positive prefix)', () => {
    const date = new Date('2026-07-06T00:00:00.000Z');
    expect(toCsv([{ a: 'plain', b: 'text' }], COLS)).toBe('﻿A,B\r\nplain,text\r\n');
    expect(toCsv([{ a: date, b: 5n }], COLS)).toBe('﻿A,B\r\n2026-07-06T00:00:00.000Z,5\r\n');
    expect(toCsv([{ a: null, b: undefined }], COLS)).toBe('﻿A,B\r\n,\r\n');
  });
});
