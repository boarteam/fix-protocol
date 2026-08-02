import { Dictionary, loadDictionary } from './Dictionary';
import type {
  ComponentDef,
  DictionaryJSON,
  EnumValue,
  FieldDef,
  MemberRef,
  MessageDef,
} from './types';

/**
 * FIXT support: the transport/application dictionary pair.
 *
 * Under FIXT.1.1 the session protocol and the application version split: tag 8 carries
 * `FIXT.1.1` while the application version rides on `DefaultApplVerID(1137)` (Logon) and the
 * optional per-message header override `ApplVerID(1128)`. This module gives the engine that
 * split as data: a {@link FixtDictionaries} pair every codec entry point accepts alongside a
 * plain dictionary, a runtime {@link mergeFixtDictionaries} (the documented-lossy
 * convenience that produces a self-contained single dictionary, mirroring what the codegen
 * does for `@boarteam/fix-dict-fix50sp2`), and the resolved per-pair machinery the codec
 * uses internally (merged view + envelope tag set for layer attribution).
 *
 * Design stance (matching the engine's "pure, dictionary-driven, non-throwing" rules):
 * - **No session state.** `DefaultApplVerID` is an input on the pair, never remembered from
 *   a parsed Logon.
 * - **Parsing/encoding run over the merged view** — structurally, a FIXT message *is* its
 *   app body wrapped in the transport envelope, and the merged dictionary is exactly that
 *   union (admin MsgTypes never collide with app ones).
 * - **Validation adds layer attribution** on top of the merged verdict: every issue is
 *   tagged `session` (transport-owned: admin messages, envelope fields) or `application`,
 *   so callers can choose between a session `Reject(3)` and a `BusinessMessageReject(j)`.
 */
export interface FixtDictionaries {
  /** The transport (session) dictionary — FIXT.1.1 envelope + admin messages. */
  transport: Dictionary | DictionaryJSON;
  /**
   * The application dictionary. Either an application-layer dictionary (envelope-less
   * messages — they are wrapped with the transport envelope at merge time) or a
   * self-contained merged dictionary like `@boarteam/fix-dict-fix50sp2` (used as-is).
   */
  app: Dictionary | DictionaryJSON;
  /**
   * Optional multi-version resolver (the QuickFIX/J `DataDictionaryProvider` model): maps an
   * `ApplVerID` code (per-message tag 1128, falling back to {@link defaultApplVerID}) to the
   * application dictionary for that version. Return `undefined` to fall back to {@link app}.
   */
  resolveApp?: (applVerID: string) => Dictionary | DictionaryJSON | undefined;
  /**
   * The session's `DefaultApplVerID(1137)` — a caller-supplied input (the engine holds no
   * session state). Used only to route {@link resolveApp} when a message carries no
   * per-message `ApplVerID(1128)`.
   */
  defaultApplVerID?: string;
}

/** Whether a dictionaries argument is the FIXT transport/app pair form. */
export function isFixtDictionaries(
  d: Dictionary | DictionaryJSON | FixtDictionaries,
): d is FixtDictionaries {
  return (
    typeof d === 'object' &&
    d !== null &&
    !(d instanceof Dictionary) &&
    'transport' in d &&
    'app' in d
  );
}

// --- runtime merge (the documented-lossy convenience) ------------------------------------

