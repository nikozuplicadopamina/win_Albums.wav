(() => {
  'use strict';

  /* ---------- Configuración ---------- */
  const PAGE_SIZE = 9;

  /* ---------- Referencias al DOM ---------- */
  const content = document.getElementById('albums');
  const loading = document.getElementById('loading');
  const pagerEl = document.getElementById('pager');
  const address = document.getElementById('address');
  const statusCount = document.getElementById('status-count');
  const statusPage = document.getElementById('status-page');
  const statusMsg = document.getElementById('status-msg');

  /* ---------- Utilidades ---------- */
  const escapeHTML = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

  /* ---------- Estado ---------- */
  let albums = [];
  let currentPage = 1;

  const totalPages = () => Math.max(1, Math.ceil(albums.length / PAGE_SIZE));
  const pageRange = (p) => [(p - 1) * PAGE_SIZE, Math.min(p * PAGE_SIZE, albums.length)];

  /* ---------- Carga (fetch de albums.json) ---------- */
  async function load() {
    try {
      const res = await fetch('albums.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('albums.json está vacío o el formato no es válido.');
      }
      albums = data;
      render();
    } catch (err) {
      renderError(err);
    }
  }

  /* ---------- Render de página + pager ---------- */
  function render() {
    if (loading) loading.remove();

    const [start, end] = pageRange(currentPage);
    const slice = albums.slice(start, end);

    content.querySelectorAll('.grid').forEach((el) => el.remove());
    const grid = document.createElement('div');
    grid.className = 'grid';
    slice.forEach((a) => grid.appendChild(createAlbumCard(a)));
    content.appendChild(grid);

    renderPager();

    address.textContent = 'C:\\ALBUMS';
    statusCount.textContent = albums.length + ' objeto(s) cargado(s)';
    statusPage.textContent = 'página ' + currentPage + ' de ' + totalPages();
    statusMsg.textContent = 'listo.';
  }

  /* ---------- Pager estilo Google ---------- */
  function renderPager() {
    pagerEl.innerHTML = '';
    const page = currentPage;
    const total = totalPages();

    const addBtn = (label, target, opts) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'page-btn search';
      btn.textContent = label;
      if (opts && opts.title) btn.title = opts.title;
      btn.disabled = !!(opts && opts.disabled);
      if (opts && opts.current) btn.setAttribute('aria-current', 'page');
      btn.addEventListener('click', () => {
        if (!btn.disabled && target >= 1 && target <= total) {
          currentPage = target;
          render();
          pagerEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
      pagerEl.appendChild(btn);
    };

    addBtn('‹ Anterior', page - 1, { disabled: page === 1, title: 'Página anterior' });

    /* --- números de página con elipsis, como Google --- */
    const delta = 1;
    let last = null;
    for (let p = 1; p <= total; p++) {
      const show = p === 1 || p === total || Math.abs(p - page) <= delta;
      if (!show) {
        if (last !== '…') {
          const sep = document.createElement('span');
          sep.className = 'page-sep';
          sep.textContent = '…';
          pagerEl.appendChild(sep);
          last = '…';
        }
        continue;
      }
      addBtn(String(p), p, { current: p === page });
      last = p;
    }

    addBtn('Siguiente ›', page + 1, { disabled: page === total, title: 'Página siguiente' });

    const [start, end] = pageRange(page);
    const info = document.createElement('div');
    info.className = 'page-info';
    info.textContent = 'Mostrando álbumes ' + (start + 1) + '–' + end +
      ' de ' + albums.length;
    pagerEl.appendChild(info);
  }

  /* ---------- Tarjeta de álbum ---------- */
  function createAlbumCard(album) {
    const card = document.createElement('article');
    card.className = 'album';

    const title = escapeHTML(album.titulo || 'Sin título');
    const artist = escapeHTML(album.artista || '—');
    const meta = [album.genero, album.anio].filter(Boolean).map(escapeHTML).join(' · ');
    const review = escapeHTML(album.review || '');
    const cover = escapeHTML(album.portada || '');
    const color = String(album.color || '#7f5bd6').trim();
    const link = album.link || '';

    card.innerHTML =
      '<div class="album-top">' +
      '  <div class="cover"><img src="' + cover + '" alt="Portada de ' + title + '" loading="lazy" /></div>' +
      '  <div class="album-info">' +
      '    <div class="album-title" style="color:' + color + '">' + title + '</div>' +
      '    <div class="album-artist">' + artist + '</div>' +
      '    <div class="album-meta">' + meta + '</div>' +
      '  </div>' +
      '</div>' +
      (review ? '<p class="album-review">' + review + '</p>' : '') +
      '<div class="album-footer">' +
      '  <button type="button" class="btn">' + (link ? 'Abrir en el sitio' : 'Sin enlace') + '</button>' +
      '</div>';

    const coverImg = card.querySelector('.cover img');
    coverImg.addEventListener('error', function onError() {
      if (coverImg.dataset.fallback) return;
      coverImg.dataset.fallback = '1';
      coverImg.remove();
      card.querySelector('.cover').textContent = 'SIN PORTADA';
    });

    if (link) {
      card.querySelector('.btn').addEventListener('click', () => {
        window.open(link, '_blank', 'noopener');
      });
    } else {
      card.querySelector('.btn').disabled = true;
    }

    return card;
  }

  /* ---------- Error / message box ---------- */
  function renderError(err) {
    if (loading) loading.remove();
    pagerEl.innerHTML = '';
    address.textContent = 'C:\\';
    statusCount.textContent = '0 objeto(s)';
    statusPage.textContent = 'página 0 de 0';
    statusMsg.textContent = 'error.';

    const box = document.createElement('section');
    box.className = 'msgbox';
    box.setAttribute('role', 'alert');
    box.innerHTML =
      '<div class="title-bar">' +
      '  <svg class="title-bar-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">' +
      '    <path d="M1 3h5l2 2h7v8H1z" fill="#b0893a" stroke="#000" stroke-width="1" /></svg>' +
      '  <span class="title-bar-text">Album Explorer</span>' +
      '  <div class="title-bar-controls">' +
      '    <button type="button" aria-label="Cerrar">' +
      '      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">' +
      '        <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="#d6d6da" stroke-width="1.4" /></svg>' +
      '    </button>' +
      '  </div>' +
      '</div>' +
      '<div class="msgbox-body">' +
      '  <div class="row">' +
      '    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">' +
      '      <rect x="2" y="2" width="28" height="28" fill="#e0c000" stroke="#000" stroke-width="1" />' +
      '      <rect x="14.2" y="7" width="3.6" height="11" fill="#000" />' +
      '      <rect x="14.2" y="20" width="3.6" height="3.6" fill="#000" />' +
      '    </svg>' +
      '    <div>' +
      '      <p><strong>No se pudo leer albums.json.</strong></p>' +
      '      <pre>' + escapeHTML(String(err.message)) + '</pre>' +
      '      <p style="margin-top:6px">El archivo debe servirse vía HTTP (GitHub Pages). ' +
      '        Abierto desde file:// no funcionará por la política CORS del navegador.</p>' +
      '    </div>' +
      '  </div>' +
      '</div>' +
      '<div class="msgbox-footer"><button type="button" class="btn">Aceptar</button></div>';

    content.appendChild(box);
  }

  /* ---------- Bootstrap ---------- */
  load();
})();