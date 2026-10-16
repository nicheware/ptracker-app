// @ts-check
// Widgets shared by pages: score picker, tag chip and the confirmation dialog (CD-4 §6.5). Text only via textContent.

import { el } from './dom.js';

// TODO(IT-09): typeToConfirmDialog (FR-HIS-06).

/**
 * A 0–10 score group as 11 real radios plus Clear in a 6 × 2 grid (CD-4 §6.5, D4-03). The radios carry
 * data-field, so the page's delegated `change` listener receives taps; Clear is a data-action button.
 * @param {import('../core/types.js').FieldId} fieldId   'scores.morning'
 * @param {string} label                                 'Morning'
 * @returns {HTMLElement}
 */
export function scorePicker(fieldId, label) {
  const segs = [];
  for (let v = 0; v <= 10; v++) {
    segs.push(el('label', { class: 'seg' },
      el('input', { class: 'seg-input', attrs: { type: 'radio', name: fieldId, value: String(v) }, dataset: { field: fieldId } }),
      el('span', { class: 'seg-text', text: String(v) })));
  }
  segs.push(el('button', { class: 'seg seg-clear', text: 'Clear',
    attrs: { type: 'button', 'aria-label': `Clear ${label.toLowerCase()} score` },
    dataset: { action: 'score.clear', target: fieldId } }));
  return el('fieldset', { class: 'score', attrs: { role: 'radiogroup' }, dataset: { field: fieldId } },
    el('legend', { class: 'score-legend' }, label, el('span', { class: 'sr-only', text: ' pain score' })),
    el('div', { class: 'seg-grid' }, ...segs),
    el('span', { class: 'field-error', dataset: { error: fieldId }, attrs: { role: 'alert' }, hidden: true }));
}

/**
 * A tag chip (CD-4 §6.5): code, kind glyph and an accessible name with the label and kind. `pressedPath` is the
 * view-model path painted into aria-pressed (CC-32 rev 1 data-attr).
 * @param {{ code: string, label: string, kind: string, kindLabel: string, glyph: string, retired: boolean }} tag
 *        a chip entry of the entry view-model
 * @param {string} pressedPath   e.g. 'chips.P.ariaPressed'
 * @returns {HTMLElement}
 */
export function tagChip(tag, pressedPath) {
  const name = `${tag.code}, ${tag.label}, ${tag.kindLabel}${tag.retired ? ', retired' : ''}`;
  return el('button', {
    class: `chip kind-${tag.kind}${tag.retired ? ' is-retired' : ''}`,
    attrs: { type: 'button', 'aria-label': name, 'aria-pressed': 'false' },
    dataset: { action: 'tag.toggle', code: tag.code, attr: `${pressedPath}:aria-pressed` },
  },
  el('span', { class: 'chip-code', text: tag.code }),
  el('span', { class: 'tag-glyph', attrs: { 'aria-hidden': 'true' }, text: tag.glyph }),
  tag.retired ? el('span', { class: 'chip-retired', attrs: { 'aria-hidden': 'true' }, text: 'retired' }) : null);
}

/**
 * Fills #dlg-confirm and shows it modally (CD-4 §6.5). Resolves true on Confirm; false on Cancel or Escape.
 * The dialog holds [data-role=title], [data-role=body], [data-role=cancel] and [data-role=confirm].
 * @param {HTMLDialogElement} dialog
 * @param {{ title: string, body: string, confirmLabel: string, danger?: boolean }} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog(dialog, { title, body, confirmLabel, danger = false }) {
  const part = (/** @type {string} */ role) => /** @type {HTMLElement} */ (dialog.querySelector(`[data-role="${role}"]`));
  part('title').textContent = title;
  part('body').textContent = body;
  const confirm = part('confirm');
  const cancel = part('cancel');
  confirm.textContent = confirmLabel;
  confirm.classList.toggle('danger', danger);

  return new Promise((resolve) => {
    const onConfirm = () => dialog.close('confirm');
    const onCancel = () => dialog.close('cancel');
    const onClose = () => {
      confirm.removeEventListener('click', onConfirm);
      cancel.removeEventListener('click', onCancel);
      resolve(dialog.returnValue === 'confirm');
    };
    confirm.addEventListener('click', onConfirm);
    cancel.addEventListener('click', onCancel);
    dialog.addEventListener('close', onClose, { once: true });
    dialog.returnValue = '';
    dialog.showModal();
    cancel.focus();
  });
}
