import { describe, expect, it } from 'vitest';
import { neutralizeExportCell, toCsv } from './csv';

describe('neutralizeExportCell', () => {
  it.each(['=x', '+x', '-x', '@x', '\tx', '\rx', '  =SUM(A1)'])(
    'neutralizes %j',
    (value) => {
      expect(neutralizeExportCell(value)).toBe(`'${value}`);
    },
  );

  it('leaves ordinary text alone', () => {
    expect(neutralizeExportCell('Great coffee')).toBe('Great coffee');
    expect(neutralizeExportCell(5)).toBe('5');
  });

  it('renders empty for null and undefined', () => {
    expect(neutralizeExportCell(null)).toBe('');
    expect(neutralizeExportCell(undefined)).toBe('');
  });

  it('serializes Date as ISO-8601 and bigint as digits', () => {
    expect(neutralizeExportCell(new Date('2026-07-20T09:00:00.000Z'))).toBe(
      '2026-07-20T09:00:00.000Z',
    );
    expect(neutralizeExportCell(42n)).toBe('42');
  });
});

describe('toCsv', () => {
  const columns = [
    { key: 'a', header: 'a' },
    { key: 'b', header: 'b' },
  ];

  it('emits a BOM, CRLF rows and a trailing CRLF', () => {
    const csv = toCsv([{ a: '1', b: '2' }], columns);
    expect(csv).toBe('﻿a,b\r\n1,2\r\n');
  });

  it('quotes fields containing a comma, quote or newline and doubles quotes', () => {
    const csv = toCsv([{ a: 'x,y', b: 'he said "hi"\nagain' }], columns);
    expect(csv).toContain('"x,y"');
    expect(csv).toContain('"he said ""hi""\nagain"');
  });

  it('neutralizes a formula BEFORE quoting so the cell round-trips as text', () => {
    expect(toCsv([{ a: '=a,b', b: '' }], columns)).toContain('"\'=a,b"');
  });
});
