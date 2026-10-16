// @ts-check
// Widgets shared by pages: the confirmation dialog so far (CD-4 §6.5). Text is set only through textContent.

// TODO(IT-07): scorePicker and tagChip (CD-4 §6.5). TODO(IT-09): typeToConfirmDialog (FR-HIS-06).

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
