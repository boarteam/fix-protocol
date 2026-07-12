import { type FixIssue, issue } from '../errors';
import type {
  ComponentDef,
  DictionaryJSON,
  EnumValue,
  FieldDef,
  GroupMember,
  MemberRef,
  MessageDef,
} from './types';
import type {
  ComponentExtension,
  DictionaryExtension,
  ExtensionEnumValue,
  ExtensionFieldDef,
  GroupExtension,
  MemberSpec,
  MessageExtension,
  NewMessageSpec,
} from './extension';

/** The result of {@link extendDictionary}: the merged dictionary plus diagnostics. */
export interface ExtendResult {
  /**
   * A fresh {@link DictionaryJSON} (deep clone — the base and the extensions are never
   * mutated), consumed unchanged by `loadDictionary`/`createFixEngine`. When the base
   * passes `validateDictionary` and {@link issues} carries no error-severity entries,
   * the result passes `validateDictionary` too.
   */
  dictionary: DictionaryJSON;
  /**
   * `extend/*` diagnostics, returned as data — never thrown. Severity encodes the
   * outcome: `error` = the operation was skipped or reverted, `warning` = applied (or,
   * for `extend/duplicate-member`, already satisfied) but review, `info` = advisory.
   */
  issues: FixIssue[];
}

/**
 * Apply venue extension declarations to a dictionary, producing a NEW
 * {@link DictionaryJSON} the engine consumes unchanged. **Never throws** on data
 * problems — every collision, unresolvable reference, malformed entry, or unsafe
 * placement is a returned {@link FixIssue} (`extend/*` codes), and the offending
 * operation is skipped or reverted rather than applied unsafely.
 *
 * Semantics:
 * - **Pure**: inputs are never mutated; the result is deterministic.
 * - **Composable**: extensions apply left to right; later extensions see earlier ones.
 * - **Idempotent**: re-applying an extension changes nothing (duplicate members are
 *   skipped with a warning; identical field redefinitions are silent).
 * - **Delimiter-safe**: placements are append/after-anchor only, and every operation is
 *   checked against the corruption hazards the grammar alone cannot rule out — a group
 *   entry delimiter shifting (`extend/group-delimiter-shift`, reverted), a placed member
 *   colliding with a group scope that could be open on the wire around the insertion
 *   point in either direction (`extend/ambiguous-boundary`, skipped; optional members
 *   between are treated as potentially absent), a new group with no resolvable entry
 *   delimiter (`extend/unresolvable-group-delimiter`, skipped), and a component
 *   reference cycle (`extend/component-cycle`, reverted).
 *
 * Run `validateDictionary` on the result as the final gate, exactly as for any other
 * dictionary.
 *
 * ```ts
 * const { dictionary, issues } = extendDictionary(fix44, ctrader);
 * if (issues.some((i) => i.severity === 'error')) {
 *   // an operation was skipped or reverted — fix the extension declaration
 * }
 * const engine = createFixEngine(dictionary);
 * ```
 */
export function extendDictionary(
  base: DictionaryJSON,
  ...extensions: DictionaryExtension[]
): ExtendResult {
  const dictionary = structuredClone(base);
  const issues: FixIssue[] = [];
  for (const ext of extensions) {
    if (isPlainObject(ext)) {
      applyExtension(dictionary, ext, issues);
    }
  }
  return { dictionary, issues };
}

// --- application ------------------------------------------------------------------------

/** Shared state for one extension application. */
interface Ctx {
  d: DictionaryJSON;
  fieldsByName: Map<string, FieldDef>;
  issues: FixIssue[];
  /** Issue-path prefix, `"<id>:"` when the extension carries an id. */
  prefix: string;
}

function applyExtension(d: DictionaryJSON, ext: DictionaryExtension, issues: FixIssue[]): void {
  const ctx: Ctx = {
    d,
    fieldsByName: new Map(Object.values(d.fields ?? {}).map((f) => [f.name, f])),
    issues,
    prefix: typeof ext.id === 'string' && ext.id !== '' ? `${ext.id}:` : '',
  };
  applyFields(ctx, ext.fields);
  applyEnums(ctx, ext.enums);
  applyComponents(ctx, ext.components);
  applyMessages(ctx, ext.messages);
  if (typeof ext.id === 'string' && ext.id !== '' && !(d.extensions ?? []).includes(ext.id)) {
    (d.extensions ??= []).push(ext.id);
  }
}

function invalidSpec(ctx: Ctx, path: string, what: string): void {
  ctx.issues.push(
    issue(
      'extend/invalid-spec',
      `${what} at "${path}" is structurally malformed; the entry is skipped.`,
      { path },
    ),
  );
}

// --- fields -------------------------------------------------------------------------------

function applyFields(ctx: Ctx, fields: DictionaryExtension['fields']): void {
  for (const [name, def] of Object.entries(fields ?? {})) {
    if (!isPlainObject(def)) {
      invalidSpec(ctx, `${ctx.prefix}${name}`, 'Field definition');
      continue;
    }
    applyField(ctx, name, def);
  }
}

function applyField(ctx: Ctx, name: string, def: ExtensionFieldDef): void {
  const path = `${ctx.prefix}${name}`;
  if (!Number.isInteger(def.tag) || def.tag <= 0) {
    ctx.issues.push(
      issue(
        'extend/field-bad-tag',
        `Field "${name}" has tag ${def.tag}, which is not a positive integer; the field is skipped.`,
        { path },
      ),
    );
    return;
  }
  if (typeof def.type !== 'string' || !hasOwn(ctx.d.datatypes ?? {}, def.type)) {
    ctx.issues.push(
      issue(
        'extend/field-unknown-type',
        `Field "${name}" (${def.tag}) uses datatype "${def.type}", which is not defined in the dictionary; the field is skipped.`,
        { path, refTagID: def.tag },
      ),
    );
    return;
  }
  const sameName = ctx.fieldsByName.get(name);
  if (sameName && sameName.tag !== def.tag) {
    ctx.issues.push(
      issue(
        'extend/field-name-collision',
        `Field name "${name}" is already bound to tag ${sameName.tag}; the extension field (${def.tag}) is skipped — pick a unique name or redefine tag ${sameName.tag} itself.`,
        { path, refTagID: def.tag },
      ),
    );
    return;
  }

  const fieldDef: FieldDef = { tag: def.tag, name, type: def.type };
  if (def.enumValues !== undefined && Array.isArray(def.enumValues)) {
    fieldDef.enumValues = def.enumValues.filter(isEnumValueSpec).map(toEnumValue);
  }
  if (derivesFrom(ctx.d, def.type, 'NumInGroup')) {
    fieldDef.isGroupCounter = true;
  }
  if (def.lengthField !== undefined) {
    fieldDef.lengthField = def.lengthField;
  }
  if (def.description !== undefined) {
    fieldDef.description = def.description;
  }

  const existing = ctx.d.fields[def.tag];
  if (existing && !deepEqual(existing, fieldDef)) {
    ctx.issues.push(
      issue(
        'extend/field-tag-collision',
        `Tag ${def.tag} is already defined as "${existing.name}" (${existing.type}); the extension definition "${name}" (${def.type}) replaces it.`,
        { severity: 'warning', path, refTagID: def.tag },
      ),
    );
  }
  if (existing && existing.name !== name) {
    ctx.fieldsByName.delete(existing.name);
  }

  const inUserRange = (def.tag >= 5000 && def.tag <= 9999) || def.tag >= 20000;
  if (!existing && !inUserRange) {
    ctx.issues.push(
      issue(
        'extend/tag-outside-user-range',
        `Tag ${def.tag} ("${name}") lies outside the FIX user-defined ranges (5000-9999, 20000+); it may collide with standard tags of other FIX versions.`,
        { severity: 'info', path, refTagID: def.tag },
      ),
    );
  }
  if (ctx.d.datatypes[def.type]?.base === 'data' && def.lengthField === undefined) {
    ctx.issues.push(
      issue(
        'extend/data-length-unwired',
        `Field "${name}" (${def.tag}) is a data field with no lengthField; a value embedding the separator cannot be scanned safely.`,
        { severity: 'warning', path, refTagID: def.tag },
      ),
    );
  }

  ctx.d.fields[def.tag] = fieldDef;
  ctx.fieldsByName.set(name, fieldDef);
}

