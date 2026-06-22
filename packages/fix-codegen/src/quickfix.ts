import type {
  ComponentDef,
  DataTypeDef,
  DictionaryJSON,
  FieldDef,
  MemberRef,
  MessageDef,
  Reqd,
} from '@boarteam/fix';

/**
 * Parse the QuickFIX `FIX44.xml` data dictionary into the same {@link DictionaryJSON}
 * contract the Markdown generator emits, so the two can be diffed field-for-field and
 * message-for-message (see {@link ./diff}). This is the **canonical cross-check** source
 * called for in the project plan: QuickFIX's XML is an independently-maintained encoding
 * of the FIX 4.4 spec, so a structural diff against it catches scraper drift in the
 * Markdown pipeline.
 *
 * QuickFIX models the per-message header and trailer once, in top-level `<header>` and
 * `<trailer>` sections, rather than as named components. To make messages directly
 * comparable to the Markdown dictionary — whose messages carry leading
 * `Standard Message Header` and trailing `Standard Message Trailer` component references —
 * this parser reifies those two sections as components of exactly those names and prepends
 * / appends references to them on every message.
 */

const HEADER_COMPONENT = 'Standard Message Header';
const TRAILER_COMPONENT = 'Standard Message Trailer';

/** A parsed XML element. The QuickFIX dictionary has no text nodes — only nested elements. */
interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
};

function xmlUnescape(text: string): string {
  let out = text;
  for (const [entity, char] of Object.entries(ENTITIES)) {
    out = out.split(entity).join(char);
  }
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );
  out = out.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
  return out.split('&amp;').join('&');
}

