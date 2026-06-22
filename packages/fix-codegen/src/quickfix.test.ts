import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeTypeName, parseQuickFix, parseXml } from './quickfix';

const XML_PATH = fileURLToPath(new URL('../vendor/quickfix/FIX44.xml', import.meta.url));

describe('parseXml', () => {
  it('parses nested elements, attributes, and self-closing tags', () => {
    const root = parseXml(
      `<?xml version='1.0'?>\n<fix major='4' minor='4'>\n <fields>\n  <field number='1' name='Account' type='STRING' />\n </fields>\n</fix>`,
    );
    const fix = root.children[0]!;
    expect(fix.tag).toBe('fix');
    expect(fix.attrs).toMatchObject({ major: '4', minor: '4' });
    const field = fix.children[0]!.children[0]!;
    expect(field).toMatchObject({
      tag: 'field',
      attrs: { number: '1', name: 'Account', type: 'STRING' },
    });
  });

  it('decodes XML entities and double-quoted attributes', () => {
    const root = parseXml(`<a desc="x &amp; y" note='&lt;ok&gt;' />`);
    expect(root.children[0]!.attrs).toMatchObject({ desc: 'x & y', note: '<ok>' });
  });

  it('skips comments and tolerates them spanning a tag boundary', () => {
    const root = parseXml(`<r><!-- a <field/> comment --><x/></r>`);
    expect(root.children[0]!.children.map((c) => c.tag)).toEqual(['x']);
  });

  it('tolerates comments containing quotes and > characters', () => {
    const root = parseXml(`<r><!-- it's > fine --><x a='1'/></r>`);
    expect(root.children[0]!.children.map((c) => c.tag)).toEqual(['x']);
    expect(root.children[0]!.children[0]!.attrs.a).toBe('1');
  });

  it('does not truncate a tag on a > inside an attribute value', () => {
    const root = parseXml(`<a x='b>c' y='d'/>`);
    expect(root.children[0]!.attrs).toMatchObject({ x: 'b>c', y: 'd' });
  });

  it('decodes decimal and hexadecimal numeric character references', () => {
    const root = parseXml(`<a d='&#66;' h='&#x42;' />`);
    expect(root.children[0]!.attrs).toMatchObject({ d: 'B', h: 'B' });
  });

  it('throws on a mismatched closing tag (trusted build input)', () => {
    expect(() => parseXml('<a></b>')).toThrow();
    expect(() => parseXml('<a>')).toThrow(/Unclosed/);
  });
});

describe('parseQuickFix (synthetic)', () => {
  const dict = parseQuickFix(`
    <fix major='4' minor='4'>
      <header><field name='BeginString' required='Y'/></header>
      <trailer><field name='CheckSum' required='Y'/></trailer>
      <fields>
        <field number='8' name='BeginString' type='STRING'/>
        <field number='10' name='CheckSum' type='STRING'/>
        <field number='55' name='Symbol' type='STRING'/>
        <field number='268' name='NoMDEntries' type='NUMINGROUP'/>
        <field number='269' name='MDEntryType' type='CHAR'>
          <value enum='0' description='BID'/>
          <value enum='1' description='OFFER'/>
        </field>
      </fields>
      <components>
        <component name='Instrument'><field name='Symbol' required='Y'/></component>
      </components>
      <messages>
        <message name='MarketData' msgtype='W' msgcat='app'>
          <component name='Instrument' required='Y'/>
          <group name='NoMDEntries' required='Y'>
            <field name='MDEntryType' required='Y'/>
          </group>
        </message>
      </messages>
    </fix>`);

  it('indexes fields by tag and marks NumInGroup counters', () => {
    expect(dict.fields[55]!.name).toBe('Symbol');
    expect(dict.fields[268]!.isGroupCounter).toBe(true);
    expect(dict.fields[269]!.enumValues?.map((v) => v.value)).toEqual(['0', '1']);
  });

  it('reifies header/trailer as components and wraps each message with them', () => {
    expect(dict.components['Standard Message Header']).toBeDefined();
    expect(dict.components['Standard Message Trailer']).toBeDefined();
    const w = dict.messages.find((m) => m.msgType === 'W')!;
    expect(w.members[0]).toMatchObject({ kind: 'component', name: 'Standard Message Header' });
    expect(w.members.at(-1)).toMatchObject({ kind: 'component', name: 'Standard Message Trailer' });
  });

  it('resolves group counter names to tags', () => {
    const w = dict.messages.find((m) => m.msgType === 'W')!;
    const group = w.members.find((m) => m.kind === 'group');
    expect(group).toMatchObject({ kind: 'group', counterTag: 268 });
  });

  it('throws when a message references an unknown field name', () => {
    expect(() =>
      parseQuickFix(
        `<fix><fields/><messages><message name='X' msgtype='X'><field name='Nope'/></message></messages></fix>`,
      ),
    ).toThrow(/unknown field/);
  });
});

describe('parseQuickFix (vendored FIX44.xml)', () => {
  const dict = parseQuickFix(readFileSync(XML_PATH, 'utf8'));

  it('parses the full surface', () => {
    expect(dict.beginString).toBe('FIX.4.4');
    expect(dict.messages.length).toBe(93);
    // 26 spec components + the two reified header/trailer components.
    expect(Object.keys(dict.fields).length).toBeGreaterThan(900);
    expect(dict.fields[55]!.name).toBe('Symbol');
    expect(dict.fields[268]!.isGroupCounter).toBe(true);
  });
});

describe('normalizeTypeName', () => {
  it('collapses casing and punctuation so the two sources align', () => {
    expect(normalizeTypeName('String')).toBe(normalizeTypeName('STRING'));
    expect(normalizeTypeName('month-year')).toBe(normalizeTypeName('MONTHYEAR'));
    expect(normalizeTypeName('MultipleValueString')).toBe('MULTIPLEVALUESTRING');
  });
});
