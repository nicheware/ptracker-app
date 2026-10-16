// @ts-check
// DOM kit: el(), svgEl(), clear(), getPath() and paint() (CC-32, CD-4 §6.1–§6.2).

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAINT_SELECTOR = '[data-out],[data-show],[data-flag],[data-attr]';
// TODO(IT-06): data-error painting (with aria-invalid / aria-describedby), renderList, slug, field renderers,
// fillField and assertRenderable (CD-4 §6.2–§6.4).

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
  }
}