const ATTR_RE = /([A-Za-z_][\w:-]*)\s*=\s*(?:'([^']*)'|"([^"]*)")/g;

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw)) !== null) {
    attrs[m[1]!] = xmlUnescape(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

/**
 * A small, dependency-free XML reader sufficient for the QuickFIX dictionary dialect:
 * attribute-only elements, single- or double-quoted values, self-closing or container
 * tags, XML declarations and comments. It does not handle text content, CDATA, or
 * namespaces (none appear in the source). Malformed input throws — the vendored file is
 * trusted build-time input, not untrusted runtime data.
 */
export function parseXml(src: string): XmlNode {
  const root: XmlNode = { tag: '#root', attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      break;
    }
    // Comments may contain quotes and '>'; skip them before the quote-aware tag scan.
    if (src.startsWith('!--', lt + 1)) {
      const end = src.indexOf('-->', lt + 3);
      i = end === -1 ? n : end + 3;
      continue;
    }
    // Scan for the tag's '>' while skipping over quoted attribute values, so a literal '>'
    // inside an attribute (e.g. <a x='b>c'/>) does not truncate the tag.
    let gt = -1;
    let quote = '';
    for (let k = lt + 1; k < n; k++) {
      const ch = src[k]!;
      if (quote) {
        if (ch === quote) {
          quote = '';
        }
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        gt = k;
        break;
      }
    }
    if (gt === -1) {
      throw new Error(`Unterminated tag at offset ${lt}`);
    }
    const inner = src.slice(lt + 1, gt);
    i = gt + 1;

    if (inner.startsWith('?') || inner.startsWith('!')) {
      // XML declaration (`<?xml ?>`) or comment / doctype — skip. Comments may span lines.
      if (inner.startsWith('!--') && !inner.endsWith('--')) {
        const end = src.indexOf('-->', gt);
        i = end === -1 ? n : end + 3;
      }
      continue;
    }

    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim();
      const top = stack[stack.length - 1];
      if (!top || top.tag !== name) {
        throw new Error(`Mismatched closing tag </${name}>`);
      }
      stack.pop();
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = (selfClosing ? inner.slice(0, -1) : inner).trim();
    const space = body.search(/\s/);
    const tag = space === -1 ? body : body.slice(0, space);
    const attrs = space === -1 ? {} : parseAttrs(body.slice(space + 1));
    const node: XmlNode = { tag, attrs, children: [] };
    stack[stack.length - 1]!.children.push(node);
    if (!selfClosing) {
      stack.push(node);
    }
  }
  if (stack.length !== 1) {
    throw new Error(`Unclosed tag <${stack[stack.length - 1]!.tag}>`);
  }
  return root;
}

function child(node: XmlNode, tag: string): XmlNode | undefined {
  return node.children.find((c) => c.tag === tag);
}

function reqdOf(node: XmlNode): Reqd {
  // QuickFIX expresses only Y/N; it has no conditional (`C`) required-ness.
  return node.attrs.required === 'Y' ? 'Y' : 'N';
}

/**
 * Normalise a QuickFIX datatype name (`STRING`, `MULTIPLEVALUESTRING`, `MONTHYEAR`) and a
 * spec datatype name (`String`, `MultipleValueString`, `month-year`) to a common key, so
 * the two sources' differing capitalisation/punctuation conventions don't read as drift.
 */
export function normalizeTypeName(type: string): string {
  return type.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Map a QuickFIX type to one of the five base primitives (best-effort, for the synthesised
 * datatypes catalog). Only used to keep the produced {@link DictionaryJSON} self-consistent;
 * the cross-check compares fields, not datatype catalogs. */
function baseOf(type: string): DataTypeDef['base'] {
  const t = normalizeTypeName(type);
  if (t === 'DATA' || t === 'XMLDATA') {
    return 'data';
  }
  if (t === 'CHAR' || t === 'BOOLEAN') {
    return 'char';
  }
  if (['INT', 'LENGTH', 'SEQNUM', 'NUMINGROUP', 'TAGNUM', 'DAYOFMONTH'].includes(t)) {
    return 'int';
  }
  if (['FLOAT', 'QTY', 'PRICE', 'PRICEOFFSET', 'AMT', 'PERCENTAGE'].includes(t)) {
    return 'float';
  }
  return 'String';
}

/** Parse the QuickFIX XML text into the shared dictionary contract. */
export function parseQuickFix(xml: string): DictionaryJSON {
  const root = parseXml(xml);
  const fixEl = child(root, 'fix');
  if (!fixEl) {
    throw new Error('Not a QuickFIX dictionary: no <fix> root element');
  }

  const major = fixEl.attrs.major ?? '4';
  const minor = fixEl.attrs.minor ?? '4';
  const beginString = `FIX.${major}.${minor}`;

  // Fields, plus a name -> tag index (messages/components reference fields by name).
  const fieldsEl = child(fixEl, 'fields');
  const fields: Record<number, FieldDef> = {};
  const datatypes: Record<string, DataTypeDef> = {};
  const nameToTag = new Map<string, number>();
  for (const f of fieldsEl?.children ?? []) {
    if (f.tag !== 'field') {
      continue;
    }
    const tag = Number(f.attrs.number);
    const name = f.attrs.name ?? String(tag);
    const type = f.attrs.type ?? 'STRING';
    if (!Number.isInteger(tag)) {
      continue;
    }
    nameToTag.set(name, tag);
    if (!datatypes[type]) {
      datatypes[type] = { name: type, base: baseOf(type) };
    }
    const def: FieldDef = { tag, name, type };
    if (normalizeTypeName(type) === 'NUMINGROUP') {
      def.isGroupCounter = true;
    }
    const values = f.children.filter((c) => c.tag === 'value');
    if (values.length > 0) {
      def.enumValues = values.map((v) => ({
        value: v.attrs.enum ?? '',
        name: v.attrs.description ?? '',
        description: v.attrs.description ?? '',
      }));
    }
    fields[tag] = def;
  }

  const tagFor = (name: string): number => {
    const tag = nameToTag.get(name);
    if (tag === undefined) {
      throw new Error(`QuickFIX references unknown field "${name}"`);
    }
    return tag;
  };

  const buildMembers = (node: XmlNode): MemberRef[] => {
    const out: MemberRef[] = [];
    for (const c of node.children) {
      if (c.tag === 'field') {
        out.push({ kind: 'field', tag: tagFor(c.attrs.name!), reqd: reqdOf(c) });
      } else if (c.tag === 'component') {
        out.push({ kind: 'component', name: c.attrs.name!, reqd: reqdOf(c) });
      } else if (c.tag === 'group') {
        out.push({
          kind: 'group',
          counterTag: tagFor(c.attrs.name!),
          reqd: reqdOf(c),
          members: buildMembers(c),
        });
      }
    }
    return out;
  };

  // Components, plus the reified header/trailer components.
  const components: Record<string, ComponentDef> = {};
  const headerEl = child(fixEl, 'header');
  const trailerEl = child(fixEl, 'trailer');
  if (headerEl) {
    components[HEADER_COMPONENT] = { name: HEADER_COMPONENT, members: buildMembers(headerEl) };
  }
  if (trailerEl) {
    components[TRAILER_COMPONENT] = { name: TRAILER_COMPONENT, members: buildMembers(trailerEl) };
  }
  const componentsEl = child(fixEl, 'components');
  for (const c of componentsEl?.children ?? []) {
    if (c.tag !== 'component' || !c.attrs.name) {
      continue;
    }
    components[c.attrs.name] = { name: c.attrs.name, members: buildMembers(c) };
  }

  // Messages, wrapped with the header/trailer component references.
  const messagesEl = child(fixEl, 'messages');
  const messages: MessageDef[] = [];
  for (const m of messagesEl?.children ?? []) {
    if (m.tag !== 'message' || !m.attrs.name) {
      continue;
    }
    const body = buildMembers(m);
    const members: MemberRef[] = [
      { kind: 'component', name: HEADER_COMPONENT, reqd: 'Y' },
      ...body,
      { kind: 'component', name: TRAILER_COMPONENT, reqd: 'Y' },
    ];
    messages.push({
      name: m.attrs.name,
      msgType: m.attrs.msgtype ?? '',
      category: m.attrs.msgcat === 'admin' ? 'admin' : 'app',
      members,
    });
  }

  return {
    version: beginString,
    beginString,
    source: {
      generator: '@boarteam/fix-codegen',
      spec: `QuickFIX ${beginString} XML data dictionary`,
      generatedFrom: 'quickfix-xml',
    },
    datatypes,
    fields,
    components,
    messages,
  };
}