// --- enums --------------------------------------------------------------------------------

function applyEnums(ctx: Ctx, enums: DictionaryExtension['enums']): void {
  for (const [fieldName, values] of Object.entries(enums ?? {})) {
    const path = `${ctx.prefix}${fieldName}`;
    if (!Array.isArray(values)) {
      invalidSpec(ctx, path, 'Enum value list');
      continue;
    }
    const field = ctx.fieldsByName.get(fieldName);
    if (!field) {
      ctx.issues.push(
        issue(
          'extend/enum-unknown-field',
          `Enum values target field "${fieldName}", which is not defined in the dictionary; the entry is skipped.`,
          { path },
        ),
      );
      continue;
    }
    const list = (field.enumValues ??= []);
    for (const v of values) {
      if (!isEnumValueSpec(v)) {
        invalidSpec(ctx, path, 'Enum value');
        continue;
      }
      const existing = list.findIndex((e) => e.value === v.value);
      if (existing === -1) {
        list.push(toEnumValue(v));
        continue;
      }
      if (list[existing]!.name === v.name) {
        continue; // identical value+name: silent, keeps re-application idempotent
      }
      ctx.issues.push(
        issue(
          'extend/enum-value-conflict',
          `Enum value "${v.value}" of ${fieldName} (${field.tag}) is already defined as "${list[existing]!.name}"; the extension entry "${v.name}" replaces it.`,
          { severity: 'warning', path, refTagID: field.tag },
        ),
      );
      list[existing] = toEnumValue(v);
    }
  }
}

function isEnumValueSpec(v: unknown): v is ExtensionEnumValue {
  return (
    isPlainObject(v) &&
    typeof (v as ExtensionEnumValue).value === 'string' &&
    typeof (v as ExtensionEnumValue).name === 'string'
  );
}

function toEnumValue(v: ExtensionEnumValue): EnumValue {
  return { value: v.value, name: v.name, description: v.description ?? v.name };
}

// --- components ---------------------------------------------------------------------------

function applyComponents(ctx: Ctx, components: DictionaryExtension['components']): void {
  const entries = Object.entries(components ?? {}).filter(([name, spec]) => {
    if (isPlainObject(spec)) {
      return true;
    }
    invalidSpec(ctx, `${ctx.prefix}${name}`, 'Component entry');
    return false;
  });

  // New components register in one pass before their members resolve, so new components
  // may reference each other regardless of declaration order.
  const pending: [string, readonly MemberSpec[]][] = [];
  for (const [name, spec] of entries) {
    if (isNewComponent(spec)) {
      if (hasOwn(ctx.d.components, name)) {
        ctx.issues.push(
          issue(
            'extend/component-collision',
            `Component "${name}" is already defined; the new definition is skipped — extend the existing component with the append form instead.`,
            { path: `${ctx.prefix}${name}` },
          ),
        );
        continue;
      }
      ctx.d.components[name] = { name, members: [] };
      pending.push([name, spec.members]);
    }
  }
  for (const [name, members] of pending) {
    const refs = Array.isArray(members)
      ? resolveSpecs(ctx, members, `${ctx.prefix}${name}`)
      : undefined;
    if (!refs) {
      if (!Array.isArray(members)) {
        invalidSpec(ctx, `${ctx.prefix}${name}`, 'Component members');
      }
      delete ctx.d.components[name]; // unresolvable member: the whole definition is skipped
      continue;
    }
    ctx.d.components[name]!.members = refs;
  }

  // A skipped definition can leave dangling references in sibling NEW components, and
  // new components can reference each other in a cycle the runtime cannot expand. Both
  // would escape as error-severity dict/* findings, so delete offenders to a fixpoint.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name] of pending) {
      const component = hasOwn(ctx.d.components, name) ? ctx.d.components[name] : undefined;
      if (!component) {
        continue;
      }
      const dangling = component.members.find(
        (m) => m.kind === 'component' && !hasOwn(ctx.d.components, m.name),
      );
      if (dangling) {
        ctx.issues.push(
          issue(
            'extend/unknown-member',
            `Component "${name}" references component "${(dangling as { name: string }).name}", whose definition was skipped; "${name}" is skipped too.`,
            { path: `${ctx.prefix}${name}` },
          ),
        );
        delete ctx.d.components[name];
        changed = true;
        continue;
      }
      if (componentExpansionContains(ctx.d, name, name)) {
        ctx.issues.push(
          issue(
            'extend/component-cycle',
            `Component "${name}" participates in a component reference cycle, which the runtime cannot expand; the definition is skipped.`,
            { path: `${ctx.prefix}${name}` },
          ),
        );
        delete ctx.d.components[name];
        changed = true;
      }
    }
  }

  for (const [name, spec] of entries) {
    if (!isNewComponent(spec)) {
      applyComponentPatch(ctx, name, spec);
    }
  }
}

function isNewComponent(
  spec: ComponentExtension,
): spec is { readonly members: readonly MemberSpec[] } {
  return 'members' in spec;
}

