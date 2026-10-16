// @ts-check
// DOM kit: el(), svgEl(), clear(), getPath(), slug(), paint(), renderList() and the field renderers (CC-32, CD-4 §6).

import { AppError, ERR } from '../core/errors.js';
import { formatValue, toInputText } from '../core/format.js';

/** @typedef {import('../core/types.js').FieldDescriptor} FieldDescriptor */
/** @typedef {import('../core/types.js').FieldId} FieldId */
/** @typedef {import('../core/types.js').Category} Category */

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAINT_SELECTOR = '[data-out],[data-show],[data-flag],[data-attr],[data-error]';

/**
 * @typedef {Object} ElProps
 * @property {string} [class]
 * @property {string} [text]
 * @property {Object<string, string|boolean>} [attrs]
 * @property {Object<string, string>} [dataset]
 * @property {Object<string, EventListener>} [on]
 * @property {boolean} [hidden]
 */

/** @param {string} name */
function assertSafeAttr(name) {
  const key = name.toLowerCase();
  if (key === 'style' || key === 'srcdoc' || key.startsWith('on')) {
    throw new Error(`el(): attribute "${name}" is not allowed (CC-35)`);
  }
}

/**
 * @param {Element} node
 * @param {Object<string, string|boolean>} [attrs]
 */
function setAttrs(node, attrs) {
  for (const [name, value] of Object.entries(attrs ?? {})) {
    assertSafeAttr(name);
    if (value === true) node.setAttribute(name, '');
    else if (value !== false && value != null) node.setAttribute(name, String(value));
  }
}

/**
 * @param {Element} node
 * @param {Array<Node|string|null|false|undefined>} children
 */