function sameDef(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function unionEnumValues(transport: EnumValue[], app: EnumValue[]): EnumValue[] {
  const seen = new Set(transport.map((v) => v.value));
  return [...transport, ...app.filter((v) => !seen.has(v.value))];
}

/** Merge one field defined by both sides: identity facts must agree; derived knowledge
 * (`lengthField`, `enumValues`) is unioned, transport-preferred. */
function mergeFieldDefs(transport: FieldDef, app: FieldDef): FieldDef {
  if (
    transport.name !== app.name ||
    transport.type !== app.type ||
    (transport.isGroupCounter ?? false) !== (app.isGroupCounter ?? false) ||
    (transport.lengthField !== undefined &&
      app.lengthField !== undefined &&
      transport.lengthField !== app.lengthField)
  ) {
    throw new Error(
      `mergeFixtDictionaries: field ${transport.tag} is defined contradictorily by the transport ` +
        `("${transport.name}": ${transport.type}) and app ("${app.name}": ${app.type}) dictionaries`,
    );
  }
  const merged: FieldDef = { ...transport };
  if (merged.lengthField === undefined && app.lengthField !== undefined) {
    merged.lengthField = app.lengthField;
  }
  if (transport.enumValues && app.enumValues) {
    merged.enumValues = unionEnumValues(transport.enumValues, app.enumValues);
  } else if (app.enumValues) {
    merged.enumValues = app.enumValues;
  }
  if (merged.description === undefined && app.description !== undefined) {
    merged.description = app.description;
  }
  return merged;
}

/** The transport's envelope component names, detected structurally from its admin messages
 * (leading component carrying MsgSeqNum 34 / SenderCompID 49; trailing carrying CheckSum 10). */
function detectEnvelope(d: DictionaryJSON): { header?: string; trailer?: string } {
  const directTags = (name: string): Set<number> => {
    const out = new Set<number>();
    const seen = new Set<string>();
    const walk = (members: MemberRef[]): void => {
      for (const m of members) {
        if (m.kind === 'field') {
          out.add(m.tag);
        } else if (m.kind === 'group') {
          out.add(m.counterTag);
        } else if (!seen.has(m.name)) {
          seen.add(m.name);
          const c = d.components[m.name];
          if (c) {
            walk(c.members);
          }
        }
      }
    };
    const comp = d.components[name];
    if (comp) {
      walk(comp.members);
    }
    return out;
  };

  let header: string | undefined;
  let trailer: string | undefined;
  for (const msg of d.messages) {
    const first = msg.members[0];
    if (!header && first?.kind === 'component') {
      const tags = directTags(first.name);
      if (tags.has(49) || tags.has(34)) {
        header = first.name;
      }
    }
    const last = msg.members[msg.members.length - 1];
    if (!trailer && last?.kind === 'component' && directTags(last.name).has(10)) {
      trailer = last.name;
    }
    if (header && trailer) {
      break;
    }
  }
  return { header, trailer };
}

/**
 * Merge a FIXT transport dictionary with an application dictionary into one self-contained
 * {@link DictionaryJSON} — the runtime counterpart of the codegen merge that produces
 * `@boarteam/fix-dict-fix50sp2`, exported for venue-dialect composition
 * (`mergeFixtDictionaries(fixt11, myAppLayerDialect)`).
 *
 * Semantics:
 * - **Identity:** `beginString` from the transport (`FIXT.1.1`); `version`/`applVerID` from
 *   the app side (the app names the application version).
 * - **Catalogs unioned**: fields (identity facts must agree — a contradiction throws;
 *   `lengthField`/enum knowledge unioned, transport-preferred), datatypes and components
 *   (must be identical where shared — a contradiction throws).
 * - **Messages:** app messages that lack an envelope (application-layer dictionaries) are
 *   wrapped with the transport's header/trailer refs; already-enveloped ones (a merged dict
 *   passed as the app side) are kept as-is. On a `MsgType` collision the transport's
 *   definition wins and the app's duplicate is dropped (the session set is
 *   transport-owned), which makes the merge idempotent over an already-merged app side.
 *
 * "Lossy" refers to the layering, not the data: the merged form cannot attribute a field to
 * the session vs application layer any more — use the {@link FixtDictionaries} pair with
 * `validate` for layer-attributed diagnostics.
 */
export function mergeFixtDictionaries(
  transport: Dictionary | DictionaryJSON,
  app: Dictionary | DictionaryJSON,
): DictionaryJSON {
  const t = transport instanceof Dictionary ? transport.json : transport;
  const a = app instanceof Dictionary ? app.json : app;

  const envelope = detectEnvelope(t);
  if (!envelope.header || !envelope.trailer) {
    throw new Error(
      'mergeFixtDictionaries: the transport dictionary has no detectable header/trailer envelope — not a FIXT transport dictionary?',
    );
  }

  const datatypes = { ...t.datatypes };
  for (const [name, def] of Object.entries(a.datatypes)) {
    if (!datatypes[name]) {
      datatypes[name] = def;
    } else if (!sameDef(datatypes[name], def)) {
      throw new Error(
        `mergeFixtDictionaries: datatype "${name}" is defined contradictorily by the transport and app dictionaries`,
      );
    }
  }

  const fields: Record<number, FieldDef> = { ...t.fields };
  for (const [key, def] of Object.entries(a.fields)) {
    const tag = Number(key);
    const existing = fields[tag];
    if (existing === undefined) {
      fields[tag] = def;
    } else if (!sameDef(existing, def)) {
      fields[tag] = mergeFieldDefs(existing, def);
    }
  }

  const components: Record<string, ComponentDef> = { ...t.components };
  for (const [name, def] of Object.entries(a.components)) {
    if (!components[name]) {
      components[name] = def;
    } else if (!sameDef(components[name], def)) {
      throw new Error(
        `mergeFixtDictionaries: component "${name}" is defined contradictorily by the transport and app dictionaries`,
      );
    }
  }

  const transportTypes = new Set(t.messages.map((m) => m.msgType));
  const appEnvelope = detectEnvelope(a);
  const wrap = (m: MessageDef): MessageDef => {
    const first = m.members[0];
    const wrapped =
      first?.kind === 'component' &&
      (first.name === envelope.header || first.name === appEnvelope.header);
    if (wrapped) {
      return m;
    }
    return {
      ...m,
      members: [
        { kind: 'component', name: envelope.header!, reqd: 'Y' },
        ...m.members,
        { kind: 'component', name: envelope.trailer!, reqd: 'Y' },
      ],
    };
  };
  const messages: MessageDef[] = [
    ...a.messages.filter((m) => !transportTypes.has(m.msgType)).map(wrap),
    ...t.messages,
  ];

  return {
    version: a.version,
    beginString: t.beginString,
    ...(a.applVerID !== undefined ? { applVerID: a.applVerID } : {}),
    ...(t.source || a.source
      ? {
          source: {
            generator: '@boarteam/fix mergeFixtDictionaries',
            spec: `${a.source?.spec ?? a.version} over ${t.source?.spec ?? t.beginString}`,
          },
        }
      : {}),
    datatypes,
    fields,
    components,
    messages,
  };
}

// --- resolved pair machinery (internal to the codec) --------------------------------------

/** The resolved, cached form of a {@link FixtDictionaries} pair for one app dictionary. */
export interface ResolvedFixt {
  transport: Dictionary;
  app: Dictionary;
  /** The merged single-dictionary view parsing/encoding run over. */
  merged: Dictionary;
  /** Every tag reachable from the transport's header/trailer (for layer attribution). */
  envelopeTags: ReadonlySet<number>;
}

const dictCache = new WeakMap<DictionaryJSON, Dictionary>();

/** Load (and cache per JSON object) a Dictionary from either input form. */
export function asDictionary(d: Dictionary | DictionaryJSON): Dictionary {
  if (d instanceof Dictionary) {
    return d;
  }
  let dict = dictCache.get(d);
  if (!dict) {
    dict = loadDictionary(d);
    dictCache.set(d, dict);
  }
  return dict;
}

const mergeCache = new WeakMap<Dictionary, WeakMap<Dictionary, ResolvedFixt>>();

/** Every tag reachable from the transport's detected header/trailer components. */
function envelopeTagsOf(transport: Dictionary): Set<number> {
  const { header, trailer } = detectEnvelope(transport.json);
  const out = new Set<number>();
  const seen = new Set<string>();
  const walk = (members: MemberRef[]): void => {
    for (const m of members) {
      if (m.kind === 'field') {
        out.add(m.tag);
      } else if (m.kind === 'group') {
        out.add(m.counterTag);
        walk(m.members);
      } else if (!seen.has(m.name)) {
        seen.add(m.name);
        const c = transport.component(m.name);
        if (c) {
          walk(c.members);
        }
      }
    }
  };
  for (const name of [header, trailer]) {
    const c = name !== undefined ? transport.component(name) : undefined;
    if (c) {
      walk(c.members);
    }
  }
  return out;
}

/** Resolve (and memoise per transport+app Dictionary identity) one pair combination. */
function resolvePair(transport: Dictionary, app: Dictionary): ResolvedFixt {
  let byApp = mergeCache.get(transport);
  if (!byApp) {
    byApp = new WeakMap();
    mergeCache.set(transport, byApp);
  }
  let resolved = byApp.get(app);
  if (!resolved) {
    resolved = {
      transport,
      app,
      merged: loadDictionary(mergeFixtDictionaries(transport, app)),
      envelopeTags: envelopeTagsOf(transport),
    };
    byApp.set(app, resolved);
  }
  return resolved;
}

/**
 * Resolve a {@link FixtDictionaries} pair for one message: route the app dictionary by the
 * message's `ApplVerID(1128)` (falling back to the pair's `defaultApplVerID`, then to
 * {@link FixtDictionaries.app}). Returns the cached merged view + layer facts.
 */
export function resolveFixt(pair: FixtDictionaries, applVerID?: string): ResolvedFixt {
  const transport = asDictionary(pair.transport);
  let app: Dictionary | DictionaryJSON | undefined;
  const effective = applVerID ?? pair.defaultApplVerID;
  if (effective !== undefined && pair.resolveApp) {
    app = pair.resolveApp(effective);
  }
  return resolvePair(transport, asDictionary(app ?? pair.app));
}
