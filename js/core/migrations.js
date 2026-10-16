// @ts-check
// Object migrations, plain-data and shape checks, normaliseStored and the pure integrity planner (CD-1 §8–§9, CC-26).

import { SCHEMA, DATA_STORES, KIND_OF_STORE, SETTINGS_ID } from './schema.js';
import { AppError, ERR } from './errors.js';
import { isIsoDate, WEEKDAYS } from './dates.js';
import { derive, withDerived, storedDerived, derivedEquals, SCORE_KEYS } from './engine.js';

/** @typedef {import('./types.js').Category} Category */
/** @typedef {import('./types.js').MigrationStep} MigrationStep */
/** @typedef {import('./types.js').QuarantineEntry} QuarantineEntry */
/** @typedef {import('./types.js').StoreSnapshot} StoreSnapshot */
/** @typedef {import('./types.js').StoreName} StoreName */
/** @typedef {import('./types.js').Timestamp} Timestamp */
/** @typedef {'record'|'weekday'|'tag'|'settings'} Kind */

/** @type {MigrationStep[]} */
export const FRAMEWORK_STEPS = Object.freeze([]);   // empty in v1; steps are appended, never edited once released

const MAX_DEPTH = 16;
const TAG_KINDS = new Set(['treatment', 'positive', 'event']);

/** @param {unknown} v @returns {v is Object<string, any>} */
function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 * @param {object} [detail]
 * @returns {{ok: false, error: AppError}}
 */
const fail = (code, message, cause, detail) => ({ ok: false, error: new AppError(code, message, { cause, detail }) });

// ── Runner (§8.2) ───────────────────────────────────────────────────────────────────────────────────

/**
 * @param {any} obj
 * @param {Kind} kind
 * @param {readonly MigrationStep[]} steps
 * @param {number} target
 * @param {string} label
 * @returns {{ok: true, value: any, changed: boolean} | {ok: false, error: AppError}}
 */
function runChain(obj, kind, steps, target, label) {
  let v = obj?.schemaVersion;
  if (!Number.isInteger(v) || v < 1) return fail(ERR.MIGRATION_FAILED, `${label} ${kind}: bad schemaVersion`);
  if (v > target) return fail(ERR.SCHEMA_TOO_NEW, `${label} ${kind}: v${v} > v${target}`);
  let cur = obj;
  while (v < target) {
    const from = v;
    const step = steps.find((s) => s.from === from);
    if (!step || step.to !== from + 1) return fail(ERR.MIGRATION_FAILED, `${label} ${kind}: no step from v${from}`);
    try {
      cur = step.migrate(cur);
    } catch (e) {
      return fail(ERR.MIGRATION_FAILED, `${label} ${kind} v${from}: ${e instanceof Error ? e.message : String(e)}`, e);
    }
    if (cur?.schemaVersion !== step.to) return fail(ERR.MIGRATION_FAILED, `${label} ${kind}: step ${from} did not set v${step.to}`);
    v = step.to;
  }
  return { ok: true, value: cur, changed: cur !== obj };
}

/**
 * Migrates one object to the current framework version, then its active-category namespace to
 * category.schemaVersion (CC-26). Pure. Never throws for bad data.
 * @param {any} obj
 * @param {Kind} kind
 * @param {readonly MigrationStep[]} frameworkSteps
 * @param {Category} category
 * @param {Readonly<Record<string, number>>} [schema]  current framework versions; defaults to SCHEMA (tests inject)
 * @returns {{ok: true, value: any, changed: boolean} | {ok: false, error: AppError}}
 *          error.code is SCHEMA_TOO_NEW or MIGRATION_FAILED
 */
export function migrateObject(obj, kind, frameworkSteps, category, schema = SCHEMA) {
  const r1 = runChain(obj, kind, frameworkSteps.filter((s) => s.kind === kind), schema[kind], 'framework');
  if (!r1.ok) return r1;
  let cur = r1.value;
  let changed = r1.changed;
  if (kind !== 'tag') {
    const ns = cur.category?.[category.id];
    if (ns !== undefined) {
      const steps = category.migrations.filter((s) => s.kind === kind);
      const r2 = runChain(ns, kind, steps, category.schemaVersion, category.id);
      if (!r2.ok) return r2;
      if (r2.changed) {
        cur = { ...cur, category: { ...cur.category, [category.id]: r2.value } };
        changed = true;
      }
    }
  }
  return { ok: true, value: cur, changed };
}

