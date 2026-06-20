import { type FixIssue, issue } from '../errors';
import type { BaseType, DictionaryJSON, MemberRef } from './types';

const BASE_TYPES = new Set<BaseType>(['int', 'float', 'char', 'String', 'data']);

/**
 * Structurally validate a {@link DictionaryJSON}: every reference resolves, every field
 * has a known datatype and a valid tag, datatype bases are real roots, group counters are
 * real counter fields with a resolvable delimiter, enum values are unique, and the
 * datatype derivation tree is acyclic. Returns a (possibly empty) list of {@link FixIssue}s
 * — it **never throws**, even on a corrupt/untrusted object missing whole collections, so
 * it is safe to run as the gate before {@link ./Dictionary.loadDictionary}. An empty
 * result means the dictionary is internally consistent and safe to load.
 *
 * This checks *internal consistency*, not conformance to any particular FIX version.
 */
export function validateDictionary(json: DictionaryJSON): FixIssue[] {
  const issues: FixIssue[] = [];

  if (!json.version) {
    issues.push(issue('dict/missing-version', 'Dictionary has no `version`.'));
  }
  if (!json.beginString) {
    issues.push(issue('dict/missing-begin-string', 'Dictionary has no `beginString`.'));
  }

  // Shape guards: an untrusted object may be missing whole collections. Report and skip
  // rather than dereferencing into a throw — this is the input class the gate exists for.
  const hasDatatypes = isObject(json.datatypes);
  const hasFields = isObject(json.fields);
  const hasComponents = isObject(json.components);
  const hasMessages = Array.isArray(json.messages);
  if (!hasDatatypes) {
    issues.push(
      issue('dict/missing-datatypes', 'Dictionary `datatypes` is missing or not an object.'),
    );
  }
  if (!hasFields) {
    issues.push(issue('dict/missing-fields', 'Dictionary `fields` is missing or not an object.'));
  }
  if (!hasComponents) {
    issues.push(
      issue('dict/missing-components', 'Dictionary `components` is missing or not an object.'),
    );
  }
  if (!hasMessages) {
    issues.push(
      issue('dict/missing-messages', 'Dictionary `messages` is missing or not an array.'),
    );
  }

  if (hasDatatypes) {
    validateDatatypes(json, issues);
  }
  if (hasFields) {
    validateFields(json, issues);
  }

  if (hasComponents) {
    for (const component of Object.values(json.components)) {
      walkMembers(json, component.members, `component ${component.name}`, issues, new Set());
    }
  }

  if (hasMessages) {
    const seenMsgTypes = new Set<string>();
    const seenNames = new Set<string>();
    for (const message of json.messages) {
      const where = `message ${message.name} (${message.msgType})`;
      if (!message.msgType) {
        issues.push(issue('dict/message-missing-msgtype', `${where} has no MsgType.`));
      } else if (seenMsgTypes.has(message.msgType)) {
        issues.push(
          issue(
            'dict/duplicate-msgtype',
            `MsgType "${message.msgType}" is defined by more than one message; only the first is reachable by code.`,
            { severity: 'warning', refMsgType: message.msgType },
          ),
        );
      } else {
        seenMsgTypes.add(message.msgType);
      }
      if (message.name) {
        if (seenNames.has(message.name)) {
          issues.push(
            issue(
              'dict/duplicate-message-name',
              `More than one message is named "${message.name}"; lookups by name are ambiguous.`,
              { severity: 'warning' },
            ),
          );
        } else {
          seenNames.add(message.name);
        }
      }
      walkMembers(json, message.members, where, issues, new Set());
    }
  }

  return issues;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateDatatypes(json: DictionaryJSON, issues: FixIssue[]): void {
  for (const dt of Object.values(json.datatypes)) {
    if (!BASE_TYPES.has(dt.base)) {
      issues.push(
        issue(
          'dict/datatype-bad-base',
          `Datatype "${dt.name}" has base "${dt.base}", not one of int|float|char|String|data.`,
        ),
      );
    }
    // Walk parent links to a root; detect cycles and dangling parents.
    const chain = new Set<string>([dt.name]);
    let cursor = dt.parent;
    while (cursor) {
      if (chain.has(cursor)) {
        issues.push(
          issue(
            'dict/datatype-cycle',
            `Datatype "${dt.name}" has a cyclic parent chain via "${cursor}".`,
          ),
        );
        break;
      }
      chain.add(cursor);
      const parent = json.datatypes[cursor];
      if (!parent) {
        issues.push(
          issue(
            'dict/datatype-missing-parent',
            `Datatype "${dt.name}" references unknown parent "${cursor}".`,
          ),
        );
        break;
      }
      cursor = parent.parent;
    }
  }
}

function validateFields(json: DictionaryJSON, issues: FixIssue[]): void {
  const namesByName = new Map<string, number>();
  for (const [key, field] of Object.entries(json.fields)) {
    const where = `field ${field.name} (${field.tag})`;
    if (!Number.isInteger(field.tag) || field.tag <= 0) {
      issues.push(
        issue('dict/field-bad-tag', `${where} has a tag that is not a positive integer.`, {
          refTagID: field.tag,
        }),
      );
    }
    if (Number(key) !== field.tag) {
      issues.push(
        issue(
          'dict/field-key-mismatch',
          `${where} is keyed as ${key} but its tag is ${field.tag}.`,
        ),
      );
    }
    if (!json.datatypes[field.type]) {
      issues.push(
        issue('dict/field-unknown-type', `${where} has unknown datatype "${field.type}".`, {
          refTagID: field.tag,
        }),
      );
    }
    const prior = namesByName.get(field.name);
    if (prior !== undefined && prior !== field.tag) {
      issues.push(
        issue(
          'dict/duplicate-field-name',
          `Field name "${field.name}" is used by both tag ${prior} and ${field.tag}.`,
        ),
      );
    }
    namesByName.set(field.name, field.tag);

    if (field.enumValues) {
      const seen = new Set<string>();
      for (const ev of field.enumValues) {
        if (seen.has(ev.value)) {
          issues.push(
            issue(
              'dict/duplicate-enum-value',
              `${where} lists enum value "${ev.value}" more than once.`,
              {
                severity: 'warning',
                refTagID: field.tag,
              },
            ),
          );
        }
        seen.add(ev.value);
      }
    }
  }
}

function walkMembers(
  json: DictionaryJSON,
  members: MemberRef[],
  where: string,
  issues: FixIssue[],
  seenComponents: Set<string>,
): void {
  if (!Array.isArray(members)) {
    return;
  }
  for (const member of members) {
    switch (member.kind) {
      case 'field':
        if (!json.fields[member.tag]) {
          issues.push(
            issue(
              'dict/unknown-field-ref',
              `${where} references unknown field tag ${member.tag}.`,
              {
                refTagID: member.tag,
              },
            ),
          );
        }
        break;
      case 'component': {
        const component = json.components[member.name];
        if (!component) {
          issues.push(
            issue(
              'dict/unknown-component-ref',
              `${where} references unknown component "${member.name}".`,
            ),
          );
          break;
        }
        if (seenComponents.has(member.name)) {
          issues.push(
            issue(
              'dict/component-cycle',
              `${where} forms a component reference cycle via "${member.name}".`,
            ),
          );
          break;
        }
        const nextSeen = new Set(seenComponents);
        nextSeen.add(member.name);
        walkMembers(json, component.members, `${where} > ${member.name}`, issues, nextSeen);
        break;
      }
      case 'group': {
        const counter = json.fields[member.counterTag];
        const groupWhere = `${where} > group ${member.counterTag}`;
        if (!counter) {
          issues.push(
            issue(
              'dict/unknown-group-counter',
              `${groupWhere} references unknown counter field ${member.counterTag}.`,
              {
                refTagID: member.counterTag,
              },
            ),
          );
        } else if (!counter.isGroupCounter) {
          issues.push(
            issue(
              'dict/non-counter-group-head',
              `${groupWhere}: field ${member.counterTag} (${counter.name}) is not a NumInGroup counter.`,
              { severity: 'warning', refTagID: member.counterTag },
            ),
          );
        }
        if (member.members.length === 0) {
          issues.push(
            issue('dict/empty-group', `${groupWhere} has no members.`, {
              severity: 'warning',
              refTagID: member.counterTag,
            }),
          );
        } else if (firstWireTag(json, member.members, new Set()) === undefined) {
          // A non-empty group whose body resolves to no field has no delimiter, so the
          // parser could never find entry boundaries — a load-bearing structural defect.
          issues.push(
            issue(
              'dict/unresolvable-group-delimiter',
              `${groupWhere} has a body but no resolvable delimiter (first field) tag.`,
              { refTagID: member.counterTag },
            ),
          );
        }
        walkMembers(json, member.members, groupWhere, issues, seenComponents);
        break;
      }
    }
  }
}

/** The first field tag that opens a member sequence, descending through leading components. */
function firstWireTag(
  json: DictionaryJSON,
  members: MemberRef[],
  seen: Set<string>,
): number | undefined {
  if (!Array.isArray(members)) {
    return undefined;
  }
  for (const member of members) {
    if (member.kind === 'field') {
      return member.tag;
    }
    if (member.kind === 'group') {
      return member.counterTag;
    }
    if (seen.has(member.name)) {
      continue;
    }
    seen.add(member.name);
    const component = json.components[member.name];
    if (!component) {
      continue;
    }
    const tag = firstWireTag(json, component.members, seen);
    if (tag !== undefined) {
      return tag;
    }
  }
  return undefined;
}
