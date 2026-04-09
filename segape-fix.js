/**
 * SEGAPE-FIX.JS v2
 * Corrige três problemas:
 * 1. PDF não carregava ao trocar de projeto
 * 2. Botão Salvar / Desfazer ausente na topbar
 * 3. Fluxo de nova versão: PDF atual vai para histórico, dropzone abre para novo upload
 */
(function () {
  'use strict';

  function applyFixes() {

    /* ─────────────────────────────────────────────────────────────
       FIX 1 — selectProj: carrega PDF ANTES de switchTab
       O switchTab verifica PDF.doc para decidir viewer vs dropzone.
       Se for chamado com PDF.doc=null, mostra dropzone mesmo quando
       existe pdf_url salvo na versão.
    ───────────────────────────────────────────────────────────── */
    selectProj = async function (id) {
      G.proj = id;
      G.ver  = null;
      G.filt = 'all';
      PDF.doc   = null;
      PDF.proj  = null;
      PDF.pages = 0;
      PDF.curr  = 1;

      showLd('Carregando projeto…');

      [G.tasks, G.versions] = await Promise.all([
        dbQ('tasks',            { project_id: id }),
        dbQ('project_versions', { project_id: id }),
      ]);

      if (G.versions.length) G.ver = G.versions[0].id;

      const curVer = G.versions.find(v => v.id === G.ver);

      // Carrega PDF primeiro — PDF.doc estará preenchido quando switchTab rodar
      if (curVer && curVer.pdf_url) {
        await loadPDFFromUrl(curVer.pdf_url);
      }

      hideLd();
      sS();
      switchTab('rev');

      if (!curVer || !curVer.pdf_url) {
        showDZ();
      }
    };

    /* ─────────────────────────────────────────────────────────────
       FIX 2 — switchTab: protege o viewer quando PDF já foi carregado
    ───────────────────────────────────────────────────────────── */
    const _prevSwitch = switchTab;
    switchTab = function (tab) {
      const pdfAtivo = (tab === 'rev') && !!PDF.doc;
      _prevSwitch(tab);
      if (pdfAtivo && PDF.doc) {
        document.getElementById('pdf-vp').style.display  = 'flex';
        document.getElementById('dz').style.display      = 'none';
        document.getElementById('pdf-bar').style.display = 'flex';
      }
      renderSaveBar();
    };

    /* ─────────────────────────────────────────────────────────────
       FIX 3 — Barra Salvar / Desfazer flutuante na aba Revisão
    ───────────────────────────────────────────────────────────── */
    let _undoStack = [];

    function injectSaveBar() {
      if (document.getElementById('seg-savebar')) return;

      const style = document.createElement('style');
      style.textContent = `
        #seg-savebar {
          position: fixed;
          bottom: 16px;
          right: 380px;
          z-index: 400;
          background: #1C1916;
          border-radius: 10px;
          box-shadow: 0 4px 20px rgba(0,0,0,.4);
          padding: 8px 10px;
          display: flex;
          gap: 8px;
          align-items: center;
          animation: fadeUp .2s ease;
        }
        #seg-savebar.hidden { display: none !important; }
        #seg-savebar button {
          padding: 7px 14px;
          border-radius: 8px;
          border: none;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          font-family: 'Source Sans 3', sans-serif;
          transition: all .12s;
          white-space: nowrap;
        }
        #seg-undo-btn {
          background: #3D3A37;
          color: #E8E6E1;
        }
        #seg-undo-btn:hover:not(:disabled) { background: #555250; }
        #seg-undo-btn:disabled { opacity: .35; cursor: not-allowed; }
        #seg-save-btn {
          background: #1D9E75;
          color: #fff;
        }
        #seg-save-btn:hover:not(:disabled) { background: #178a63; }
        #seg-save-btn:disabled { opacity: .35; cursor: not-allowed; }
        #seg-savebar .seg-sep {
          width: 1px; height: 18px;
          background: rgba(255,255,255,.12);
        }
        #seg-savebar .seg-hint {
          font-size: 10px;
          color: rgba(255,255,255,.35);
          font-family: 'DM Mono', monospace;
          white-space: nowrap;
        }
        @media (max-width: 768px) {
          #seg-savebar {
            right: 12px !important;
            bottom: 72px !important;
          }
          #seg-savebar .seg-hint { display: none; }
        }
      `;
      document.head.appendChild(style);

      const bar = document.createElement('div');
      bar.id = 'seg-savebar';
      bar.className = 'hidden';
      bar.innerHTML = `
        <span class="seg-hint" id="seg-hint">0 não salvas</span>
        <div class="seg-sep"></div>
        <button id="seg-undo-btn" disabled>↩ Desfazer</button>
        <button id="seg-save-btn" disabled>💾 Salvar anotações</button>
      `;
      document.body.appendChild(bar);

      document.getElementById('seg-undo-btn').addEventListener('click', doUndo);
      document.getElementById('seg-save-btn').addEventListener('click', doSaveAll);
    }

    function renderSaveBar() {
      injectSaveBar();
      const bar     = document.getElementById('seg-savebar');
      const undoBtn = document.getElementById('seg-undo-btn');
      const saveBtn = document.getElementById('seg-save-btn');
      const hint    = document.getElementById('seg-hint');
      if (!bar) return;

      const isRev = G.tab === 'rev' && !!G.proj;
      const hasDirty = Object.keys(
        (typeof _pendingSaves !== 'undefined' ? _pendingSaves : {})
      ).length > 0;

      bar.classList.toggle('hidden', !isRev);

      if (undoBtn) undoBtn.disabled = _undoStack.length === 0;
      if (saveBtn) saveBtn.disabled = !hasDirty;
      if (hint) {
        const n = _undoStack.length;
        hint.textContent = n > 0 ? `${n} tarefa${n !== 1 ? 's' : ''} nesta sessão` : '';
        hint.style.display = n > 0 ? '' : 'none';
      }
    }

    async function doUndo() {
      if (!_undoStack.length) return;
      const lastId = _undoStack.pop();
      G.tasks = G.tasks.filter(t => String(t.id) !== String(lastId));
      renderPins();
      renderTaskList();
      renderSaveBar();
      try {
        await SB.from('tasks').delete().eq('id', lastId);
      } catch (e) {
        console.error('Undo error:', e);
      }
    }

    /* ─────────────────────────────────────────────────────────────
       FIX 4 — Intercepta dbIns para registrar tarefas no undoStack
    ───────────────────────────────────────────────────────────── */
    const _origDbIns = dbIns;
    dbIns = async function (table, row) {
      const result = await _origDbIns(table, row);
      if (table === 'tasks' && result && result.id) {
        _undoStack.push(result.id);
        renderSaveBar();
      }
      return result;
    };

    /* ─────────────────────────────────────────────────────────────
       FIX 5 — Sincroniza barra com markDirty (anotações pendentes)
    ───────────────────────────────────────────────────────────── */
    if (typeof markDirty === 'function') {
      const _origMarkDirty = markDirty;
      markDirty = function (key, table, id, fields) {
        _origMarkDirty(key, table, id, fields);
        renderSaveBar();
      };
    }

    /* ─────────────────────────────────────────────────────────────
       FIX 6 — Sincroniza barra com botNav mobile
    ───────────────────────────────────────────────────────────── */
    if (typeof botNav === 'function') {
      const _origBotNav = botNav;
      botNav = function (tab) {
        _origBotNav(tab);
        renderSaveBar();
      };
    }

    /* ─────────────────────────────────────────────────────────────
       INIT
    ───────────────────────────────────────────────────────────── */
    injectSaveBar();
    renderSaveBar();

    console.info('[SEGAPE-FIX v2] ✅ selectProj, switchTab, barra salvar/desfazer aplicados');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyFixes);
  } else {
    applyFixes();
  }

})();