/**
 * Identity step for a kind whose shape did not change when the category (or framework) bumped its version
 * (CC-26 rev 1). Pure.
 * @param {Kind} kind
 * @param {number} from
 * @returns {MigrationStep}
 */
export function versionBump(kind, from) {
  return Object.freeze({ kind, from, to: from + 1, migrate: (/** @type {Object} */ ns) => ({ ...ns, schemaVersion: from + 1 }) });
}

// ── Plain data (§4.2) ───────────────────────────────────────────────────────────────────────────────

/**
 * Returns null if `value` is plain persistable data, else a path and reason, e.g. 'scores.morning: NaN'.
 * -0 is reported too, because JSON backup would turn it into 0 and break round trips.
 * @param {unknown} value
 * @returns {string|null}
 */
export function checkPlainData(value) {
  return walk(value, '', 0);
}

/**
 * @param {unknown} v
 * @param {string} path
 * @param {number} depth
 * @returns {string|null}
 */
function walk(v, path, depth) {
  const at = path || '(root)';
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return null;
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return `${at}: NaN`;
    if (!Number.isFinite(v)) return `${at}: ${v > 0 ? 'Infinity' : '-Infinity'}`;
    if (Object.is(v, -0)) return `${at}: -0 not allowed`;
    return null;
  }
  if (v === undefined) return `${at}: undefined`;
  if (typeof v !== 'object') return `${at}: ${typeof v}`;
  if (depth >= MAX_DEPTH) return `${at}: nested too deeply`;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) return `${path}[${i}]: undefined`;
      const p = walk(v[i], `${path}[${i}]`, depth + 1);
      if (p) return p;
    }
    return null;
  }
  if (!isPlainObject(v)) return `${at}: ${v.constructor?.name ?? 'object'} not allowed`;
  for (const [k, x] of Object.entries(v)) {
    const p = walk(x, path ? `${path}.${k}` : k, depth + 1);
    if (p) return p;
  }
  return null;
}

// ── Shape checks (§9.1) ─────────────────────────────────────────────────────────────────────────────

/** @param {unknown} v */
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** @param {unknown} v */
const isNumOrNull = (v) => v === null || isFiniteNum(v);
/** @param {unknown} v */
const isStrOrNull = (v) => v === null || typeof v === 'string';
/** @param {unknown} v */
const isToken = (v) => typeof v === 'string' && v !== '' && !/\s/.test(v);

/**
 * The JS type a category value must have: decimal/int → number|null; text/combo → string|null.
 * @param {string} type
 * @returns {(v: unknown) => boolean}
 */
const checkerForFieldType = (type) => (type === 'decimal' || type === 'int' ? isNumOrNull : isStrOrNull);

/**
 * Category keys required on a record namespace (CD-1 §9.1): entry fields by descriptor type, then the
 * parameter-snapshot keys by the JS type of their default value.
 * @param {Category} category
 * @returns {Array<[string, (v: unknown) => boolean]>}
 */
function recordCategoryKeys(category) {
  /** @type {Array<[string, (v: unknown) => boolean]>} */
  const out = category.entryFields.map((f) => [f.key, checkerForFieldType(f.type)]);
  const params = /** @type {Object<string, unknown>} */ (category.paramsFromSettings(category.defaultSettings()));
  for (const [key, def] of Object.entries(params)) {
    if (out.some(([k]) => k === key)) continue;
    const t = def === null ? 'object' : typeof def;
    out.push([key, (v) => (t === 'object' ? v === null || isPlainObject(v) : typeof v === t)]);
  }
  return out;
}

/**
 * @param {any} r
 * @param {string|null} key
 * @param {Category} category
 * @returns {string|null}
 */
