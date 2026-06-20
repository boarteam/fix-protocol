import { describe, expect, it } from 'vitest';
import { parseDatatypes } from './datatypes';
import { parseField, sanitizeIdentifier } from './fields';
import { htmlUnescape, tableCells } from './markdown';
import { parseMemberTable } from './table';

describe('markdown helpers', () => {
  it('decodes HTML entities, &amp; last', () => {
    expect(htmlUnescape('&lt;Instrument&gt;')).toBe('<Instrument>');
    expect(htmlUnescape('a &amp;lt; b')).toBe('a &lt; b');
    expect(htmlUnescape('Today &#39;now&#39;')).toBe("Today 'now'");
  });

  it('splits table cells honouring escaped pipes', () => {
    expect(tableCells('| int | maps as \\|21=723\\| here |')).toEqual([
      'int',
      'maps as |21=723| here',
    ]);
  });
});

describe('sanitizeIdentifier', () => {
  it('PascalCases prose and drops parentheticals', () => {
    expect(sanitizeIdentifier('Sell short')).toBe('SellShort');
    expect(sanitizeIdentifier('Undisclosed (valid for IOI only)')).toBe('Undisclosed');
    expect(sanitizeIdentifier('"As Defined"')).toBe('AsDefined');
  });

  it('prefixes results that would start with a digit', () => {
    expect(sanitizeIdentifier('1st')).toBe('_1st');
  });

  it('keeps text after a mid-string parenthetical (no lossy collision)', () => {
    // The FIX 4.4 Network Status Request/Response pair: a mid-string parenthetical must
    // not collapse both names to "Network".
    expect(sanitizeIdentifier('Network (Counterparty System) Status Request')).toBe(
      'NetworkStatusRequest',
    );
    expect(sanitizeIdentifier('Network (Counterparty System) Status Response')).toBe(
      'NetworkStatusResponse',
    );
  });
});

describe('parseField', () => {
  // Note the UTF-8 middle dot in the Tag/Type line, and the leading erd-map block.
  const sideMd = `<!-- erd-map -->
> [!NOTE]
> annotation that must be ignored, mentions \`char\` and **Type:** noise
<!-- /erd-map -->

# Side (Tag 54)

**Tag:** 54 · **Type:** char

Side of order.

## Valid values

| Value | Description |
| --- | --- |
| \`'1'\` | Buy |
| \`'2'\` | Sell |
| \`'A'\` | "As Defined" |

## Used in

- somewhere
`;

  it('reads tag, name, type, description and unwrapped enum values', () => {
    const field = parseField(sideMd)!;
    expect(field).toMatchObject({
      tag: 54,
      name: 'Side',
      type: 'char',
      description: 'Side of order.',
    });
    expect(field.enumValues).toEqual([
      { value: '1', name: 'Buy', description: 'Buy' },
      { value: '2', name: 'Sell', description: 'Sell' },
      { value: 'A', name: 'AsDefined', description: '"As Defined"' },
    ]);
  });

  it('skips the erd-map block (does not read its **Type:** noise)', () => {
    expect(parseField(sideMd)!.type).toBe('char');
  });

  it('flags NumInGroup fields as group counters and tolerates a missing enum table', () => {
    const md = `# NoMDEntries (Tag 268)\n\n**Tag:** 268 · **Type:** NumInGroup\n\nNumber of entries.\n`;
    const field = parseField(md)!;
    expect(field.isGroupCounter).toBe(true);
    expect(field.enumValues).toBeUndefined();
  });

  it('de-duplicates colliding enum identifiers and HTML-unescapes a non-wrapped value', () => {
    const md = `# Demo (Tag 999)

**Tag:** 999 · **Type:** char

Demo.

## Valid values

| Value | Description |
| --- | --- |
| \`'1'\` | Other |
| \`'2'\` | Other |
| 3 &lt; 4 | Bare &amp; entity value |
`;
    const field = parseField(md)!;
    expect(field.enumValues).toEqual([
      { value: '1', name: 'Other', description: 'Other' },
      { value: '2', name: 'Other_1', description: 'Other' }, // collision -> _1 suffix
      { value: '3 < 4', name: 'BareEntityValue', description: 'Bare & entity value' }, // unwrap fallback + unescape
    ]);
  });
});

describe('parseDatatypes', () => {
  const md = `# FIX 4.4 Data Types

| Name | Description |
| --- | --- |
| int | Sequence of digits, e.g. \\|21=723\\|. |
| » NumInGroup | Int field representing entries. |
| float | Digits with optional decimal. |
| » Price | Float field representing a price. |
| String | Free-format strings. |
| » MultipleValueString | Space delimited values. |
| data | Raw data, preceded by a length field. |
`;

  it('derives parent/base positionally and tags special datatypes', () => {
    const dt = parseDatatypes(md);
    expect(dt['NumInGroup']).toMatchObject({ base: 'int', parent: 'int' });
    expect(dt['Price']).toMatchObject({ base: 'float', parent: 'float' });
    expect(dt['MultipleValueString']).toMatchObject({ base: 'String', multiValueDelimiter: ' ' });
    expect(dt['data']).toMatchObject({ base: 'data', lengthPrefixed: true });
    expect(dt['int']!.parent).toBeUndefined();
  });
});

describe('parseMemberTable', () => {
  const md = `# Some Message (MsgType = Z)

| Tag | Field Name | Req'd | Comments |
| --- | --- | --- | --- |
|  | [&lt;Standard Message Header&gt;](../components/Standard_Message_Header.md) | Y | MsgType = Z |
| 146 | [NoRelatedSym](../fields/tag_146_NoRelatedSym.md) | N | count |
| 55 | » [Symbol](../fields/tag_55_Symbol.md) | Y | first in group |
|  | » [&lt;Instrument&gt;](../components/Instrument.md) | N | component inside group |
|  | [&lt;Standard Message Trailer&gt;](../components/Standard_Message_Trailer.md) | Y |  |
`;

  it('captures depth, field refs, and component refs (by link basename)', () => {
    const rows = parseMemberTable(md.split('\n'));
    expect(rows).toEqual([
      {
        depth: 0,
        reqd: 'Y',
        component: { file: 'Standard_Message_Header', linkText: '&lt;Standard Message Header&gt;' },
      },
      { depth: 0, reqd: 'N', field: { tag: 146, name: 'NoRelatedSym' } },
      { depth: 1, reqd: 'Y', field: { tag: 55, name: 'Symbol' } },
      { depth: 1, reqd: 'N', component: { file: 'Instrument', linkText: '&lt;Instrument&gt;' } },
      {
        depth: 0,
        reqd: 'Y',
        component: {
          file: 'Standard_Message_Trailer',
          linkText: '&lt;Standard Message Trailer&gt;',
        },
      },
    ]);
  });
});