function applyComponentPatch(
  ctx: Ctx,
  name: string,
  spec: Exclude<ComponentExtension, { members: readonly MemberSpec[] }>,
): void {
  const path = `${ctx.prefix}${name}`;
  const component: ComponentDef | undefined = hasOwn(ctx.d.components, name)
    ? ctx.d.components[name]
    : undefined;
  if (!component) {
    ctx.issues.push(
      issue(
        'extend/target-not-found',
        `Component "${name}" is not defined in the dictionary; the placement is skipped.`,
        { path },
      ),
    );
    return;
  }
  const reached = messagesReaching(ctx.d, name);
  ctx.issues.push(
    issue(
      'extend/component-fanout',
      `Placement targets component "${name}", which ${reached.length === 1 ? `is reached by 1 message (${reached[0]})` : `is reached by ${reached.length} messages${reached.length > 0 ? ` (${reached.join(', ')})` : ''}`}; the added members become visible in every referencing scope.`,
      { severity: 'info', path },
    ),
  );
  applyBodyExtension(ctx, component.members, spec, path);
}

// --- messages -----------------------------------------------------------------------------

function applyMessages(ctx: Ctx, messages: DictionaryExtension['messages']): void {
  for (const [name, spec] of Object.entries(messages ?? {})) {
    if (!isPlainObject(spec)) {
      invalidSpec(ctx, `${ctx.prefix}${name}`, 'Message entry');
      continue;
    }
    if ('msgType' in spec && spec.msgType !== undefined) {
      if (typeof spec.msgType !== 'string' || !Array.isArray((spec as NewMessageSpec).members)) {
        invalidSpec(
          ctx,
          `${ctx.prefix}${name}`,
          'New message spec (msgType must be a string and members an array)',
        );
        continue;
      }
      applyNewMessage(ctx, name, spec as NewMessageSpec);
    } else {
      applyMessagePatch(ctx, name, spec);
    }
  }
}

function applyNewMessage(ctx: Ctx, name: string, spec: NewMessageSpec): void {
  const path = `${ctx.prefix}${name}`;
  const body = resolveSpecs(ctx, spec.members, path);
  if (!body) {
    return; // unresolvable member: the whole message is skipped (errors already reported)
  }

  const members: MemberRef[] = body;
  const { header, trailer } = detectHeaderTrailer(ctx.d);
  const injected: string[] = [];
  if (header && !members.some((m) => m.kind === 'component' && m.name === header)) {
    members.unshift({ kind: 'component', name: header, reqd: 'Y' });
    injected.push(header);
  }
  if (trailer && !members.some((m) => m.kind === 'component' && m.name === trailer)) {
    members.push({ kind: 'component', name: trailer, reqd: 'Y' });
    injected.push(trailer);
  }
  if (injected.length > 0) {
    ctx.issues.push(
      issue(
        'extend/header-trailer-injected',
        `Message "${name}" (${spec.msgType}) was wrapped with the dictionary's ${injected.map((c) => `"${c}"`).join(' and ')}.`,
        { severity: 'info', path, refMsgType: spec.msgType },
      ),
    );
  }
  if (!header || !trailer) {
    ctx.issues.push(
      issue(
        'extend/header-trailer-missing',
        `No standard ${!header && !trailer ? 'header or trailer' : !header ? 'header' : 'trailer'} component could be detected in the dictionary; message "${name}" (${spec.msgType}) is applied without it — encode will silently drop session fields unless the body carries them.`,
        { severity: 'warning', path, refMsgType: spec.msgType },
      ),
    );
  }

  const message: MessageDef = {
    name,
    msgType: spec.msgType,
    category: spec.category === 'admin' ? 'admin' : 'app',
    members,
  };

  const existingIndex = ctx.d.messages.findIndex((m) => m.msgType === spec.msgType);
  if (ctx.d.messages.some((m, i) => m.name === name && i !== existingIndex)) {
    ctx.issues.push(
      issue(
        'extend/message-name-collision',
        `Message name "${name}" is already used by another message with a different MsgType; both are kept (names stop being unique).`,
        { severity: 'warning', path, refMsgType: spec.msgType },
      ),
    );
  }
  if (existingIndex !== -1) {
    ctx.issues.push(
      issue(
        'extend/msgtype-collision',
        `MsgType "${spec.msgType}" is already defined as "${ctx.d.messages[existingIndex]!.name}"; the extension message "${name}" replaces it in place.`,
        { severity: 'warning', path, refMsgType: spec.msgType },
      ),
    );
    ctx.d.messages[existingIndex] = message;
  } else {
    ctx.d.messages.push(message);
  }
}

function applyMessagePatch(ctx: Ctx, name: string, spec: MessageExtension): void {
  const path = `${ctx.prefix}${name}`;
  const matches = ctx.d.messages.filter((m) => m.name === name);
  if (matches.length === 0) {
    ctx.issues.push(
      issue(
        'extend/target-not-found',
        `Message "${name}" is not defined in the dictionary; the placement is skipped.`,
        { path },
      ),
    );
    return;
  }
  if (matches.length > 1) {
    ctx.issues.push(
      issue(
        'extend/target-not-found',
        `Message name "${name}" is ambiguous (${matches.length} messages carry it: ${matches.map((m) => m.msgType).join(', ')}); the placement is skipped.`,
        { path },
      ),
    );
    return;
  }
  applyBodyExtension(ctx, matches[0]!.members, spec, path);
}

/** Detect the standard header/trailer component names by vote across the messages. */
function detectHeaderTrailer(d: DictionaryJSON): { header?: string; trailer?: string } {
  let header: string | null | undefined;
  let trailer: string | null | undefined;
  for (const message of d.messages) {
    const first = message.members[0];
    if (first?.kind === 'component') {
      const tags = componentDirectTags(d, first.name);
      if (tags.has(49) || tags.has(34)) {
        header = header === undefined || header === first.name ? first.name : null;
      }
    }
    const last = message.members[message.members.length - 1];
    if (last?.kind === 'component' && componentDirectTags(d, last.name).has(10)) {
      trailer = trailer === undefined || trailer === last.name ? last.name : null;
    }
  }
  return { header: header ?? undefined, trailer: trailer ?? undefined };
}

// --- shared placement pipeline --------------------------------------------------------------

/** Apply a body-level patch (append and/or group additions) to a message or component. */
function applyBodyExtension(
  ctx: Ctx,
  body: MemberRef[],
  spec: {
    append?: readonly MemberSpec[];
    after?: string;
    groups?: Readonly<Record<string, GroupExtension>>;
  },
  path: string,
): void {
  if (spec.append !== undefined) {
    if (Array.isArray(spec.append)) {
      applyPlacement(ctx, body, spec.append, spec.after, path);
    } else {
      invalidSpec(ctx, path, 'Append list');
    }
  }
  if (spec.groups !== undefined && !isPlainObject(spec.groups)) {
    invalidSpec(ctx, path, 'Group patch record');
    return;
  }
  for (const [groupPath, groupExt] of Object.entries(spec.groups ?? {})) {
    const fullPath = `${path}.${groupPath}`;
    if (!isPlainObject(groupExt) || !Array.isArray(groupExt.append)) {
      invalidSpec(ctx, fullPath, 'Group patch');
      continue;
    }
    const group = resolveGroupPath(ctx, body, groupPath.split('.'), fullPath);
    if (group) {
      applyPlacement(ctx, group.members, groupExt.append, groupExt.after, fullPath);
    }
  }
}