function checkRecord(r, key, category) {
  if (!isIsoDate(r.date)) return 'date: not an ISO date';
  if (key !== null && r.date !== key) return `date: ${r.date} does not match key ${key}`;
  if (!isPlainObject(r.scores)) return 'scores: missing';
  for (const k of SCORE_KEYS) {
    if (!(k in r.scores)) return `scores.${k}: missing`;
    const s = r.scores[k];
    if (s !== null && !(Number.isInteger(s) && s >= 0 && s <= 10)) return `scores.${k}: not an integer 0–10 or null`;
  }
  if (!Array.isArray(r.other) || !r.other.every(isToken)) return 'other: not a list of tokens';
  if (typeof r.comment !== 'string') return 'comment: not a string';
  if (!('baseline' in r) || !isNumOrNull(r.baseline)) return 'baseline: not a number or null';
  if (!isPlainObject(r.category)) return 'category: not an object';
  const ns = r.category[category.id];
  if (!isPlainObject(ns)) return `category.${category.id}: missing`;
  if (!Number.isInteger(ns.schemaVersion)) return `category.${category.id}.schemaVersion: not an integer`;
  for (const [k, ok] of recordCategoryKeys(category)) {
    if (!(k in ns)) return `category.${category.id}.${k}: missing`;
    if (!ok(ns[k])) return `category.${category.id}.${k}: wrong type`;
  }
  if (typeof r.createdAt !== 'string') return 'createdAt: not a string';
  if (typeof r.updatedAt !== 'string') return 'updatedAt: not a string';
  return null;
}

/**
 * @param {any} w
 * @param {string|null} key
 * @param {Category} category
 * @returns {string|null}
 */
function checkWeekday(w, key, category) {
  if (!WEEKDAYS.includes(w.weekday)) return 'weekday: not a weekday code';
  if (key !== null && w.weekday !== key) return `weekday: ${w.weekday} does not match key ${key}`;
  if (!isFiniteNum(w.baseline)) return 'baseline: not a number';
  if (!isPlainObject(w.category)) return 'category: not an object';
  const ns = w.category[category.id];
  if (ns === undefined) return null;                    // repaired by the settings service (§11.2)
  if (!isPlainObject(ns)) return `category.${category.id}: not an object`;
  for (const f of category.weekdayFields) {
    if (!(f.key in ns)) return `category.${category.id}.${f.key}: missing`;
    if (!checkerForFieldType(f.type)(ns[f.key])) return `category.${category.id}.${f.key}: wrong type`;
  }
  return null;
}

/**
 * @param {any} t
 * @param {string|null} key
 * @returns {string|null}
 */
function checkTag(t, key) {
  if (!isToken(t.code)) return 'code: empty or contains whitespace';
  if (key !== null && t.code !== key) return `code: ${t.code} does not match key ${key}`;
  if (typeof t.label !== 'string') return 'label: not a string';
  if (!TAG_KINDS.has(t.kind)) return 'kind: not a tag kind';
  if (typeof t.retired !== 'boolean') return 'retired: not a boolean';
  if (!isFiniteNum(t.order)) return 'order: not a number';
  return null;
}

/**
 * @param {any} s
 * @param {string|null} key
 * @param {Category} category
 * @returns {string|null}
 */
function checkSettings(s, key, category) {
  if (s.id !== SETTINGS_ID) return `id: not '${SETTINGS_ID}'`;
  if (key !== null && s.id !== key) return `id: does not match key ${key}`;
  if (typeof s.activeCategory !== 'string' || s.activeCategory === '') return 'activeCategory: empty';
  if (!isPlainObject(s.category)) return 'category: not an object';
  const ns = s.category[category.id];
  if (ns !== undefined && !isPlainObject(ns)) return `category.${category.id}: not an object`;
  for (const k of ['lastExportAt', 'lastBackupAt', 'lastExportRecordUpdatedAt']) {
    if (!(k in s) || !isStrOrNull(s[k])) return `${k}: not a string or null`;
  }
  if (typeof s.createdAt !== 'string') return 'createdAt: not a string';
  return null;
}

/**
 * Returns the first structural problem of a stored object, or null (CD-1 §9.1). Checks structure and types, not
 * business ranges; derived copies are not checked (they are recomputed).
 * @param {Kind} kind
 * @param {unknown} obj
 * @param {string|number|null} key  store key, if known
 * @param {Category} category
 * @returns {string|null}
 */
export function checkShape(kind, obj, key, category) {
  if (!isPlainObject(obj)) return 'not an object';
  if (!Number.isInteger(obj.schemaVersion) || obj.schemaVersion < 1) return 'schemaVersion: not a positive integer';
  const k = key == null ? null : String(key);
  switch (kind) {
    case 'record': return checkRecord(obj, k, category);
    case 'weekday': return checkWeekday(obj, k, category);
    case 'tag': return checkTag(obj, k);
    case 'settings': return checkSettings(obj, k, category);
    default: return `unknown kind ${kind}`;
  }
}

