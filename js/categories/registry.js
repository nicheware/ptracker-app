// @ts-check
// Category registry: lookup by id and the contract check run at boot (CC-20 rev 1, CD-3 §3).

import { nevro } from './nevro/index.js';
import { AppError, ERR } from '../core/errors.js';
import { WEEKDAYS } from '../core/dates.js';

/** @typedef {import('../core/types.js').Category} Category */

/** @type {string} */
export const DEFAULT_CATEGORY_ID = 'nevro';

/** Immutable constant, not mutable state (CC-04). */
const CATEGORIES = Object.freeze({ [nevro.id]: nevro });

const FIELD_TYPES = new Set(['decimal', 'int', 'text', 'combo']);           // CC-21 rev 1 ('custom' removed)
const DISPLAY_TOKENS = new Set(['int', 'dec1', 'pct1Signed', 'pct0Signed', 'ml', 'text', 'date', 'dateLong', 'weekday']);
const CSV_TOKENS = new Set(['int', 'dec1', 'num', 'text', 'weekday', 'date']);
const TAG_KINDS = new Set(['treatment', 'positive', 'event']);
const RESERVED_KEYS = new Set(['schemaVersion', 'derived']);
const MIGRATION_KINDS = new Set(['record', 'weekday', 'tag', 'settings']);
const NAMESPACE_KINDS = ['record', 'weekday', 'settings'];
const M2_GROUP = /** @type {const} */ (['chart', 'groupKey', 'mainMetric', 'importRules']);

/** @returns {string[]} ids in registration order */
export function listCategoryIds() {
  return Object.keys(CATEGORIES);
}

/**
 * @param {string} id
 * @param {Readonly<Object<string, Category>>} [categories]  the registered set; tests pass their own
 * @returns {Category}  the frozen category object
 * @throws {AppError} UNKNOWN_CATEGORY if not registered; CATEGORY_INVALID if assertCategory finds problems
 */
export function getCategory(id, categories = CATEGORIES) {
  if (!Object.hasOwn(categories, id)) throw new AppError(ERR.UNKNOWN_CATEGORY, `unknown category "${id}"`);
  const c = categories[id];
  const { ok, problems } = assertCategory(c);
  if (!ok) {
    console.error(`category "${id}" is invalid:`, problems);
    throw new AppError(ERR.CATEGORY_INVALID, problems.join('; '), { detail: { problems } });
  }
  return c;
}

/** @param {unknown} a @returns {boolean} */
const isStringArray = (a) => Array.isArray(a) && a.length > 0 && a.every((s) => typeof s === 'string' && s !== '');

/**
 * Calls fn and returns its result, or records a problem when it throws.
 * @template T
 * @param {string[]} problems
 * @param {string} name
 * @param {() => T} fn
 * @returns {T|undefined}
 */