/**
 * The placement pipeline: resolve → anchor → duplicate guard → backward boundary check →
 * insert → forward boundary check → component-cycle check → delimiter post-check (with
 * revert) → data-length adjacency check. Member-resolution failures skip the whole
 * placement; duplicate and boundary hits skip the individual member.
 */
function applyPlacement(
  ctx: Ctx,
  body: MemberRef[],
  specs: readonly MemberSpec[],
  after: string | undefined,
  path: string,
): void {
  const refs = resolveSpecs(ctx, specs, path);
  if (!refs) {
    return;
  }

  const owner = bodyOwner(ctx.d, body);
  let insertAt: number;
  if (after !== undefined) {
    const anchor = findMemberIndex(ctx, body, after);
    if (anchor === -1) {
      ctx.issues.push(
        issue(
          'extend/member-not-found',
          `Anchor "${after}" matches no member of the target body; the placement is skipped.`,
          { path },
        ),
      );
      return;
    }
    insertAt = anchor + 1;
  } else if (owner?.kind === 'message') {
    insertAt = beforeTrailerIndex(ctx.d, body);
  } else {
    insertAt = body.length;
  }

  // Duplicates are judged against the target scope AND — when the target is a shared
  // component's own body — against every scope that references it, since the added
  // member becomes part of each of those scopes on the wire.
  const duplicateScopes: MemberRef[][] = [body];
  if (owner?.kind === 'component') {
    for (const site of componentSites(ctx.d, owner.name)) {
      duplicateScopes.push(site.parent);
    }
  }

  const delimitersBefore = collectGroupDelimiters(ctx.d);
  const inserted: MemberRef[] = [];
  for (const ref of refs) {
    if (duplicateScopes.some((scope) => hasMemberIdentity(ctx, scope, ref))) {
      ctx.issues.push(
        issue(
          'extend/duplicate-member',
          `${describeRef(ctx, ref)} is already part of the target scope; it is not added again.`,
          { severity: 'warning', path, ...refTag(ref) },
        ),
      );
      continue;
    }
    const hazard = backwardHazard(ctx, body, insertAt, ref);
    if (hazard !== undefined) {
      ctx.issues.push(
        issue(
          'extend/ambiguous-boundary',
          `${describeRef(ctx, ref)} could sit right after entries of the repeating group headed by ${fieldLabel(ctx, hazard.counterTag)}, whose scope also contains it — on re-parse the value would land inside that group. Anchor it with \`after\` ahead of the group, or place it inside the group instead.`,
          { path, ...refTag(ref) },
        ),
      );
      continue;
    }
    body.splice(insertAt, 0, ref);
    inserted.push(ref);
    insertAt += 1;
  }

  // Forward pass: a placed member that OPENS a scope (a group, or a component ending in
  // one) must not capture the wire members that can follow it.
  for (const ref of [...inserted]) {
    const open = placedOpenGroups(ctx.d, ref);
    if (open.length === 0) {
      continue;
    }
    const at = body.indexOf(ref);
    const following = forwardHazardTags(ctx.d, body, at + 1);
    const capturing = open.find((group) => {
      const scope = expandedScope(ctx.d, group.members).tags;
      const delimiter = firstWireTag(ctx.d, group.members, new Set());
      return [...following].some((tag) => scope.has(tag) || tag === delimiter);
    });
    if (capturing) {
      body.splice(body.indexOf(ref), 1);
      inserted.splice(inserted.indexOf(ref), 1);
      ctx.issues.push(
        issue(
          'extend/ambiguous-boundary',
          `${describeRef(ctx, ref)} opens the repeating group headed by ${fieldLabel(ctx, capturing.counterTag)}, whose scope also contains wire members that can follow the insertion point — on re-parse they would land inside the group. Place it where nothing in its scope can follow.`,
          { path, ...refTag(ref) },
        ),
      );
    }
  }

  // A placed component reference must not close a cycle over the component that owns the
  // target body (directly or through the group nesting).
  const owningComp = owningComponentName(ctx.d, body);
  if (owningComp !== undefined) {
    for (const ref of [...inserted]) {
      if (ref.kind === 'component' && componentExpansionContains(ctx.d, ref.name, owningComp)) {
        body.splice(body.indexOf(ref), 1);
        inserted.splice(inserted.indexOf(ref), 1);
        ctx.issues.push(
          issue(
            'extend/component-cycle',
            `Placing component "${ref.name}" here would create a component reference cycle through "${owningComp}"; the member is skipped.`,
            { path },
          ),
        );
      }
    }
  }

  if (inserted.length === 0) {
    return;
  }

  // Delimiter post-check across the WHOLE dictionary: an append can shift a group's
  // delimiter transitively (a group whose leading component previously resolved to no
  // field). A shifted delimiter breaks entry detection for already-recorded traffic, so
  // the whole placement is reverted. `delimiter-defined` observations are buffered and
  // reported only when the placement stands.
  const delimitersAfter = collectGroupDelimiters(ctx.d);
  const shifted: GroupMember[] = [];
  const defined: FixIssue[] = [];
  for (const [group, before] of delimitersBefore) {
    const now = delimitersAfter.get(group);
    if (before !== undefined && now !== before) {
      shifted.push(group);
    } else if (before === undefined && now !== undefined) {
      defined.push(
        issue(
          'extend/delimiter-defined',
          `The repeating group headed by ${fieldLabel(ctx, group.counterTag)} previously had no resolvable entry delimiter; it is now ${fieldLabel(ctx, now)}.`,
          { severity: 'info', path, refTagID: group.counterTag },
        ),
      );
    }
  }
  if (shifted.length > 0) {
    for (const ref of inserted) {
      const at = body.indexOf(ref);
      if (at !== -1) {
        body.splice(at, 1);
      }
    }
    ctx.issues.push(
      issue(
        'extend/group-delimiter-shift',
        `The placement would change the entry delimiter of the repeating group${shifted.length > 1 ? 's' : ''} headed by ${shifted.map((g) => fieldLabel(ctx, g.counterTag)).join(', ')}, breaking entry detection; the placement is reverted.`,
        { path },
      ),
    );
    return;
  }
  ctx.issues.push(...defined);

  // A data field must be preceded by its Length companion in the same body, or encode
  // will drop the caller-supplied length and SOH-embedding values corrupt the frame.
  for (const ref of inserted) {
    if (ref.kind !== 'field') {
      continue;
    }
    const lengthField = ctx.d.fields[ref.tag]?.lengthField;
    if (lengthField === undefined) {
      continue;
    }
    const at = body.indexOf(ref);
    if (!expandedScope(ctx.d, body.slice(0, at)).tags.has(lengthField)) {
      ctx.issues.push(
        issue(
          'extend/data-length-not-placed',
          `Data field ${fieldLabel(ctx, ref.tag)} was placed without its Length companion ${fieldLabel(ctx, lengthField)} positioned before it in the same body; encode cannot emit the length, and a value embedding the separator would corrupt the frame.`,
          { severity: 'warning', path, refTagID: ref.tag },
        ),
      );
    }
  }
}

