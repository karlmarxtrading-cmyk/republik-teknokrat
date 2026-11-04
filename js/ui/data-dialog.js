// ui/data-dialog.js
// ------------------------------------------------------------
// "Data lokal" — explains where learning data lives and offers:
//   - a human-readable JSON backup (download),
//   - restore from a backup, VALIDATED and previewed before anything
//     is overwritten, with explicit confirmation,
//   - deletion of every FILSAFAT - 1 key (and only those), confirmed.
// Also exposes the content diagnostics for authors.
// ------------------------------------------------------------

import { h, announce } from './dom.js';
import { downloadText } from './download.js';
import { confirmDialog } from './confirm-dialog.js';
import { exportBackup, validateBackup, applyBackup, clearAllPackageState, getStorageStatus, MAX_BACKUP_BYTES } from '../progress-store.js';
import { flushPendingSaves } from './focus-view.js';

export function createDataDialog({ practices, manifest, diagnostics, onChanged }) {
  const status = h('p', { class: 'storage-status' });
  const importInput = h('input', { type: 'file', accept: 'application/json,.json', id: 'backupFile', class: 'file-input' });
  const importMsg = h('p', { class: 'import-msg', role: 'status' });
  const diag = h('details', { class: 'diagnostics' },
    h('summary', {}, 'Diagnostik konten (untuk penulis materi)'),
    h('ul', {}, Object.entries(diagnostics).filter(([k]) => k !== 'messages').map(([k, v]) => h('li', {}, h('code', { text: k }), `: ${v}`))),
    diagnostics.messages?.length ? h('ul', { class: 'diag-messages' }, diagnostics.messages.map((m) => h('li', { text: m }))) : h('p', { class: 'muted', text: 'Tidak ada peringatan konten.' }));

  const dialog = h('dialog', { class: 'app-dialog data-dialog', 'aria-labelledby': 'dataDialogTitle' },
    h('div', { class: 'dialog-head' },
      h('h2', { id: 'dataDialogTitle', class: 'dialog-title', text: 'Data lokal di perangkat ini' }),
      h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => dialog.close() }, 'Tutup')),
    h('p', { text: 'Respons, revisi, catatan, penanda, dan jejak belajar Anda disimpan hanya di browser ini (localStorage). Tidak ada akun, server, atau sinkronisasi antarperangkat. Data dapat hilang bila data situs/browser dihapus.' }),
    status,
    h('h3', { class: 'subsection-title', text: 'Cadangan' }),
    h('div', { class: 'dialog-actions dialog-actions-start' },
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => {
        flushPendingSaves();
        const data = exportBackup(practices, manifest);
        downloadText(`filsafat-1-cadangan-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2) + '\n', 'application/json;charset=utf-8');
        const oversized = new TextEncoder().encode(JSON.stringify(data, null, 2) + '\n').byteLength > MAX_BACKUP_BYTES;
        announce(oversized ? 'Cadangan diunduh, tetapi melebihi batas impor 50 MiB. Simpan berkas ini dan unduh catatan per unit juga.' : `Cadangan berisi ${Object.keys(data.units).length} unit diunduh.`);
      } }, 'Unduh cadangan (.json)')),
    h('label', { for: 'backupFile', class: 'response-label', text: 'Pulihkan dari berkas cadangan' }),
    h('p', { class: 'response-hint', text: 'Berkas diperiksa terlebih dahulu. Anda akan melihat ringkasannya dan diminta konfirmasi sebelum data di perangkat ini ditimpa.' }),
    importInput, importMsg,
    h('h3', { class: 'subsection-title', text: 'Hapus data' }),
    h('div', { class: 'dialog-actions dialog-actions-start' },
      h('button', { type: 'button', class: 'btn btn-danger-ghost', onclick: async () => {
        const ok = await confirmDialog({
          title: 'Hapus semua data FILSAFAT - 1?',
          message: 'Ini menghapus dari browser perangkat ini, untuk semua unit paket ini:',
          details: ['respons, revisi, dan riwayatnya', 'catatan pribadi dan penanda bagian', 'jejak belajar dan penilaian diri', 'preferensi tampilan paket (tema tidak terpengaruh)'],
          confirmLabel: 'Hapus semua data paket', danger: true,
        });
        if (!ok) return;
        flushPendingSaves();
        const deleted = clearAllPackageState();
        announce(deleted.durable ? 'Semua data FILSAFAT - 1 di perangkat ini telah dihapus.' : 'Sebagian data belum dapat dihapus dari perangkat. Penyimpanan ditolak browser.');
        dialog.close();
        onChanged();
      } }, 'Hapus semua data paket ini…')),
    diag);

  importInput.addEventListener('change', async () => {
    const file = importInput.files && importInput.files[0];
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) { importMsg.textContent = 'Berkas melebihi batas impor 50 MiB. Data perangkat belum diubah.'; importInput.value = ''; return; }
    const text = await file.text();
    const result = validateBackup(text, practices);
    importInput.value = '';
    if (!result.ok) { importMsg.textContent = 'Tidak dipulihkan: ' + result.error; return; }
    const count = Object.keys(result.units).length;
    if (!count) { importMsg.textContent = 'Cadangan valid, tetapi tidak berisi data untuk unit di paket ini.'; return; }
    const ok = await confirmDialog({
      title: 'Pulihkan cadangan?',
      message: `Cadangan berisi data untuk ${count} unit. Data unit tersebut di perangkat ini akan diganti dengan isi cadangan.`,
      details: result.unknown.length ? [`${result.unknown.length} entri untuk unit yang tidak ada di paket ini akan diabaikan.`] : [],
      confirmLabel: 'Pulihkan',
    });
    if (!ok) { importMsg.textContent = 'Pemulihan dibatalkan. Tidak ada data yang berubah.'; return; }
    flushPendingSaves();
    const restored = applyBackup(result);
    importMsg.textContent = restored.durable
      ? `Cadangan dipulihkan dan tersimpan di perangkat untuk ${count} unit.`
      : restored.status === 'rolled-back'
        ? 'Pemulihan gagal. Perubahan dibatalkan dan data sebelumnya telah dipulihkan di perangkat.'
        : 'Pemulihan gagal; pengembalian ke data lama juga belum tersimpan seluruhnya. Data lama tersedia di tab ini. Unduh cadangan sebelum menutup tab.';
    paintStatus();
    onChanged();
  });

  function paintStatus() {
    const s = getStorageStatus().status;
    status.dataset.tone = s === 'ok' ? 'ok' : 'warn';
    status.textContent = s === 'ok' ? 'Status penyimpanan: aktif — perubahan tersimpan otomatis.' : s === 'error' ? 'Status penyimpanan: penuh atau ditolak browser — unduh cadangan sekarang.' : 'Status penyimpanan: tidak tersedia (misalnya mode privat) — perubahan hanya bertahan sampai tab ditutup.';
  }

  window.addEventListener('filsafat:storage-status', paintStatus);
  document.body.appendChild(dialog);
  return {
    open() { flushPendingSaves(); paintStatus(); importMsg.textContent = ''; if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); },
    element: dialog,
  };
}