function appendChildren(node, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/**
 * Builds an HTML element. Text is set only through textContent and text nodes (CC-35).
 * @param {string} tag
 * @param {ElProps} [props]
 * @param {...(Node|string|null|false|undefined)} children  strings become text nodes; null/false skipped
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  setAttrs(node, props.attrs);
  for (const [key, value] of Object.entries(props.dataset ?? {})) node.dataset[key] = value;
  for (const [type, listener] of Object.entries(props.on ?? {})) node.addEventListener(type, listener);
  if (props.hidden) node.hidden = true;
  if (props.text != null) node.textContent = props.text;
  appendChildren(node, children);
  return node;
}

/**
 * Builds an SVG element in the SVG namespace (for icons and CD-8 charts).
 * @param {string} tag
 * @param {Object<string, string|boolean>} [attrs]
 * @param {...(Node|string|null|false|undefined)} children
 * @returns {SVGElement}
 */
export function svgEl(tag, attrs = {}, ...children) {
  const node = /** @type {SVGElement} */ (document.createElementNS(SVG_NS, tag));
  setAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

/**
 * Removes all children of a node.
 * @param {Element} node
 */
export function clear(node) {
  node.replaceChildren();
}

/**
 * Resolves a dot path such as 'results.metrics.pct.value'; numeric segments index arrays; missing → undefined.
 * @param {unknown} obj
 * @param {string} path
 * @returns {unknown}
 */
export function getPath(obj, path) {
  let cur = /** @type {any} */ (obj);
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * Splits 'path:name path2:name2' into pairs.
 * @param {string} spec
 * @returns {Array<[string, string]>}
 */
function pairs(spec) {
  return spec.trim().split(/\s+/).filter(Boolean).map((item) => {
    const i = item.lastIndexOf(':');
    return /** @type {[string, string]} */ ([item.slice(0, i), item.slice(i + 1)]);
  });
}

/**
 * FieldId → path-safe key: 'category.x.thcMorning' → 'category_x_thcMorning' (CD-4 §6.2).
 * @param {FieldId} fieldId
 * @returns {string}
 */
export function slug(fieldId) {
  return fieldId.replace(/\./g, '_');
}

/**
 * The controls of a field ID inside root (exact match, no selector escaping needed).
 * @param {ParentNode} root
 * @param {FieldId} fieldId
 * @returns {HTMLElement[]}
 */
function fieldControls(root, fieldId) {
  return /** @type {HTMLElement[]} */ ([...root.querySelectorAll('[data-field]')])
    .filter((n) => n.dataset.field === fieldId);
}

/**
 * Paints one error node and marks its control(s): aria-invalid and aria-describedby (CC-32 rev 1, CD-4 §13).
 * @param {ParentNode} root
 * @param {HTMLElement} node
 * @param {object} vm
 */
function paintError(root, node, vm) {
  const fieldId = /** @type {string} */ (node.dataset.error);
  const errors = /** @type {Object<string, string>|undefined} */ (/** @type {any} */ (vm).errors);
  const text = errors?.[fieldId] ?? '';
  if (node.textContent !== text) node.textContent = text;
  if (node.hidden !== (text === '')) node.hidden = text === '';
  if (!node.id) node.id = `err-${slug(fieldId)}`;
  for (const control of fieldControls(root, fieldId)) {
    if (text) {
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', node.id);
    } else {
      control.removeAttribute('aria-invalid');
      if (control.getAttribute('aria-describedby') === node.id) control.removeAttribute('aria-describedby');
    }
  }
}

/**
 * Paints a view-model into the data-* output nodes inside `root` (CD-4 §6.2). Never formats, never reads or
 * writes input values or focus.
 * @param {ParentNode} root
 * @param {object} vm
 */
export function paint(root, vm) {
  for (const node of root.querySelectorAll(PAINT_SELECTOR)) {
    const ds = /** @type {HTMLElement} */ (node).dataset;
    if (ds.out !== undefined) {
      const text = String(getPath(vm, ds.out) ?? '');
      if (node.textContent !== text) node.textContent = text;
    }
    if (ds.show !== undefined) {
      const hidden = !getPath(vm, ds.show);
      if (/** @type {HTMLElement} */ (node).hidden !== hidden) /** @type {HTMLElement} */ (node).hidden = hidden;
    }
    if (ds.flag !== undefined) {
      for (const [path, cls] of pairs(ds.flag)) node.classList.toggle(cls, !!getPath(vm, path));
    }
    if (ds.attr !== undefined) {
      for (const [path, name] of pairs(ds.attr)) {
        const value = getPath(vm, path);
        if (value === true) node.setAttribute(name, '');
        else if (typeof value === 'string') node.setAttribute(name, value);
        else node.removeAttribute(name);
      }
    }
    if (ds.error !== undefined) paintError(root, /** @type {HTMLElement} */ (node), vm);
  }
}

/**
 * Keyed rebuild (CD-4 §6.3). Reuses the existing child for a key when sigOf is given and its signature is
 * unchanged; otherwise calls render(item). Children end in items order; children with unknown keys are removed.
 * @template T
 * @param {HTMLElement} container
 * @param {T[]} items
 * @param {(item: T) => string} keyOf
 * @param {(item: T) => HTMLElement} render
 * @param {{ sigOf?: (item: T) => string }} [opts]
 */
export function renderList(container, items, keyOf, render, opts = {}) {
  /** @type {Map<string, HTMLElement>} */
  const existing = new Map();
  for (const child of /** @type {HTMLElement[]} */ ([...container.children])) {
    if (child.dataset.key !== undefined) existing.set(child.dataset.key, child);
  }
  /** @type {HTMLElement[]} */
  const nodes = items.map((item) => {
    const key = keyOf(item);
    const sig = opts.sigOf ? opts.sigOf(item) : null;
    const old = existing.get(key);
    if (old && sig !== null && old.dataset.sig === sig) {
      existing.delete(key);
      return old;
    }
    const node = render(item);
    node.dataset.key = key;
    if (sig !== null) node.dataset.sig = sig;
    return node;
  });
  for (const child of /** @type {HTMLElement[]} */ ([...container.children])) {
    if (!nodes.includes(child)) child.remove();
  }
  nodes.forEach((node, i) => {
    if (container.children[i] !== node) container.insertBefore(node, container.children[i] ?? null);
  });
}

// ── Field renderers (CD-4 §6.4) ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} FieldOpts
 * @property {boolean} [precise]     D4-06: 1 dp at rest, full precision on focus (decimal only)
 * @property {string} [label]        label text instead of desc.label
 * @property {boolean} [hideLabel]   label visually hidden (table cells)
 * @property {boolean} [multiline]   text: a textarea
 * @property {boolean} [defaultLine] entry page: the default / "Overridden" / reset line, painted from
 *                                   fields.<slug>.{defaultText, overridden, offerReset} (CD-4 §8.1, §8.3)
 */

/** @param {FieldDescriptor} desc */
const inputModeOf = (desc) => desc.inputMode ?? (desc.type === 'decimal' ? 'decimal' : desc.type === 'int' ? 'numeric' : 'text');

/**
 * The common .field wrapper: label, control(s), optional unit, help and the error node.
 * @param {FieldDescriptor} desc
 * @param {FieldId} fieldId
 * @param {FieldOpts} opts
 * @param {HTMLElement} control
 */
function fieldWrapper(desc, fieldId, opts, control) {
  const id = `f-${slug(fieldId)}`;
  control.id = id;
  return el('div', { class: `field field-${desc.type}` },
    el('label', { class: opts.hideLabel ? 'sr-only' : 'field-label', attrs: { for: id }, text: opts.label ?? desc.label }),
    el('span', { class: 'field-control' }, control, desc.unit ? el('span', { class: 'field-unit', text: desc.unit }) : null),
    opts.defaultLine ? defaultLine(fieldId) : null,
    desc.help && !opts.hideLabel ? el('span', { class: 'field-help', text: desc.help }) : null,
    errorNode(fieldId));
}

/** @param {FieldId} fieldId */
const errorNode = (fieldId) => el('span', { class: 'field-error', dataset: { error: fieldId }, attrs: { role: 'alert' }, hidden: true });

/**
 * The weekday-default line of an entry field: default text, an "Overridden" badge and a reset button
 * (FR-BAS-07, NV-IN-02; CD-4 §8.1). Text comes from the view-model.
 * @param {FieldId} fieldId
 */
function defaultLine(fieldId) {
  const key = `fields.${slug(fieldId)}`;
  return el('span', { class: 'field-default' },
    el('span', { class: 'field-default-text', dataset: { out: `${key}.defaultText` } }),
    el('span', { class: 'badge badge-override', text: 'Overridden',
      attrs: { title: 'Differs from the weekday table', 'aria-label': 'Overridden: differs from the weekday table' },
      dataset: { show: `${key}.overridden` }, hidden: true }),
    el('button', { class: 'link-button', text: '↺ Reset', attrs: { type: 'button', 'aria-label': 'Reset to the weekday default' },
      dataset: { action: 'field.reset', target: fieldId, show: `${key}.offerReset` }, hidden: true }));
}

/**
 * The combo field (CD-4 §6.4): a chip group (None, fixedOptions, known options, More…) filled by the page from
 * the view-model's combos.<slug>.options, a "New name" text input, and a line with the chosen value.
 * @param {FieldDescriptor} desc
 * @param {FieldId} fieldId
 * @param {FieldOpts} opts
 */
function comboField(desc, fieldId, opts) {
  const key = slug(fieldId);
  const labelId = `l-${key}`;
  const input = textInput({ ...desc, placeholder: undefined }, fieldId, opts);
  input.id = `f-${key}`;
  return el('div', { class: 'field field-combo' },
    el('span', { class: 'field-label', attrs: { id: labelId }, text: opts.label ?? desc.label }),
    el('div', { class: 'combo-chips', attrs: { role: 'radiogroup', 'aria-labelledby': labelId }, dataset: { combo: fieldId } }),
    el('button', { class: 'link-button combo-more', text: 'More…', attrs: { type: 'button' },
      dataset: { action: 'combo.more', target: fieldId, show: `combos.${key}.more` }, hidden: true }),
    el('label', { class: 'field-sublabel', attrs: { for: input.id }, text: 'New name' }),
    el('span', { class: 'field-control' }, input),
    el('span', { class: 'combo-summary', dataset: { out: `combos.${key}.summary` } }),
    desc.help ? el('span', { class: 'field-help', text: desc.help }) : null,
    errorNode(fieldId));
}

/**
 * @param {FieldDescriptor} desc
 * @param {FieldId} fieldId
 * @param {FieldOpts} opts
 */
function textInput(desc, fieldId, opts) {
  /** @type {Object<string, string|boolean>} */
  const attrs = { type: 'text', inputmode: inputModeOf(desc), autocomplete: 'off', enterkeyhint: 'done',
    spellcheck: desc.type === 'text' ? 'true' : 'false' };
  if (desc.placeholder) attrs.placeholder = desc.placeholder;
  if (desc.maxLength !== undefined) attrs.maxlength = String(desc.maxLength);
  if (desc.type === 'text') attrs.autocapitalize = 'sentences';
  /** @type {Object<string, string>} */
  const dataset = { field: fieldId };
  if (opts.precise && desc.type === 'decimal') dataset.precise = '';
  return el('input', { class: 'input', attrs, dataset });
}

/** @type {Readonly<Object<string, (desc: FieldDescriptor, fieldId: FieldId, opts: FieldOpts) => HTMLElement>>} */
export const FIELD_RENDERERS = Object.freeze({
  decimal: (desc, fieldId, opts) => fieldWrapper(desc, fieldId, opts, textInput(desc, fieldId, opts)),
  int: (desc, fieldId, opts) => fieldWrapper(desc, fieldId, opts, textInput(desc, fieldId, opts)),
  text: (desc, fieldId, opts) => fieldWrapper(desc, fieldId, opts, opts.multiline
    ? el('textarea', { class: 'input', attrs: { rows: '3', autocapitalize: 'sentences' }, dataset: { field: fieldId } })
    : textInput(desc, fieldId, opts)),
  combo: comboField,
});

/**
 * Renders one descriptor field (CD-4 §6.4). An unknown type renders a visible placeholder and logs an error;
 * assertRenderable rejects it at boot.
 * @param {FieldDescriptor} desc
 * @param {FieldId} fieldId
 * @param {FieldOpts} [opts]
 * @returns {HTMLElement}
 */
export function renderField(desc, fieldId, opts = {}) {
  const renderer = Object.hasOwn(FIELD_RENDERERS, desc.type) ? FIELD_RENDERERS[desc.type] : null;
  if (!renderer) {
    console.error(`renderField: unsupported field type "${desc.type}" for ${fieldId}`);
    return el('div', { class: 'field-unsupported', text: 'This field can\'t be shown in this version.' });
  }
  return renderer(desc, fieldId, opts);
}

/**
 * Writes a stored value into the control(s) of fieldId; used on load and after a discrete action, never during
 * typing. Radios are checked when their value matches; a score group's fieldset is skipped.
 * Precise decimals hold the 1 dp summary at rest and keep the full text in data-full for focus (D4-06).
 * @param {ParentNode} root
 * @param {FieldId} fieldId
 * @param {number|string|null|undefined} value
 * @param {FieldDescriptor} desc
 */
export function fillField(root, fieldId, value, desc) {
  for (const control of fieldControls(root, fieldId)) {
    if (control.tagName === 'FIELDSET') continue;                 // a radio group's wrapper (scorePicker)
    const input = /** @type {HTMLInputElement} */ (control);
    const full = toInputText(value ?? null);
    if (input.type === 'radio') {
      input.checked = full !== '' && input.getAttribute('value') === full;
    } else if (input.dataset.precise !== undefined) {
      input.dataset.full = full;
      input.value = desc.type === 'decimal' && typeof value === 'number' ? formatValue(value, 'dec1') : full;
    } else {
      input.value = full;
    }
  }
}

/**
 * Focus of a precise decimal: show full precision and remember the text shown (D4-06).
 * @param {HTMLInputElement} input
 */
export function preciseFocus(input) {
  if (input.getAttribute('aria-invalid') === 'true') {        // invalid text stays as typed (CD-4 §10.2)
    delete input.dataset.shown;
    return;
  }
  input.dataset.rest = input.value;
  input.value = input.dataset.full ?? input.value;
  input.dataset.shown = input.value;
}

/**
 * Blur of a precise decimal: unchanged text goes back to the summary; a changed text stays as typed.
 * @param {HTMLInputElement} input
 */
export function preciseBlur(input) {
  if (input.dataset.shown !== undefined && input.value === input.dataset.shown && input.dataset.rest !== undefined) {
    input.value = input.dataset.rest;
  }
}

/**
 * Throws CATEGORY_INVALID naming the first descriptor whose type has no renderer (D4-01; fatal at boot, CC-29 rev 1).
 * @param {Category} category
 */
export function assertRenderable(category) {
  for (const list of /** @type {const} */ (['entryFields', 'settingsFields', 'weekdayFields'])) {
    (category[list] ?? []).forEach((desc, i) => {
      if (!Object.hasOwn(FIELD_RENDERERS, desc?.type)) {
        throw new AppError(ERR.CATEGORY_INVALID,
          `${category.id}.${list}[${i}] "${desc?.key}": field type "${desc?.type}" cannot be rendered`);
      }
    });
  }
}