// --- member-spec resolution -----------------------------------------------------------------

/**
 * Resolve MemberSpecs to MemberRefs. Returns `undefined` (after reporting each failure)
 * when ANY spec is unresolvable — placements are atomic so a half-applied member list
 * never silently changes meaning.
 */
function resolveSpecs(
  ctx: Ctx,
  specs: readonly MemberSpec[],
  path: string,
): MemberRef[] | undefined {
  const refs: MemberRef[] = [];
  let failed = false;
  for (const spec of specs) {
    const ref = resolveSpec(ctx, spec, path);
    if (ref) {
      refs.push(ref);
    } else {
      failed = true;
    }
  }
  return failed ? undefined : refs;
}

function resolveSpec(ctx: Ctx, spec: MemberSpec, path: string): MemberRef | undefined {
  if (typeof spec !== 'string' && !isPlainObject(spec)) {
    invalidSpec(ctx, path, 'Member spec');
    return undefined;
  }
  const normalized = typeof spec === 'string' ? { field: spec } : spec;

  if ('field' in normalized) {
    const field = ctx.fieldsByName.get(normalized.field);
    if (!field) {
      ctx.issues.push(
        issue(
          'extend/unknown-member',
          `Member "${normalized.field}" names no field in the dictionary or the extension; the placement is skipped.`,
          { path },
        ),
      );
      return undefined;
    }
    if (derivesFrom(ctx.d, field.type, 'NumInGroup')) {
      ctx.issues.push(
        issue(
          'extend/counter-as-field',
          `Field ${field.name} (${field.tag}) is a NumInGroup counter but was placed as a plain scalar member; on the wire it heads a repeating group, so real traffic would mis-parse — use the { group: '${field.name}', members: [...] } form instead.`,
          { severity: 'warning', path, refTagID: field.tag },
        ),
      );
    }
    return { kind: 'field', tag: field.tag, reqd: normalized.reqd ?? 'N' };
  }

  if ('component' in normalized) {
    if (!hasOwn(ctx.d.components, normalized.component)) {
      ctx.issues.push(
        issue(
          'extend/unknown-member',
          `Member component "${normalized.component}" is not defined in the dictionary or the extension; the placement is skipped.`,
          { path },
        ),
      );
      return undefined;
    }
    return { kind: 'component', name: normalized.component, reqd: normalized.reqd ?? 'N' };
  }

  if (!('group' in normalized)) {
    invalidSpec(ctx, path, 'Member spec (expected a field/component/group form)');
    return undefined;
  }

  const counter = ctx.fieldsByName.get(normalized.group);
  if (!counter) {
    ctx.issues.push(
      issue(
        'extend/unknown-member',
        `Group counter "${normalized.group}" names no field in the dictionary or the extension; the placement is skipped.`,
        { path },
      ),
    );
    return undefined;
  }
  if (!derivesFrom(ctx.d, counter.type, 'NumInGroup')) {
    ctx.issues.push(
      issue(
        'extend/counter-not-marked',
        `Group counter ${counter.name} (${counter.tag}) has datatype "${counter.type}", which does not derive from NumInGroup; parse-time counter detection depends on it — fix the field's type.`,
        { severity: 'warning', path, refTagID: counter.tag },
      ),
    );
  }
  if (!Array.isArray(normalized.members)) {
    invalidSpec(ctx, `${path}.${normalized.group}`, 'Group members');
    return undefined;
  }
  const members = resolveSpecs(ctx, normalized.members, `${path}.${normalized.group}`);
  if (!members) {
    return undefined;
  }
  if (members.length === 0 || firstWireTag(ctx.d, members, new Set()) === undefined) {
    ctx.issues.push(
      issue(
        'extend/unresolvable-group-delimiter',
        `The new repeating group headed by ${counter.name} (${counter.tag}) has a body that resolves to no leading wire field, so the parser would have no entry delimiter; the placement is skipped.`,
        { path: `${path}.${normalized.group}`, refTagID: counter.tag },
      ),
    );
    return undefined;
  }
  return { kind: 'group', counterTag: counter.tag, reqd: normalized.reqd ?? 'N', members };
}

// --- group-path resolution ------------------------------------------------------------------

/**
 * Resolve a dotted counter-field-name path to the repeating group it names, starting from
 * a message or component body. Descends through a component reference only when the
 * component is referenced exactly once in the whole dictionary — additions through a
 * shared component must target the component explicitly, so the fan-out is a decision,
 * not an accident.
 */
function resolveGroupPath(
  ctx: Ctx,
  body: MemberRef[],
  segments: string[],
  path: string,
): GroupMember | undefined {
  let scope = body;
  let group: GroupMember | undefined;
  for (const segment of segments) {
    const counter = ctx.fieldsByName.get(segment);
    if (!counter) {
      ctx.issues.push(
        issue(
          'extend/target-not-found',
          `Group path segment "${segment}" names no field in the dictionary; the placement is skipped.`,
          { path },
        ),
      );
      return undefined;
    }
    const found = findGroupInScope(ctx, scope, counter.tag);
    if (found.kind === 'none') {
      const hint =
        found.behind.length > 0
          ? ` The group exists behind shared component${found.behind.length > 1 ? 's' : ''} ${found.behind.map((c) => `"${c}" (reached by ${messagesReaching(ctx.d, c).length} message${messagesReaching(ctx.d, c).length === 1 ? '' : 's'})`).join(', ')} — target the component explicitly via the extension's \`components\` entry.`
          : '';
      ctx.issues.push(
        issue(
          'extend/target-not-found',
          `Repeating group headed by ${counter.name} (${counter.tag}) was not found at "${path}".${hint}`,
          { path, refTagID: counter.tag },
        ),
      );
      return undefined;
    }
    if (found.kind === 'ambiguous') {
      ctx.issues.push(
        issue(
          'extend/target-not-found',
          `Group path segment "${segment}" is ambiguous at "${path}" (multiple occurrences); target the owning component explicitly.`,
          { path, refTagID: counter.tag },
        ),
      );
      return undefined;
    }
    if (found.via.length > 0) {
      ctx.issues.push(
        issue(
          'extend/component-fanout',
          `Group ${counter.name} (${counter.tag}) was reached through component${found.via.length > 1 ? 's' : ''} ${found.via.map((c) => `"${c}"`).join(', ')} (referenced only here); the addition modifies the component definition.`,
          { severity: 'info', path, refTagID: counter.tag },
        ),
      );
    }
    group = found.group;
    scope = found.group.members;
  }
  return group;
}

