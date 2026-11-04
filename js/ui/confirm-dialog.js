// ui/confirm-dialog.js — accessible confirmation built on <dialog>.
// Never uses window.confirm (which blocks and cannot be styled or explained).
import { h } from './dom.js';

export function confirmDialog({ title, message, details = [], confirmLabel = 'Ya, lanjutkan', cancelLabel = 'Batal', danger = false }) {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const titleId = 'confirm-title-' + Date.now();
    const confirmBtn = h('button', { type: 'button', class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary') }, confirmLabel);
    const cancelBtn = h('button', { type: 'button', class: 'btn btn-secondary' }, cancelLabel);
    const dialog = h('dialog', { class: 'app-dialog confirm-dialog', 'aria-labelledby': titleId },
      h('h2', { id: titleId, class: 'dialog-title', text: title }),
      h('p', { text: message }),
      details.length ? h('ul', {}, details.map((d) => h('li', { text: d }))) : null,
      h('div', { class: 'dialog-actions' }, cancelBtn, confirmBtn));
    let result = false;
    const finish = () => {
      dialog.remove();
      if (opener && opener.isConnected) opener.focus();
      resolve(result);
    };
    if (typeof dialog.showModal !== 'function') {
      resolve(false);
      return;
    }
    confirmBtn.addEventListener('click', () => { result = true; dialog.close(); });
    cancelBtn.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', finish, { once: true });
    document.body.appendChild(dialog);
    dialog.showModal();
    cancelBtn.focus(); // safe default for destructive actions
  });
}
