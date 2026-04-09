/**
 * SEGAPE-FIX.JS — Corrige PDF não persistindo ao trocar de projeto
 *
 * Bug: selectProj() chamava switchTab('rev') ANTES de loadPDFFromUrl().
 * Como switchTab verifica PDF.doc para decidir entre viewer e dropzone,
 * e PDF.doc era null nesse momento (zerado no início de selectProj),
 * a dropzone aparecia mesmo quando havia PDF salvo na versão.
 *
 * Correção: reordena selectProj para carregar o PDF *antes* de switchTab,
 * e adiciona um guard no switchTab para não cegar o viewer se PDF.doc
 * já estiver preenchido por uma chamada assíncrona.
 *
 * Dados: nenhuma tabela Supabase é tocada. Zero risco para tasks/projetos.
 */
(function() {
  'use strict';

  function applyFixes() {

    /* ── PATCH 1: selectProj ── */
    selectProj = async function(id) {
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

      /*
       * CORREÇÃO PRINCIPAL: carrega PDF *antes* de switchTab.
       * Quando switchTab('rev') rodar, PDF.doc já estará preenchido,
       * então o viewer é exibido em vez da dropzone.
       */
      const curVer = G.versions.find(v => v.id === G.ver);
      if (curVer && curVer.pdf_url) {
        await loadPDFFromUrl(curVer.pdf_url);
      }

      hideLd();
      sS();
      switchTab('rev');

      /* Garante dropzone se não há PDF salvo nesta versão */
      if (!curVer || !curVer.pdf_url) {
        showDZ();
      }
    };

    /* ── PATCH 2: guard no switchTab para aba 'rev' ── */
    const _prev = switchTab;
    switchTab = function(tab) {
      /*
       * Antes de deixar o switchTab original rodar, guardamos se já havia
       * PDF carregado. Se sim, após o switchTab restauramos o viewer.
       * Isso cobre o caso do bootApp que carrega o PDF e depois chama
       * switchTab com o tab salvo.
       */
      const pdfJaCarregado = (tab === 'rev') && !!PDF.doc;

      _prev(tab);

      if (pdfJaCarregado && PDF.doc) {
        document.getElementById('pdf-vp').style.display = 'flex';
        document.getElementById('dz').style.display     = 'none';
        document.getElementById('pdf-bar').style.display = 'flex';
      }
    };

    console.info('[SEGAPE-FIX] ✅ Patches aplicados: selectProj + switchTab guard');
  }

  /*
   * Aplica os patches após o documento carregar completamente,
   * garantindo que as funções originais já foram declaradas.
   */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyFixes);
  } else {
    applyFixes();
  }
})();