type GroupSearch =
  | { kind: 'found'; group: GroupMember; via: string[] }
  | { kind: 'ambiguous' }
  | { kind: 'none'; behind: string[] };

/**
 * Find the group headed by `counterTag` in a body: directly among its members, or by
 * descending through component references whose global reference count is exactly 1.
 * Components referenced more than once are not descended into; when the group lives
 * only behind such components, their names are returned for the error hint.
 */
function findGroupInScope(ctx: Ctx, body: MemberRef[], counterTag: number): GroupSearch {
  const matches: { group: GroupMember; via: string[] }[] = [];
  const behind: string[] = [];
  search(body, [], new Set());

  function search(members: MemberRef[], chain: string[], seen: Set<string>): void {
    for (const member of members) {
      if (member.kind === 'group' && member.counterTag === counterTag) {
        matches.push({ group: member, via: chain });
      } else if (member.kind === 'component' && !seen.has(member.name)) {
        const component = hasOwn(ctx.d.components, member.name)
          ? ctx.d.components[member.name]
          : undefined;
        if (!component) {
          continue;
        }
        const next = new Set(seen);
        next.add(member.name);
        if (componentReferenceCount(ctx.d, member.name) === 1) {
          search(component.members, [...chain, member.name], next);
        } else if (containsGroup(ctx, component.members, counterTag, next)) {
          behind.push(member.name);
        }
      }
    }
  }

  if (matches.length === 1) {
    return { kind: 'found', group: matches[0]!.group, via: matches[0]!.via };
  }
  if (matches.length > 1) {
    return { kind: 'ambiguous' };
  }
  return { kind: 'none', behind };
}

/** Whether a body (expanded through components) contains a group headed by `counterTag`. */
function containsGroup(
  ctx: Ctx,
  members: MemberRef[],
  counterTag: number,
  seen: Set<string>,
): boolean {
  for (const member of members) {
    if (member.kind === 'group' && member.counterTag === counterTag) {
      return true;
    }
    if (member.kind === 'component' && !seen.has(member.name)) {
      seen.add(member.name);
      const component = hasOwn(ctx.d.components, member.name)
        ? ctx.d.components[member.name]
        : undefined;
      if (component && containsGroup(ctx, component.members, counterTag, seen)) {
        return true;
      }
    }
  }
  return false;
}

// --- placement safety checks ----------------------------------------------------------------

/**
 * The backward boundary hazard: a member placed at `insertAt` lands on the wire right
 * after the entries of any repeating group that could still be "open" at that position.
 * Members between the insertion point and an earlier group are walked as potentially
 * absent when optional — only a required member guarantees a wire token that closes the
 * group. When the target body belongs to a component, the context continues at every
 * site referencing it; when it is a group entry body, the context wraps around to the
 * previous entry of the same group.
 *
 * @returns the innermost hazardous group, or `undefined` when the placement is safe.
 */
function backwardHazard(
  ctx: Ctx,
  body: MemberRef[],
  insertAt: number,
  ref: MemberRef,
): GroupMember | undefined {
  const openGroups = openGroupsBefore(ctx.d, body, insertAt);
  if (openGroups.length === 0) {
    return undefined;
  }
  const introduced = introducedTags(ctx, ref);
  for (const group of openGroups) {
    const scope = expandedScope(ctx.d, group.members).tags;
    const delimiter = firstWireTag(ctx.d, group.members, new Set());
    for (const tag of introduced) {
      if (scope.has(tag) || tag === delimiter) {
        return group;
      }
    }
  }
  return undefined;
}

/** Every repeating group that could be open on the wire just before `upTo` in `body`. */
function openGroupsBefore(d: DictionaryJSON, body: MemberRef[], upTo: number): GroupMember[] {
  const out: GroupMember[] = [];
  const pending: { body: MemberRef[]; upTo: number }[] = [{ body, upTo }];
  const visited = new Set<string>();
  const wrapped = new Set<MemberRef[]>();
  while (pending.length > 0) {
    const step = pending.pop()!;
    if (scanBackward(d, step.body, step.upTo, out)) {
      continue; // a required member guarantees a closing wire token
    }
    const owner = bodyOwner(d, step.body);
    if (owner?.kind === 'component' && !visited.has(owner.name)) {
      visited.add(owner.name);
      for (const site of componentSites(d, owner.name)) {
        pending.push({ body: site.parent, upTo: site.index });
      }
    } else if (owner?.kind === 'group' && step.upTo < step.body.length && !wrapped.has(step.body)) {
      // Entry bodies wrap around: the previous ENTRY's tail precedes this position.
      wrapped.add(step.body);
      pending.push({ body: step.body, upTo: step.body.length });
    }
  }
  return out;
}

/**
 * Walk a body backwards from `upTo`, collecting groups that could be the latest wire
 * content (looking through optional members and into components). Returns `true` when a
 * required member seals the context.
 */
function scanBackward(
  d: DictionaryJSON,
  body: MemberRef[],
  upTo: number,
  out: GroupMember[],
  seen: Set<string> = new Set(),
): boolean {
  for (let i = upTo - 1; i >= 0; i--) {
    const member = body[i]!;
    if (member.kind === 'field') {
      if (member.reqd === 'Y') {
        return true;
      }
      continue;
    }
    if (member.kind === 'group') {
      out.push(member);
      scanBackward(d, member.members, member.members.length, out, seen); // trailing chain inside
      if (member.reqd === 'Y') {
        return true;
      }
      continue;
    }
    if (seen.has(member.name)) {
      continue; // reference cycle (reported separately) — don't recurse forever
    }
    seen.add(member.name);
    const component = getComponent(d, member.name);
    if (component && scanBackward(d, component.members, component.members.length, out, seen)) {
      if (member.reqd === 'Y') {
        return true;
      }
    }
  }
  return false;
}

/** The groups that stay open at the end of a placed member's own wire content. */
function placedOpenGroups(d: DictionaryJSON, ref: MemberRef): GroupMember[] {
  const out: GroupMember[] = [];
  if (ref.kind === 'field') {
    return out;
  }
  if (ref.kind === 'group') {
    out.push(ref);
    scanBackward(d, ref.members, ref.members.length, out);
    return out;
  }
  const component = getComponent(d, ref.name);
  if (component) {
    scanBackward(d, component.members, component.members.length, out);
  }
  return out;
}