function attempt(problems, name, fn) {
  try {
    return fn();
  } catch (e) {
    problems.push(`${name}: threw ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

/**
 * Checks a category object against the contract (CD-3 §3, §4, §5). Pure; never throws.
 * @param {Category} c
 * @returns {{ ok: boolean, problems: string[] }}  developer messages
 */
export function assertCategory(c) {
  /** @type {string[]} */
  const problems = [];
  if (c == null || typeof c !== 'object') return { ok: false, problems: ['category: not an object'] };
  const cat = /** @type {any} */ (c);

  // Identity
  if (typeof cat.id !== 'string' || !/^[a-z][a-z0-9-]{1,23}$/.test(cat.id)) problems.push('id: invalid');
  if (typeof cat.name !== 'string' || cat.name.trim() === '') problems.push('name: invalid');
  if (!Number.isInteger(cat.schemaVersion) || cat.schemaVersion < 1) problems.push('schemaVersion: invalid');

  // Required M1 properties
  const FUNCS = ['defaultSettings', 'paramsFromSettings', 'seedWeekdays', 'defaultTags', 'validate', 'fieldOptions',
    'deriveRecord', 'historyMetrics', 'dayBadges'];
  const ARRAYS = ['migrations', 'settingsFields', 'weekdayFields', 'entryFields', 'displayMetrics', 'historyColumns'];
  for (const k of FUNCS) if (typeof cat[k] !== 'function') problems.push(`${k}: missing`);
  for (const k of ARRAYS) if (!Array.isArray(cat[k])) problems.push(`${k}: missing`);
  if (!isStringArray(cat.derivedKeys)) problems.push('derivedKeys: missing');
  if (!isStringArray(cat.historyKeys)) problems.push('historyKeys: missing');
  const csv = cat.csv;
  if (csv == null || typeof csv !== 'object' || typeof csv.fileId !== 'string' || csv.fileId === ''
    || !Array.isArray(csv.standard) || !Array.isArray(csv.extended)) problems.push('csv: missing');

  // M2 group: all four or none; individually optional extras
  const present = M2_GROUP.filter((k) => cat[k] !== undefined);
  if (present.length > 0 && present.length < M2_GROUP.length) {
    const missing = M2_GROUP.filter((k) => cat[k] === undefined);
    problems.push(`${present[0]}: present without ${missing.join(', ')}`);
  }
  if (cat.chart !== undefined && (cat.chart === null || typeof cat.chart !== 'object')) problems.push('chart: invalid');
  if (cat.groupKey !== undefined && typeof cat.groupKey !== 'function') problems.push('groupKey: invalid');
  if (cat.importRules !== undefined && (cat.importRules === null || typeof cat.importRules !== 'object')) {
    problems.push('importRules: invalid');
  }
  if (cat.mainMetric !== undefined) {
    if (typeof cat.mainMetric !== 'string') problems.push('mainMetric: invalid');
    else if (Array.isArray(cat.derivedKeys) && !cat.derivedKeys.includes(cat.mainMetric)) {
      problems.push(`mainMetric: "${cat.mainMetric}" not in derivedKeys`);
    }
  }
  if (cat.statsSplit !== undefined && (cat.statsSplit === null || typeof cat.statsSplit.keyOf !== 'function')) {
    problems.push('statsSplit: invalid');
  }
  if (cat.mainMetricDisplay !== undefined && (cat.mainMetricDisplay === null || typeof cat.mainMetricDisplay !== 'object')) {
    problems.push('mainMetricDisplay: invalid');
  }
  if (cat.statsLabel !== undefined && typeof cat.statsLabel !== 'string') problems.push('statsLabel: invalid');

  // Field descriptors
  /** @param {string} list */
  const checkFields = (list) => {
    const fields = Array.isArray(cat[list]) ? cat[list] : [];
    fields.forEach((f, i) => {
      if (f == null || typeof f.key !== 'string' || f.key === '') problems.push(`${list}[${i}]: missing key`);
      else if (RESERVED_KEYS.has(f.key)) problems.push(`${list}[${i}]: reserved key "${f.key}"`);
      if (typeof f?.label !== 'string' || f.label === '') problems.push(`${list}[${i}]: missing label`);
      if (f?.shortLabel !== undefined && (typeof f.shortLabel !== 'string' || f.shortLabel === '')) {
        problems.push(`${list}[${i}]: invalid shortLabel`);
      }
      if (!FIELD_TYPES.has(f?.type)) problems.push(`${list}[${i}]: unknown type "${f?.type}"`);
    });
    return fields;
  };
  checkFields('settingsFields');
  const weekday = checkFields('weekdayFields');
  const entry = checkFields('entryFields');

  /** @param {string} list @param {any[]} fields */
  const checkUnique = (list, fields) => {
    const seen = new Set();
    for (const f of fields) {
      if (typeof f?.key !== 'string') continue;
      if (seen.has(f.key)) problems.push(`${list}: duplicate key "${f.key}"`);
      seen.add(f.key);
    }
  };
  checkUnique('settingsFields', /** @type {any[]} */ (Array.isArray(cat.settingsFields) ? cat.settingsFields : []));
  checkUnique('weekdayFields', weekday);
  checkUnique('entryFields', entry);
  for (const w of weekday) {
    const e = entry.find((f) => f?.key === w?.key);
    if (!e) problems.push(`entryFields: weekday field "${w?.key}" missing`);
    else if (e.weekdayDefault !== true) problems.push(`entryFields: weekday field "${w.key}" needs weekdayDefault`);
  }
  for (const e of entry) {
    if (e?.weekdayDefault === true && !weekday.some((w) => w?.key === e.key)) {
      problems.push(`entryFields: "${e.key}" has weekdayDefault but no weekday field`);
    }
  }
  if (typeof cat.defaultSettings === 'function' && typeof cat.paramsFromSettings === 'function') {
    const params = attempt(problems, 'paramsFromSettings', () => cat.paramsFromSettings(cat.defaultSettings()));
    for (const key of Object.keys(params ?? {})) {
      if (RESERVED_KEYS.has(key)) problems.push(`paramsFromSettings: reserved key "${key}"`);
      if (entry.some((f) => f?.key === key)) problems.push(`entryFields: duplicate key "${key}"`);
    }
  }

  // Seeds
  if (typeof cat.seedWeekdays === 'function') {
    const seeds = attempt(problems, 'seedWeekdays', () => cat.seedWeekdays());
    if (!Array.isArray(seeds)) {
      if (seeds !== undefined) problems.push('seedWeekdays: not an array');
    } else {
      const weekdayKeys = weekday.map((f) => f?.key).sort().join(',');
      for (const code of WEEKDAYS) {
        const n = seeds.filter((s) => s?.weekday === code).length;
        if (n === 0) problems.push(`seedWeekdays: missing ${code}`);
        if (n > 1) problems.push(`seedWeekdays: duplicate ${code}`);
      }
      for (const s of seeds) {
        if (!WEEKDAYS.includes(s?.weekday)) problems.push(`seedWeekdays: unknown weekday "${s?.weekday}"`);
        const b = s?.baseline;
        if (typeof b !== 'number' || !Number.isFinite(b) || b < 0 || b > 10) problems.push(`seedWeekdays: bad baseline for ${s?.weekday}`);
        if (Object.keys(s?.values ?? {}).sort().join(',') !== weekdayKeys) problems.push(`seedWeekdays: values keys for ${s?.weekday}`);
      }
    }
  }
  if (typeof cat.defaultTags === 'function') {
    const tags = attempt(problems, 'defaultTags', () => cat.defaultTags());
    if (Array.isArray(tags)) {
      const seen = new Set();
      for (const t of tags) {
        if (typeof t?.code !== 'string' || t.code === '' || /\s/.test(t.code)) problems.push(`defaultTags: bad code "${t?.code}"`);
        else if (seen.has(t.code)) problems.push(`defaultTags: duplicate code "${t.code}"`);
        seen.add(t?.code);
        if (typeof t?.label !== 'string' || t.label.trim() === '') problems.push(`defaultTags: missing label for "${t?.code}"`);
        if (!TAG_KINDS.has(t?.kind)) problems.push(`defaultTags: bad kind for "${t?.code}"`);
      }
    } else if (tags !== undefined) problems.push('defaultTags: not an array');
  }

  // Metrics, columns and CSV columns: unique id/header and a known token
  /** @param {string} name @param {unknown} list @param {'id'|'header'} idKey @param {Set<string>} tokens */
  const checkDescriptors = (name, list, idKey, tokens) => {
    if (!Array.isArray(list)) return;
    const seen = new Set();
    list.forEach((d, i) => {
      const id = d?.[idKey];
      if (typeof id !== 'string' || id === '') problems.push(`${name}[${i}]: missing ${idKey}`);
      else if (seen.has(id)) problems.push(`${name}: duplicate ${idKey} "${id}"`);
      seen.add(id);
      if (typeof d?.get !== 'function') problems.push(`${name}[${i}]: missing get`);
      if (!tokens.has(d?.format)) problems.push(`${name}[${i}]: unknown format "${d?.format}"`);
    });
  };
  checkDescriptors('displayMetrics', cat.displayMetrics, 'id', DISPLAY_TOKENS);
  checkDescriptors('historyColumns', cat.historyColumns, 'id', DISPLAY_TOKENS);
  // Pinned columns (Day, Date) are always shown (FR-HIS-02, CC-21 rev 1.4)
  if (Array.isArray(cat.historyColumns)) {
    cat.historyColumns.forEach((c, i) => {
      if (c?.pinned && c?.defaultHidden) problems.push(`historyColumns[${i}]: a pinned column cannot be defaultHidden`);
      if (c?.shortLabel !== undefined && (typeof c.shortLabel !== 'string' || c.shortLabel === '')) {
        problems.push(`historyColumns[${i}]: invalid shortLabel`);
      }
    });
  }
  checkDescriptors('csv.standard', csv?.standard, 'header', CSV_TOKENS);
  checkDescriptors('csv.extended', csv?.extended, 'header', CSV_TOKENS);
  if (cat.chart && Array.isArray(cat.chart.series)) {
    checkDescriptors('chart.series', cat.chart.series.map((s) => ({ ...s, format: s?.format ?? 'dec1' })), 'id', DISPLAY_TOKENS);
  }

  // Migrations: valid kinds; per namespace kind contiguous from 1 to schemaVersion (CC-26 rev 1)
  if (Array.isArray(cat.migrations)) {
    for (const [i, s] of cat.migrations.entries()) {
      if (!MIGRATION_KINDS.has(s?.kind)) problems.push(`migrations[${i}]: unknown kind "${s?.kind}"`);
      if (typeof s?.migrate !== 'function') problems.push(`migrations[${i}]: missing migrate`);
      if (!Number.isInteger(s?.from) || s?.to !== s?.from + 1) problems.push(`migrations[${i}]: to must be from + 1`);
    }
    if (Number.isInteger(cat.schemaVersion)) {
      for (const kind of NAMESPACE_KINDS) {
        const steps = cat.migrations.filter((s) => s?.kind === kind).sort((a, b) => a.from - b.from);
        let v = 1;
        for (const s of steps) {
          if (s.from !== v) {
            problems.push(`migrations: gap at ${kind} ${v}`);
            break;
          }
          v = s.to;
        }
        if (v < cat.schemaVersion && !problems.some((p) => p.startsWith(`migrations: gap at ${kind}`))) {
          problems.push(`migrations: no ${kind} step to ${v + 1}`);
        }
        if (v > cat.schemaVersion) problems.push(`migrations: ${kind} steps go past schemaVersion`);
      }
    }
  }

  return { ok: problems.length === 0, problems };
}