// ── normaliseStored (§8.3) ──────────────────────────────────────────────────────────────────────────

/**
 * Migrates and shape-checks one stored object. Used by the boot pass and by backup restore (CD-6), so both apply
 * identical rules (FR-BAK-03, CC-26 rev 1). Records are not re-derived here.
 * @param {Kind} kind
 * @param {unknown} raw
 * @param {string|number|null} key  store key, if known
 * @param {{category: Category, steps?: readonly MigrationStep[], schema?: Readonly<Record<string, number>>}} ctx
 *        steps defaults to FRAMEWORK_STEPS and schema to SCHEMA (tests inject)
 * @returns {{ok: true, value: any, migrated: boolean}
 *         | {ok: false, tooNew: true, error: AppError}
 *         | {ok: false, tooNew: false, reason: 'MIGRATION_FAILED'|'RECORD_SHAPE', detail: string}}
 */
export function normaliseStored(kind, raw, key, ctx) {
  /** @param {'MIGRATION_FAILED'|'RECORD_SHAPE'} reason @param {string} detail */
  const bad = (reason, detail) => /** @type {const} */ ({ ok: false, tooNew: false, reason, detail });
  if (!isPlainObject(raw)) return bad('RECORD_SHAPE', 'not an object');
  const m = migrateObject(raw, kind, ctx.steps ?? FRAMEWORK_STEPS, ctx.category, ctx.schema ?? SCHEMA);
  if (!m.ok) {
    return m.error.code === ERR.SCHEMA_TOO_NEW
      ? { ok: false, tooNew: true, error: m.error }
      : bad('MIGRATION_FAILED', m.error.message);
  }
  const problem = checkShape(kind, m.value, key, ctx.category) ?? checkPlainData(m.value);
  if (problem) return bad('RECORD_SHAPE', problem);
  return { ok: true, value: m.value, migrated: m.changed };
}

// ── Integrity planner (§9.2) ────────────────────────────────────────────────────────────────────────

/**
 * True when both stored derived copies are plain objects (RR-1): an absent copy is always rewritten.
 * @param {any} record
 * @param {string} id
 */
function hasDerivedCopies(record, id) {
  return isPlainObject(record.derived) && isPlainObject(record.category?.[id]?.derived);
}

/**
 * Names of the derived values that differ, for the log line.
 * @param {import('./types.js').Derived} a  stored
 * @param {import('./types.js').Derived} b  fresh
 * @param {string} id
 */
function derivedDiff(a, b, id) {
  /** @type {string[]} */
  const out = [];
  for (const k of /** @type {const} */ (['complete', 'average', 'low', 'high'])) {
    if (a[k] !== b[k]) out.push(`${k} ${a[k]} → ${b[k]}`);
  }
  const x = a.category?.[id] ?? {};
  const y = b.category?.[id] ?? {};
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if (x[k] !== y[k]) out.push(`${id}.${k} ${x[k]} → ${y[k]}`);
  }
  return out.length ? out.join(', ') : 'copy missing';
}

/**
 * Version of a stored object or its active namespace that is newer than the code knows, or null.
 * @param {unknown} o
 * @param {Kind} kind
 * @param {Category} category
 * @param {Readonly<Record<string, number>>} schema
 */
function tooNew(o, kind, category, schema) {
  if (!isPlainObject(o)) return null;
  if (typeof o.schemaVersion === 'number' && o.schemaVersion > schema[kind]) return `v${o.schemaVersion} > v${schema[kind]}`;
  if (kind === 'tag') return null;
  const nsv = isPlainObject(o.category) ? o.category[category.id]?.schemaVersion : undefined;
  if (typeof nsv === 'number' && nsv > category.schemaVersion) return `${category.id} v${nsv} > v${category.schemaVersion}`;
  return null;
}

/**
 * @typedef {Object} IntegrityPlan
 * @property {Array<{store: StoreName, value: object}>} puts       migrated or re-derived objects
 * @property {Array<{store: StoreName, key: string}>} deletes      sources of quarantined objects
 * @property {QuarantineEntry[]} quarantine                        new entries (no id)
 * @property {{migrated: number, quarantined: number, derivedFixed: number}} counts
 * @property {string[]} log                                        one line per change, for the console
 * @property {Omit<StoreSnapshot, 'quarantine'>} result            the data stores after the plan, in key order
 */