/**
 * The wire tags that can appear right after position `from` in `body`: subsequent
 * members' scope-level tags (walking through optional members, which may be absent),
 * continuing — when the tail cannot guarantee a token — after the owning group/component
 * in every containing scope, plus the owning group's own delimiter (the next entry).
 */
function forwardHazardTags(d: DictionaryJSON, body: MemberRef[], from: number): Set<number> {
  const out = new Set<number>();
  const pending: { body: MemberRef[]; from: number }[] = [{ body, from }];
  const seen = new Set<MemberRef[]>();
  while (pending.length > 0) {
    const step = pending.pop()!;
    if (scanForward(d, step.body, step.from, out)) {
      continue;
    }
    if (seen.has(step.body)) {
      continue;
    }
    seen.add(step.body);
    const owner = bodyOwner(d, step.body);
    if (!owner || owner.kind === 'message') {
      continue;
    }
    if (owner.kind === 'group') {
      const delimiter = firstWireTag(d, owner.member.members, new Set());
      if (delimiter !== undefined) {
        out.add(delimiter); // the next entry of the same group opens with it
      }
      for (const site of findSites(d, (m) => m === owner.member)) {
        pending.push({ body: site.parent, from: site.index + 1 });
      }
    } else {
      for (const site of componentSites(d, owner.name)) {
        pending.push({ body: site.parent, from: site.index + 1 });
      }
    }
  }
  return out;
}

/**
 * Walk a body forward from `from`, collecting scope-level tags until a member guarantees
 * a wire token for THIS scope (`reqd 'Y'`). Returns `true` when sealed.
 */
function scanForward(
  d: DictionaryJSON,
  body: MemberRef[],
  from: number,
  out: Set<number>,
  seen: Set<string> = new Set(),
): boolean {
  for (let i = from; i < body.length; i++) {
    const member = body[i]!;
    if (member.kind === 'field') {
      out.add(member.tag);
      if (member.reqd === 'Y') {
        return true;
      }
      continue;
    }
    if (member.kind === 'group') {
      out.add(member.counterTag);
      if (member.reqd === 'Y') {
        return true;
      }
      continue;
    }
    if (seen.has(member.name)) {
      continue; // reference cycle (reported separately) — don't recurse forever
    }
    seen.add(member.name);
    const component = getComponent(d, member.name);
    const sealedInside = component ? scanForward(d, component.members, 0, out, seen) : false;
    if (sealedInside && member.reqd === 'Y') {
      return true;
    }
  }
  return false;
}

/** The wire tags a member introduces at its own scope level (not inside nested groups). */
function introducedTags(ctx: Ctx, ref: MemberRef): number[] {
  switch (ref.kind) {
    case 'field':
      return [ref.tag];
    case 'group':
      return [ref.counterTag];
    case 'component':
      return [...componentDirectTags(ctx.d, ref.name)];
  }
}

// --- body ownership --------------------------------------------------------------------------

type BodyOwner =
  | { kind: 'message' }
  | { kind: 'component'; name: string }
  | { kind: 'group'; member: GroupMember };

/** Which structure a members array belongs to (message, component def, or group body). */
function bodyOwner(d: DictionaryJSON, body: MemberRef[]): BodyOwner | undefined {
  for (const message of d.messages) {
    if (message.members === body) {
      return { kind: 'message' };
    }
  }
  for (const component of Object.values(d.components)) {
    if (component.members === body) {
      return { kind: 'component', name: component.name };
    }
  }
  let found: GroupMember | undefined;
  const walk = (members: MemberRef[]): boolean => {
    for (const member of members) {
      if (member.kind === 'group') {
        if (member.members === body) {
          found = member;
          return true;
        }
        if (walk(member.members)) {
          return true;
        }
      }
    }
    return false;
  };
  for (const message of d.messages) {
    if (walk(message.members)) {
      return { kind: 'group', member: found! };
    }
  }
  for (const component of Object.values(d.components)) {
    if (walk(component.members)) {
      return { kind: 'group', member: found! };
    }
  }
  return undefined;
}

/** The component whose definition (transitively) owns a body, if any. */
function owningComponentName(d: DictionaryJSON, body: MemberRef[]): string | undefined {
  let current = body;
  for (;;) {
    const owner = bodyOwner(d, current);
    if (!owner || owner.kind === 'message') {
      return undefined;
    }
    if (owner.kind === 'component') {
      return owner.name;
    }
    const sites = findSites(d, (m) => m === owner.member);
    if (sites.length === 0) {
      return undefined;
    }
    current = sites[0]!.parent; // a group definition occurs at exactly one structural site
  }
}

/** One position where a member sits inside a parent members array. */
interface Site {
  parent: MemberRef[];
  index: number;
}

/** Every site matching `predicate` across messages, component defs, and nested groups. */
function findSites(d: DictionaryJSON, predicate: (m: MemberRef) => boolean): Site[] {
  const sites: Site[] = [];
  const walk = (members: MemberRef[]): void => {
    members.forEach((member, index) => {
      if (predicate(member)) {
        sites.push({ parent: members, index });
      }
      if (member.kind === 'group') {
        walk(member.members);
      }
    });
  };
  for (const message of d.messages) {
    walk(message.members);
  }
  for (const component of Object.values(d.components)) {
    walk(component.members);
  }
  return sites;
}

/** Every site referencing a component by name. */
function componentSites(d: DictionaryJSON, name: string): Site[] {
  return findSites(d, (m) => m.kind === 'component' && m.name === name);
}

/** Whether `from`'s expansion (transitively) references component `target`. */
function componentExpansionContains(d: DictionaryJSON, from: string, target: string): boolean {
  const seen = new Set<string>();
  const walk = (members: MemberRef[]): boolean => {
    for (const member of members) {
      if (member.kind === 'component') {
        if (member.name === target) {
          return true;
        }
        if (!seen.has(member.name)) {
          seen.add(member.name);
          const component = getComponent(d, member.name);
          if (component && walk(component.members)) {
            return true;
          }
        }
      } else if (member.kind === 'group' && walk(member.members)) {
        return true;
      }
    }
    return false;
  };
  const start = getComponent(d, from);
  return start ? walk(start.members) : false;
}

// --- delimiter accounting --------------------------------------------------------------------

/**
 * Snapshot the resolved entry delimiter of every repeating group in the dictionary,
 * keyed by group object identity (append-only edits never replace group objects). Walks
 * each container's OWN tree — groups inside component definitions are collected once,
 * under the component.
 */
