// @ts-check
// Baseline & settings page controller (CD-4 §10): weekday table, category settings, tags, restore defaults, About.

import { el, paint, renderList, renderField, fillField, preciseFocus, preciseBlur } from '../dom.js';
import { confirmDialog } from '../widgets.js';
import { messageFor, NOTICES } from '../messages.js';
import { baselineViewModel, tagDialogViewModel, weekdayColumns } from '../../vm/baseline-vm.js';
import { EVENTS } from '../../core/events.js';
import { WEEKDAYS, weekdayName } from '../../core/dates.js';
import { validateField } from '../../core/validation.js';
import { settingsFieldSpec } from '../../core/settings-model.js';

/** @typedef {import('../../core/types.js').FieldDescriptor} FieldDescriptor */
/** @typedef {import('../../core/types.js').ValidationResult} ValidationResult */
/** @typedef {import('../../vm/baseline-vm.js').BaselineVM} BaselineVM */

/**
 * @typedef {Object} BaselineDeps
 * @property {import('../../core/types.js').Category} category
 * @property {import('../../core/types.js').SettingsService} settingsService
 * @property {import('../../core/types.js').StoragePersist} storagePersist
 * @property {import('../../core/events.js').Emitter} bus
 * @property {string} appName
 * @property {string} appVersion
 */

/** The framework descriptor of the weekday baseline column (CD-4 §10.2). */
const BASELINE_DESC = /** @type {FieldDescriptor} */ (Object.freeze({ key: 'baseline', label: 'Baseline', type: 'decimal', min: 0, max: 10 }));