/**
 * The whole integrity pass as one pure function (CD-1 §9.2): refuse anything too new, then migrate, shape-check,
 * quarantine and re-derive.
 * @param {{records: unknown[], weekdays: unknown[], tags: unknown[], settings: unknown[],
 *          keys: {records: unknown[], weekdays: unknown[], tags: unknown[], settings: unknown[]}}} raw
 *        objects as read, with their store keys (aligned arrays)
 * @param {{category: Category, now: Timestamp, appVersion: string, steps?: readonly MigrationStep[],
 *          schema?: Readonly<Record<string, number>>}} ctx   steps and schema: as normaliseStored (tests inject)
 * @returns {{ok: true, plan: IntegrityPlan} | {ok: false, error: AppError}}   SCHEMA_TOO_NEW | UNKNOWN_CATEGORY
 */
export function planIntegrity(raw, ctx) {
  const { category } = ctx;
  const schema = ctx.schema ?? SCHEMA;
  const id = category.id;

  // Phase 1: refuse anything newer, before deciding anything.
  for (const store of DATA_STORES) {
    const kind = KIND_OF_STORE[store];
    for (const [i, o] of raw[store].entries()) {
      const why = tooNew(o, kind, category, schema);
      if (why) {
        const key = raw.keys[store][i];
        return fail(ERR.SCHEMA_TOO_NEW, `${store}/${key}: ${why}`, undefined, { store, key });
      }
    }
  }
  const s0 = /** @type {any} */ (raw.settings[0]);
  if (isPlainObject(s0) && typeof s0.activeCategory === 'string' && s0.activeCategory !== id) {
    return fail(ERR.UNKNOWN_CATEGORY, `settings.activeCategory "${s0.activeCategory}" is not "${id}"`);
  }

  // Phase 2: per object.
  /** @type {IntegrityPlan} */
  const plan = {
    puts: [], deletes: [], quarantine: [], counts: { migrated: 0, quarantined: 0, derivedFixed: 0 }, log: [],
    result: { records: [], weekdays: [], tags: [], settings: [] },
  };
  for (const store of DATA_STORES) {
    const kind = KIND_OF_STORE[store];
    for (const [i, o] of raw[store].entries()) {
      const rawKey = raw.keys[store][i];
      const key = rawKey == null ? null : String(rawKey);
      const n = normaliseStored(kind, o, key, { category, steps: ctx.steps, schema });
      if (!n.ok) {
        // tooNew cannot happen here: phase 1 refused it.
        const reason = n.tooNew ? ERR.SCHEMA_TOO_NEW : n.reason;
        const detail = n.tooNew ? n.error.message : n.detail;
        plan.quarantine.push({
          schemaVersion: SCHEMA.quarantine, store, key, reason, detail, raw: o,
          quarantinedAt: ctx.now, appVersion: ctx.appVersion,
        });
        plan.deletes.push({ store, key: /** @type {string} */ (key) });
        plan.log.push(`quarantined ${store}/${key}: ${reason} ${detail}`);
        continue;
      }
      let v = n.value;
      if (kind === 'record') {
        const fixed = withDerived(v, category);
        if (n.migrated) {
          plan.puts.push({ store, value: fixed });
          plan.counts.migrated++;
          plan.log.push(`migrated ${store}/${key}`);
        } else {
          const stored = storedDerived(v, category);
          const fresh = derive(v, category);
          if (!hasDerivedCopies(v, id) || !derivedEquals(stored, fresh)) {
            plan.puts.push({ store, value: fixed });
            plan.counts.derivedFixed++;
            plan.log.push(`derived fixed ${store}/${key}: ${hasDerivedCopies(v, id) ? derivedDiff(stored, fresh, id) : 'copy missing'}`);
          }
        }
        v = fixed;
      } else if (n.migrated) {
        plan.puts.push({ store, value: v });
        plan.counts.migrated++;
        plan.log.push(`migrated ${store}/${key}`);
      }
      plan.result[store].push(v);
    }
  }
  plan.counts.quarantined = plan.quarantine.length;
  return { ok: true, plan };
}