function collectGroupDelimiters(d: DictionaryJSON): Map<GroupMember, number | undefined> {
  const out = new Map<GroupMember, number | undefined>();
  const walk = (members: MemberRef[]): void => {
    for (const member of members) {
      if (member.kind === 'group') {
        out.set(member, firstWireTag(d, member.members, new Set()));
        walk(member.members);
      }
    }
  };
  for (const message of d.messages) {
    walk(message.members);
  }
  for (const component of Object.values(d.components)) {
    walk(component.members);
  }
  return out;
}

/** The first wire tag of a body — the parser's entry delimiter (mirrors Dictionary). */
function firstWireTag(
  d: DictionaryJSON,
  members: MemberRef[],
  seen: Set<string>,
): number | undefined {
  for (const member of members) {
    switch (member.kind) {
      case 'field':
        return member.tag;
      case 'group':
        return member.counterTag;
      case 'component': {
        if (seen.has(member.name)) {
          continue;
        }
        seen.add(member.name);
        const component = getComponent(d, member.name);
        if (!component) {
          continue;
        }
        const tag = firstWireTag(d, component.members, seen);
        if (tag !== undefined) {
          return tag;
        }
      }
    }
  }
  return undefined;
}

// --- small shared helpers --------------------------------------------------------------------

function getComponent(d: DictionaryJSON, name: string): ComponentDef | undefined {
  return hasOwn(d.components, name) ? d.components[name] : undefined;
}

/** A component's expansion at its own level: field tags and group counter tags. */
function componentDirectTags(d: DictionaryJSON, name: string): Set<number> {
  const component = getComponent(d, name);
  return component ? expandedScope(d, component.members).tags : new Set();
}

/** How many times a component is referenced across all messages and components. */
function componentReferenceCount(d: DictionaryJSON, name: string): number {
  return componentSites(d, name).length;
}

/** The names of messages whose expansion (transitively) reaches a component. */
function messagesReaching(d: DictionaryJSON, name: string): string[] {
  const reaches = (members: MemberRef[], seen: Set<string>): boolean => {
    for (const member of members) {
      if (member.kind === 'component') {
        if (member.name === name) {
          return true;
        }
        if (!seen.has(member.name)) {
          seen.add(member.name);
          const component = getComponent(d, member.name);
          if (component && reaches(component.members, seen)) {
            return true;
          }
        }
      } else if (member.kind === 'group' && reaches(member.members, seen)) {
        return true;
      }
    }
    return false;
  };
  return d.messages.filter((m) => reaches(m.members, new Set())).map((m) => m.name);
}

/** Index right before a trailing trailer component (one whose expansion carries tag 10). */
function beforeTrailerIndex(d: DictionaryJSON, body: MemberRef[]): number {
  const last = body[body.length - 1];
  if (last?.kind === 'component' && componentDirectTags(d, last.name).has(10)) {
    return body.length - 1;
  }
  return body.length;
}

/**
 * Whether the body already carries the member's identity at its scope level — directly
 * or through a referenced component. The expanded check matters: a field that is already
 * reachable via a component in the same body would be emitted twice per scope by encode
 * and dropped as `parse/duplicate-tag` on re-parse.
 */
function hasMemberIdentity(ctx: Ctx, body: MemberRef[], ref: MemberRef): boolean {
  const scope = expandedScope(ctx.d, body);
  switch (ref.kind) {
    case 'field':
      return scope.tags.has(ref.tag);
    case 'group':
      return scope.tags.has(ref.counterTag);
    case 'component':
      return scope.components.has(ref.name);
  }
}

/**
 * A body's scope-level expansion: every field tag and group counter tag that puts data
 * on the wire directly in this scope (descending into components, not into groups), and
 * every component name referenced (transitively).
 */
function expandedScope(
  d: DictionaryJSON,
  body: MemberRef[],
): { tags: Set<number>; components: Set<string> } {
  const tags = new Set<number>();
  const components = new Set<string>();
  const walk = (members: MemberRef[]): void => {
    for (const member of members) {
      if (member.kind === 'field') {
        tags.add(member.tag);
      } else if (member.kind === 'group') {
        tags.add(member.counterTag);
      } else if (!components.has(member.name)) {
        components.add(member.name);
        const component = getComponent(d, member.name);
        if (component) {
          walk(component.members);
        }
      }
    }
  };
  walk(body);
  return { tags, components };
}

/** Anchor lookup: a member matching a field, group-counter, or component name. */
function findMemberIndex(ctx: Ctx, body: MemberRef[], name: string): number {
  const field = ctx.fieldsByName.get(name);
  return body.findIndex((member) => {
    switch (member.kind) {
      case 'field':
        return field !== undefined && member.tag === field.tag;
      case 'group':
        return field !== undefined && member.counterTag === field.tag;
      case 'component':
        return member.name === name;
    }
  });
}

/** Whether a datatype derives from (or is) `ancestor`, walking parents with a cycle guard. */
function derivesFrom(d: DictionaryJSON, type: string, ancestor: string): boolean {
  const seen = new Set<string>();
  let cursor = hasOwn(d.datatypes ?? {}, type) ? d.datatypes[type] : undefined;
  while (cursor && !seen.has(cursor.name)) {
    if (cursor.name === ancestor) {
      return true;
    }
    seen.add(cursor.name);
    cursor =
      cursor.parent !== undefined && hasOwn(d.datatypes, cursor.parent)
        ? d.datatypes[cursor.parent]
        : undefined;
  }
  return false;
}

function describeRef(ctx: Ctx, ref: MemberRef): string {
  switch (ref.kind) {
    case 'field':
      return `Field ${fieldLabel(ctx, ref.tag)}`;
    case 'group':
      return `The group headed by ${fieldLabel(ctx, ref.counterTag)}`;
    case 'component':
      return `Component "${ref.name}"`;
  }
}

function fieldLabel(ctx: Ctx, tag: number | undefined): string {
  if (tag === undefined) {
    return '(unresolved)';
  }
  const name = ctx.d.fields[tag]?.name;
  return name ? `${name} (${tag})` : `tag ${tag}`;
}

function refTag(ref: MemberRef): { refTagID?: number } {
  switch (ref.kind) {
    case 'field':
      return { refTagID: ref.tag };
    case 'group':
      return { refTagID: ref.counterTag };
    case 'component':
      return {};
  }
}

/** Own-property check (see Dictionary.ts — prototype-named keys must miss). */
function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Non-null, non-array object check that PRESERVES the checked value's type. */
function isPlainObject<T>(value: T): value is T & object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural equality over plain dictionary data (field defs, enum lists). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const ka = Object.keys(ra);
    return (
      ka.length === Object.keys(rb).length &&
      ka.every((k) => hasOwn(rb, k) && deepEqual(ra[k], rb[k]))
    );
  }
  return false;
}