/** @param {BaselineDeps} deps */
export function createBaselinePage(deps) {
  const { category, settingsService: service, bus } = deps;
  const id = category.id;
  /** @type {HTMLElement|null} */
  let root = null;
  /** @type {HTMLDialogElement|null} */
  let tagDialog = null;
  /** @type {HTMLDialogElement|null} */
  let confirmDlg = null;
  let visible = false;
  /** @type {import('../../core/types.js').BootReport|null} */
  let bootReport = null;
  /** persisted() result; undefined while pending. @type {boolean|null|undefined} */
  let storage;
  /** FieldId → message for the page's inline errors. @type {Object<string, string>} */
  let errors = {};
  /** The open tag dialog: the tag being edited (null = new) and its errors. */
  let dialogState = { code: /** @type {string|null} */ (null), errors: /** @type {Object<string, string>} */ ({}) };
  /** @type {BaselineVM|null} */
  let lastVm = null;

  /** @returns {Array<{ fieldId: string, desc: FieldDescriptor, value: unknown }>} every editable field and its value */
  function fields() {
    const list = [];
    for (const row of service.getWeekdays()) {
      list.push({ fieldId: `weekday.${row.weekday}.baseline`, desc: BASELINE_DESC, value: row.baseline });
      for (const f of category.weekdayFields) {
        list.push({ fieldId: `weekday.${row.weekday}.${f.key}`, desc: f, value: row.category?.[id]?.[f.key] ?? null });
      }
    }
    const cs = /** @type {Object<string, unknown>} */ (service.getCategorySettings() ?? {});
    for (const f of category.settingsFields) {
      list.push({ fieldId: `settings.category.${id}.${f.key}`, desc: f, value: cs[f.key] ?? null });
    }
    return list;
  }

  /** Fills inputs from the caches: on show and after a write only, never while typing (CD-4 §6.4). */
  function fill(/** @type {string|null} */ only = null) {
    if (!root) return;
    for (const f of fields()) {
      if (only === null || f.fieldId === only) fillField(root, f.fieldId, /** @type {any} */ (f.value), f.desc);
    }
  }

  function render() {
    if (!root) return;
    const vm = baselineViewModel({
      weekdays: service.getWeekdays(), settings: service.getSettings(), tags: service.getTags(), category,
      appName: deps.appName, appVersion: deps.appVersion, bootReport, storage, errors,
    });
    lastVm = vm;
    const list = /** @type {HTMLElement} */ (root.querySelector('.tag-list'));
    renderList(list, vm.tags, (t) => t.code, (t) => el('li', { class: `tag-row kind-${t.kind}` },
      el('span', { class: 'tag-code', text: t.code }),
      el('span', { class: 'tag-glyph', attrs: { 'aria-hidden': 'true' }, text: t.glyph }),
      el('span', { class: 'tag-label', text: t.label }),
      el('span', { class: 'tag-kind', text: t.status }),
      el('button', { class: 'tag-edit', text: 'Edit', attrs: { type: 'button', 'aria-label': `Edit ${t.code}, ${t.label}` },
        dataset: { action: 'tag.edit', code: t.code } })), { sigOf: (t) => JSON.stringify(t) });
    paint(root, vm);
    if (tagDialog?.open) paintTagDialog();
  }

  /** @param {import('../toast.js').Toast} toast */
  const toast = (toast) => bus.emit(EVENTS.UI_TOAST, toast);
  const saved = () => toast({ kind: 'success', text: NOTICES.SAVED, action: null, sticky: false, key: 'settings', ms: 1500 });
  const failed = (/** @type {unknown} */ e) =>
    toast({ kind: 'error', text: messageFor(e, 'settings'), action: null, sticky: false, key: 'settings' });

  // ── Weekday cells and category settings (CD-4 §10.2) ────────────────────────────────────────────

  /**
   * One edited field: validate for the inline error, then write through the settings service.
   * @param {HTMLInputElement} input
   */
  async function onFieldChange(input) {
    const fieldId = /** @type {string} */ (input.dataset.field);
    const text = input.value;
    const local = validateField(settingsFieldSpec(fieldId, category), text);
    if (!local.ok) {
      errors = { ...errors, [fieldId]: local.issue.message };
      render();
      return;
    }
    const [scope, code, key, setting] = fieldId.split('.');
    try {
      /** @type {ValidationResult} */
      const res = scope === 'weekday'
        ? await service.updateWeekday(/** @type {any} */ (code), key === 'baseline' ? { baseline: text } : { values: { [key]: text } })
        : await service.updateCategorySettings({ [setting]: text });
      const { [fieldId]: _, ...rest } = errors;
      errors = res.ok ? rest : { ...rest, ...Object.fromEntries(res.issues.map((i) => [i.field, i.message])) };
      if (res.ok) {
        saved();
        fill(fieldId);
      }
    } catch (e) {
      failed(e);
      fill(fieldId);
    }
    render();
  }

  // ── Tag dialog (CD-4 §10.1–§10.2) ─────────────────────────────────────────────────────────────────

  /** @param {string} role */
  const dlgInput = (role) => /** @type {HTMLInputElement} */ (tagDialog?.querySelector(`[data-field="tag.${role}"]`));

  function paintTagDialog() {
    if (!tagDialog || !lastVm) return;
    const code = dialogState.code;
    const index = code === null ? -1 : lastVm.tags.findIndex((t) => t.code === code);
    paint(tagDialog, tagDialogViewModel({ tag: index < 0 ? null : lastVm.tags[index], errors: dialogState.errors }));
  }

  /** @param {string|null} code   null = a new tag */
  function openTagDialog(code) {
    if (!tagDialog) return;
    const tag = code === null ? null : service.getTag(code);
    dialogState = { code: tag ? tag.code : null, errors: {} };
    const codeInput = dlgInput('code');
    codeInput.value = tag?.code ?? '';
    codeInput.disabled = tag !== null;                                 // codes are immutable (CC-13)
    dlgInput('label').value = tag?.label ?? '';
    for (const radio of /** @type {NodeListOf<HTMLInputElement>} */ (tagDialog.querySelectorAll('input[name="tag-kind"]'))) {
      radio.checked = radio.value === tag?.kind;
    }
    dlgInput('retired').checked = tag?.retired ?? false;
    paintTagDialog();
    tagDialog.showModal();
    (tag ? dlgInput('label') : codeInput).focus();
  }

  async function saveTag() {
    if (!tagDialog) return;
    const kind = /** @type {HTMLInputElement|null} */ (tagDialog.querySelector('input[name="tag-kind"]:checked'))?.value ?? '';
    const label = dlgInput('label').value;
    const code = dialogState.code;
    try {
      const res = code === null
        ? await service.addTag({ code: dlgInput('code').value, label, kind: /** @type {any} */ (kind) })
        : await service.updateTag(code, { label, kind: /** @type {any} */ (kind), retired: dlgInput('retired').checked });
      if (res.ok) {
        tagDialog.close('saved');
        saved();
      } else {
        // Issues are tag.<code>.<prop>; the dialog's slots are tag.<prop>.
        dialogState.errors = Object.fromEntries(res.issues.map((i) => [`tag.${i.field.split('.').pop()}`, i.message]));
      }
    } catch (e) {
      failed(e);
    }
    render();
    paintTagDialog();
  }

  /** @param {-1|1} step */
  async function moveTag(step) {
    const code = dialogState.code;
    if (!lastVm || code === null) return;
    const codes = lastVm.tags.map((t) => t.code);
    const i = codes.indexOf(code);
    const j = i + step;
    if (i < 0 || j < 0 || j >= codes.length || lastVm.tags[j].retired) return;
    [codes[i], codes[j]] = [codes[j], codes[i]];
    try {
      await service.reorderTags(codes);
    } catch (e) {
      failed(e);
    }
    render();
  }

  async function restoreDefaults() {
    if (!confirmDlg || !lastVm) return;
    const ok = await confirmDialog(confirmDlg, { ...lastVm.restore, danger: true });
    if (!ok) return;
    try {
      await service.restoreDefaults();
      errors = {};
      fill();
      toast({ kind: 'success', text: NOTICES.DEFAULTS_RESTORED, action: null, sticky: false, key: 'settings', ms: 1500 });
    } catch (e) {
      failed(e);
    }
    render();
  }

  /** @type {Object<string, (target: HTMLElement) => void>} */
  const actions = {
    'tag.add': () => openTagDialog(null),
    'tag.edit': (target) => openTagDialog(target.dataset.code ?? null),
    'tag.save': () => void saveTag(),
    'tag.cancel': () => tagDialog?.close('cancel'),
    'tag.up': () => void moveTag(-1),
    'tag.down': () => void moveTag(1),
    'defaults.restore': () => void restoreDefaults(),
  };

  /** @param {Event} event */
  function onClick(event) {
    const target = /** @type {HTMLElement|null} */ (/** @type {Element} */ (event.target).closest('[data-action]'));
    const run = target && actions[target.dataset.action ?? ''];
    if (run) run(/** @type {HTMLElement} */ (target));
  }

  /** Builds the weekday table and the settings fields once, from descriptors (CD-4 §10.1). */
  function build() {
    if (!root) return;
    const head = /** @type {HTMLElement} */ (root.querySelector('.weekday-table thead'));
    const body = /** @type {HTMLElement} */ (root.querySelector('.weekday-table tbody'));
    const columns = [BASELINE_DESC, ...category.weekdayFields];
    head.replaceChildren(el('tr', {},
      el('th', { attrs: { scope: 'col' }, text: 'Day' }),
      ...weekdayColumns(category).map((c) => el('th', { attrs: { scope: 'col' }, text: c.label }))));
    body.replaceChildren(...WEEKDAYS.map((code) => el('tr', {},
      el('th', { attrs: { scope: 'row', 'aria-label': weekdayName(code) }, text: code }),
      ...columns.map((c) => el('td', {}, renderField({ ...c, unit: undefined, help: undefined }, `weekday.${code}.${c.key}`,
        { precise: c === BASELINE_DESC, hideLabel: true, label: `${weekdayName(code)} ${c.label}` }))))));
    const settings = /** @type {HTMLElement} */ (root.querySelector('.settings-list'));
    settings.replaceChildren(...category.settingsFields.map((f) =>
      renderField(f, `settings.category.${id}.${f.key}`, { precise: f.type === 'decimal' })));
  }

  return {
    /** @param {HTMLElement} section */
    init(section) {
      root = section;
      const doc = section.ownerDocument;
      tagDialog = /** @type {HTMLDialogElement|null} */ (doc.getElementById('dlg-tag'));
      confirmDlg = /** @type {HTMLDialogElement|null} */ (doc.getElementById('dlg-confirm'));
      build();
      section.addEventListener('change', (event) => {
        const input = /** @type {HTMLElement} */ (event.target);
        if (input.matches('input[data-field]')) void onFieldChange(/** @type {HTMLInputElement} */ (input));
      });
      section.addEventListener('focusin', (event) => {
        const input = /** @type {HTMLElement} */ (event.target);
        if (input.matches('[data-precise]')) preciseFocus(/** @type {HTMLInputElement} */ (input));
      });
      section.addEventListener('focusout', (event) => {
        const input = /** @type {HTMLElement} */ (event.target);
        if (input.matches('[data-precise]')) preciseBlur(/** @type {HTMLInputElement} */ (input));
      });
      section.addEventListener('keydown', (event) => {
        const input = /** @type {HTMLElement} */ (event.target);
        if (event.key === 'Enter' && input.matches('input[type=text]')) input.blur();   // dismiss the iOS keyboard
      });
      section.addEventListener('click', onClick);
      tagDialog?.addEventListener('click', onClick);
      bus.on(EVENTS.BOOT_REPORT, (report) => {
        bootReport = report;
        if (visible) render();
      });
      bus.on(EVENTS.DATA_CHANGED, ({ scope }) => {
        if (visible && scope !== 'records') render();
      });
    },
    show() {
      visible = true;
      fill();
      render();
      // The only async work in show(): paints when it resolves (CD-4 §5.5, NFR-REL-02).
      void deps.storagePersist.persisted().then((result) => {
        storage = result;
        if (visible) render();
      });
    },
    async hide() {
      visible = false;
      errors = {};
    },
  };
}
