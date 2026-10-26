(() => {
  'use strict';

  /* ---------- Referencias ---------- */
  const albumEl = document.getElementById('lyrics-album');
  const selectEl = document.getElementById('lyrics-song');
  const fetchBtn = document.getElementById('lyrics-fetch');
  const imageBtn = document.getElementById('lyrics-image');
  const statusEl = document.getElementById('lyrics-status');
  const sourceEl = document.getElementById('lyrics-source');
  const linesEl = document.getElementById('lyrics-lines');
  const quoteEl = document.getElementById('lyrics-quote');
  const countEl = document.getElementById('lyrics-count');
  const manualWrap = document.getElementById('lyrics-manual-wrap');
  const manualInput = document.getElementById('lyrics-manual');
  const manualUse = document.getElementById('lyrics-manual-use');
  const titleWrap = document.getElementById('lyrics-title-wrap');
  const titleInput = document.getElementById('lyrics-title');
  const canvas = document.getElementById('lyrics-canvas');

  if (!albumEl || !selectEl || !fetchBtn || !imageBtn || !canvas) return;

  /* ---------- Estado ---------- */
  let albums = [];
  let currentAlbum = null;
  let currentTrack = '';
  let currentQuote = '';
  let trackList = [];
  let reqToken = 0;

  /* Selección de líneas: rango contiguo [selStart, selEnd] */
  let lineasLetra = [];
  let botonesLetra = [];
  let selStart = -1;
  let selEnd = -1;
  const CERCANIA = 2; // cuántas líneas se pueden sumar de un toque

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function setCount(n) {
    if (countEl) countEl.textContent = n + ' línea(s)';
  }

  function setSource(text) {
    if (!sourceEl) return;
    sourceEl.hidden = !text;
    sourceEl.textContent = text || '';
  }

  function resetSalida() {
    currentQuote = '';
    lineasLetra = [];
    botonesLetra = [];
    selStart = -1;
    selEnd = -1;
    if (linesEl) {
      linesEl.innerHTML = '';
      linesEl.hidden = true;
    }
    if (quoteEl) quoteEl.hidden = true;
    imageBtn.disabled = true;
    setCount(0);
  }

  /* ---------- Utilidades de texto ---------- */
  function normalizar(texto) {
    return String(texto || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function sinSufijo(texto) {
    return normalizar(texto)
      .replace(/\s+(single|ep|deluxe|remaster(ed)?|bonus|edicion especial)$/g, '')
      .trim();
  }

  // Puntúa un álbum candidato contra el del catálogo local.
  function puntuar(candidato, album) {
    const tA = sinSufijo(album.titulo);
    const tB = sinSufijo(candidato.titulo);
    const aA = normalizar(album.artista);
    const aB = normalizar(candidato.artista);

    const tituloExacto = tA && tA === tB;
    const tituloParecido = tA && tB && (tA.includes(tB) || tB.includes(tA));
    const artistaExacto = aA && aA === aB;
    const artistaParecido = aA && aB && (aA.includes(aB) || aB.includes(aA));

    let score = 0;
    if (tituloExacto) score += 6;
    else if (tituloParecido) score += 3;
    if (artistaExacto) score += 4;
    else if (artistaParecido) score += 2;

    const aceptado =
      (tituloExacto && (artistaExacto || artistaParecido)) ||
      (tituloParecido && artistaExacto);

    return { score, aceptado };
  }

  function elegirCandidato(lista, album) {
    let mejor = null;
    let mejorScore = -1;
    lista.forEach((c) => {
      const p = puntuar(c, album);
      if (p.aceptado && p.score > mejorScore) {
        mejor = c;
        mejorScore = p.score;
      }
    });
    return mejor;
  }

  /* ---------- JSONP (Deezer no manda cabeceras CORS) ---------- */
  function jsonp(url, timeout) {
    return new Promise((resolve, reject) => {
      const cb = 'dz' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(() => {
        limpiar();
        reject(new Error('Tiempo agotado'));
      }, timeout || 9000);

      function limpiar() {
        clearTimeout(timer);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[cb] = (data) => {
        limpiar();
        resolve(data);
      };
      script.onerror = () => {
        limpiar();
        reject(new Error('No se pudo cargar la API'));
      };
      script.src = url + (url.indexOf('?') === -1 ? '?' : '&') +
        'output=jsonp&callback=' + cb;
      document.head.appendChild(script);
    });
  }

  /* ---------- Tracklist: iTunes (CORS) ---------- */
  async function cancionesItunes(album) {
    const term = encodeURIComponent(album.artista + ' ' + album.titulo);
    const url = 'https://itunes.apple.com/search?term=' + term +
      '&entity=album&limit=10&country=US';
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const candidatos = (data.results || []).map((x) => ({
      id: x.collectionId,
      titulo: x.collectionName,
      artista: x.artistName
    }));
    const mejor = elegirCandidato(candidatos, album);
    if (!mejor) return null;

    const lr = await fetch('https://itunes.apple.com/lookup?id=' + mejor.id +
      '&entity=song&limit=60&country=US');
    if (!lr.ok) return null;
    const lj = await lr.json();
    const pistas = (lj.results || [])
      .filter((x) => x.wrapperType === 'track' && x.trackName)
      .sort((a, b) => (a.discNumber - b.discNumber) || (a.trackNumber - b.trackNumber))
      .map((x) => String(x.trackName).trim())
      .filter(Boolean);

    if (!pistas.length) return null;
    return { fuente: 'iTunes', pistas };
  }

  /* ---------- Tracklist: Deezer (JSONP) ---------- */
  async function cancionesDeezer(album) {
    const q = encodeURIComponent(album.artista + ' ' + album.titulo);
    const data = await jsonp('https://api.deezer.com/search/album?q=' + q);
    const lista = (data && data.data) || [];
    const candidatos = lista.map((x) => ({
      id: x.id,
      titulo: x.title,
      artista: x.artist && x.artist.name
    }));
    const mejor = elegirCandidato(candidatos, album);
    if (!mejor) return null;

    const detalle = await jsonp('https://api.deezer.com/album/' + mejor.id);
    const pistas = ((detalle && detalle.tracks && detalle.tracks.data) || [])
      .map((t) => String(t.title || '').trim())
      .filter(Boolean);

    if (!pistas.length) return null;
    return { fuente: 'Deezer', pistas };
  }

  /* ---------- Pintar selects ---------- */
  function pintarCanciones(resultado) {
    selectEl.innerHTML = '';
    trackList = resultado.pistas;

    const vacio = document.createElement('option');
    vacio.value = '';
    vacio.textContent = '— elige una canción —';
    selectEl.appendChild(vacio);

    trackList.forEach((nombre, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = nombre;
      selectEl.appendChild(opt);
    });

    const otra = document.createElement('option');
    otra.value = '__otra';
    otra.textContent = '— otra canción… —';
    selectEl.appendChild(otra);

    selectEl.value = '';
    currentTrack = '';
    if (titleWrap) titleWrap.hidden = true;
    if (titleInput) titleInput.value = '';
    setSource(resultado.fuente + ' · ' + trackList.length + ' pista(s)');
  }

  async function cargarCanciones(album) {
    const token = ++reqToken;
    trackList = [];
    currentTrack = '';
    selectEl.innerHTML = '';
    selectEl.disabled = true;
    fetchBtn.disabled = true;
    if (titleWrap) titleWrap.hidden = true;
    setSource('');
    resetSalida();
    if (manualWrap) manualWrap.hidden = true;
    setStatus('Buscando canciones de ' + (album.titulo || 'el álbum') + '…');

    let resultado = null;
    try {
      resultado = await cancionesItunes(album);
    } catch (err) {
      resultado = null;
    }
    if (!resultado) {
      try {
        resultado = await cancionesDeezer(album);
      } catch (err) {
        resultado = null;
      }
    }

    if (token !== reqToken) return;
    selectEl.disabled = false;
    fetchBtn.disabled = false;

    if (resultado) {
      pintarCanciones(resultado);
      setStatus('Elige una canción y pulsa "Buscar letra".');
    } else {
      selectEl.innerHTML = '<option value="">(sin lista de canciones)</option>';
      if (titleWrap) titleWrap.hidden = false;
      if (titleInput) {
        titleInput.value = album.titulo || '';
        titleInput.focus();
      }
      setSource('Sin tracklist online');
      setStatus('No encontré la lista. Escribe el título de la canción.');
    }
  }

  /* ---------- Cargar álbumes del catálogo ---------- */
  async function loadAlbums() {
    try {
      const res = await fetch('albums.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('albums.json está vacío.');
      }
      albums = data;
      albums.forEach((album, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = (album.titulo || 'Sin título') + ' — ' + (album.artista || '—');
        albumEl.appendChild(opt);
      });
      currentAlbum = albums[0];
      albumEl.value = '0';
      await cargarCanciones(currentAlbum);
    } catch (err) {
      setStatus('No se pudo leer albums.json: ' + err.message);
    }
  }

  /* ---------- Letra online: cascada de proveedores ---------- */
  /* Musixmatch necesita un "usertoken" válido de la app de escritorio.
     Pega uno aquí y se probará como último recurso; vacío = se omite. */
  const MM_TOKEN = '';

  function normTxt(s) {
    return String(s)
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\((?:feat|ft|con|prod)[^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/\b(remaster(ed)?|deluxe|version|edit|intro|skit|oficial|official|video|visualizer|audio)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function coincide(a, b) {
    const x = normTxt(a);
    const y = normTxt(b);
    if (!x || !y) return false;
    if (x === y || x.includes(y) || y.includes(x)) return true;
    const tx = new Set(x.split(' '));
    const ty = new Set(y.split(' '));
    let comunes = 0;
    tx.forEach((t) => { if (ty.has(t)) comunes++; });
    return comunes / Math.max(tx.size, ty.size) >= 0.6;
  }

  function limpiarPista(s) {
    return String(s)
      .replace(/\((?:feat|ft|con)[^)]*\)/gi, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  async function conTimeout(url, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || 8000);
    try {
      return await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function letraLRCLIB(titulo, artista) {
    const titulos = [...new Set([titulo, limpiarPista(titulo)])];
    for (const t of titulos) {
      if (!t) continue;
      for (let intento = 0; intento < 2; intento++) {
        try {
          const qs = new URLSearchParams({ track_name: t, artist_name: artista });
          const res = await conTimeout('https://lrclib.net/api/search?' + qs.toString());
          if (res.status === 503) {
            await sleep(700 * (intento + 1));
            continue;
          }
          if (!res.ok) break;
          const data = await res.json();
          const hit = Array.isArray(data)
            ? data.find((d) => d && d.plainLyrics && d.plainLyrics.trim())
            : null;
          if (hit) return hit.plainLyrics;
          break;
        } catch (err) {
          break;
        }
      }
    }
    return null;
  }

  async function letraLRCLIBLibre(titulo, artista) {
    try {
      const q = limpiarPista(titulo);
      const url = 'https://lrclib.net/api/search?q=' +
        encodeURIComponent(artista + ' ' + q);
      const res = await conTimeout(url);
      if (!res.ok) return null;
      const data = await res.json();
      const hit = Array.isArray(data) ? data.find((d) =>
        d && d.plainLyrics && d.plainLyrics.trim() &&
        coincide(q, d.trackName || d.name) &&
        coincide(artista, d.artistName)) : null;
      return hit ? hit.plainLyrics : null;
    } catch (err) {
      return null;
    }
  }

  async function letraOvh(titulo, artista) {
    try {
      const url = 'https://api.lyrics.ovh/v1/' +
        encodeURIComponent(artista) + '/' + encodeURIComponent(limpiarPista(titulo));
      const res = await conTimeout(url);
      if (!res.ok) return null;
      const data = await res.json();
      return data && data.lyrics ? data.lyrics.replace(/\r/g, '') : null;
    } catch (err) {
      return null;
    }
  }

  async function letraMusixmatch(titulo, artista) {
    if (!MM_TOKEN) return null;
    try {
      const qs = new URLSearchParams({
        format: 'json',
        q_track: titulo,
        q_artist: artista,
        usertoken: MM_TOKEN,
        app_id: 'web-desktop-app-v1.0'
      });
      const url = 'https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get?' + qs.toString();
      const res = await conTimeout(url);
      if (!res.ok) return null;
      const j = await res.json();
      const calls = (j.message && j.message.body && j.message.body.macro_calls) || {};
      const track = calls['matcher.track.get'] && calls['matcher.track.get'].message.body.track;
      if (!track || !coincide(track.track_name, titulo) || !coincide(track.artist_name, artista)) {
        return null;
      }
      const sub = calls['track.subtitles.get'] &&
        calls['track.subtitles.get'].message.body.subtitle_list[0];
      let texto = sub && sub.subtitle && sub.subtitle.subtitle_body;
      if (!texto) {
        const lyr = calls['track.lyrics.get'] && calls['track.lyrics.get'].message.body.lyrics;
        texto = lyr && lyr.lyrics_body;
      }
      if (!texto) return null;
      return texto
        .replace(/\[\d{1,2}:\d{2}(?:\.\d{1,2})?\]/g, ' ')
        .replace(/\*+\s*This Lyrics is NOT for Commercial use[\s\S]*$/i, '')
        .trim();
    } catch (err) {
      return null;
    }
  }

  const PROVEEDORES = [
    { nombre: 'LRCLIB', fn: letraLRCLIB },
    { nombre: 'LRCLIB', fn: letraLRCLIBLibre },
    { nombre: 'lyrics.ovh', fn: letraOvh },
    { nombre: 'Musixmatch', fn: letraMusixmatch }
  ];

  async function buscarLetra(titulo, artista) {
    for (const p of PROVEEDORES) {
      try {
        const letra = await p.fn(titulo, artista);
        if (letra && letra.trim()) return { letra, fuente: p.nombre };
      } catch (err) {
        /* probar el siguiente proveedor */
      }
    }
    return null;
  }

  /* ---------- Pintar líneas seleccionables ---------- */
  function pintarLetra(letra) {
    if (!linesEl) return;
    linesEl.innerHTML = '';
    linesEl.hidden = false;

    lineasLetra = String(letra)
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    botonesLetra = [];
    selStart = -1;
    selEnd = -1;

    lineasLetra.forEach((linea, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lyric-line';
      btn.textContent = linea;
      btn.addEventListener('click', () => elegirLinea(i));
      linesEl.appendChild(btn);
      botonesLetra.push(btn);
    });

    setCount(lineasLetra.length);
    setStatus('Toca una línea y luego otra cercana para sumarla.');
  }

  function pintarSeleccion() {
    botonesLetra.forEach((btn, i) => {
      btn.classList.toggle('selected', i >= selStart && i <= selEnd);
    });
  }

  function elegirLinea(indice) {
    if (selStart < 0) {
      selStart = indice;
      selEnd = indice;
    } else if (indice >= selStart && indice <= selEnd) {
      // tocar dentro del rango lo reduce a esa línea
      selStart = indice;
      selEnd = indice;
    } else if (indice < selStart && selStart - indice <= CERCANIA) {
      selStart = indice;
    } else if (indice > selEnd && indice - selEnd <= CERCANIA) {
      selEnd = indice;
    } else {
      // demasiado lejos: empieza una selección nueva
      selStart = indice;
      selEnd = indice;
    }

    pintarSeleccion();

    const elegidas = lineasLetra.slice(selStart, selEnd + 1);
    currentQuote = elegidas.join('\n');
    if (quoteEl) {
      quoteEl.hidden = false;
      quoteEl.textContent = '“' + currentQuote + '”';
    }
    imageBtn.disabled = false;

    const n = elegidas.length;
    if (n === 1) {
      setStatus('1 línea elegida. Toca una línea cercana para sumarla.');
    } else {
      setStatus(n + ' líneas elegidas. Toca otra cercana para sumar.');
    }
  }

  /* ------------------------------------------------------------
     Imagen 1200×1200 con estética Windows 98
     ------------------------------------------------------------ */
  const BEVEL = {
    hi: '#ffffff',
    mid: '#dfdfdf',
    dark: '#808080',
    black: '#000000',
    face: '#c0c0c0'
  };

  function bevel(ctx, x, y, w, h, tipo, grosor) {
    const g = grosor || 2;
    ctx.save();
    if (tipo === 'raised') {
      ctx.fillStyle = BEVEL.hi;
      ctx.fillRect(x, y, w, g);
      ctx.fillRect(x, y, g, h);
      ctx.fillStyle = BEVEL.black;
      ctx.fillRect(x, y + h - g, w, g);
      ctx.fillRect(x + w - g, y, g, h);
      ctx.fillStyle = BEVEL.mid;
      ctx.fillRect(x + g, y + g, w - 2 * g, g);
      ctx.fillRect(x + g, y + g, g, h - 2 * g);
      ctx.fillStyle = BEVEL.dark;
      ctx.fillRect(x + g, y + h - 2 * g, w - 2 * g, g);
      ctx.fillRect(x + w - 2 * g, y + g, g, h - 2 * g);
    } else {
      ctx.fillStyle = BEVEL.dark;
      ctx.fillRect(x, y, w, g);
      ctx.fillRect(x, y, g, h);
      ctx.fillStyle = BEVEL.hi;
      ctx.fillRect(x, y + h - g, w, g);
      ctx.fillRect(x + w - g, y, g, h);
      ctx.fillStyle = BEVEL.black;
      ctx.fillRect(x + g, y + g, w - 2 * g, g);
      ctx.fillRect(x + g, y + g, g, h - 2 * g);
      ctx.fillStyle = BEVEL.mid;
      ctx.fillRect(x + g, y + h - 2 * g, w - 2 * g, g);
      ctx.fillRect(x + w - 2 * g, y + g, g, h - 2 * g);
    }
    ctx.restore();
  }

  // Respeta los saltos de línea originales y además parte las líneas
  // demasiado largas para que entren en el ancho disponible.
  function wrapText(ctx, text, maxWidth) {
    const salida = [];
    String(text).split('\n').forEach((parrafo) => {
      const words = parrafo.split(/\s+/).filter(Boolean);
      if (!words.length) return;
      let line = '';
      words.forEach((word) => {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          salida.push(line);
          line = word;
        } else {
          line = test;
        }
      });
      if (line) salida.push(line);
    });
    return salida;
  }

  function recortar(ctx, texto, maxWidth) {
    let t = String(texto);
    if (ctx.measureText(t).width <= maxWidth) return t;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) {
      t = t.slice(0, -1);
    }
    return t + '…';
  }

  function dibujarIconoDoc(ctx, x, y, s) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, s, s * 1.15);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(1, s / 16);
    ctx.strokeRect(x, y, s, s * 1.15);
    ctx.strokeStyle = '#000080';
    const lw = Math.max(1, s / 14);
    ctx.lineWidth = lw;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x + s * 0.18, y + s * (0.3 + i * 0.2));
      ctx.lineTo(x + s * 0.82, y + s * (0.3 + i * 0.2));
      ctx.stroke();
    }
  }

  function dibujarNota(ctx, x, y, h) {
    const headX = x + h * 0.30;
    const headY = y + h * 0.78;
    const headR = h * 0.19;
    const stemX = headX + headR * 0.86;
    const stemW = Math.max(2, h * 0.07);
    const stemTop = y + h * 0.06;

    ctx.save();
    ctx.fillStyle = '#000080';

    ctx.beginPath();
    ctx.ellipse(headX, headY, headR * 1.22, headR * 0.86, -0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillRect(stemX - stemW / 2, stemTop, stemW, headY - stemTop);

    ctx.beginPath();
    ctx.moveTo(stemX, stemTop);
    ctx.quadraticCurveTo(stemX + h * 0.36, stemTop + h * 0.08,
      stemX + h * 0.26, stemTop + h * 0.34);
    ctx.quadraticCurveTo(stemX + h * 0.24, stemTop + h * 0.16,
      stemX, stemTop + h * 0.22);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function dibujarBoton(ctx, x, y, w, h, glifo) {
    ctx.fillStyle = BEVEL.face;
    ctx.fillRect(x, y, w, h);
    bevel(ctx, x, y, w, h, 'raised', 2);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.lineCap = 'butt';
    const cx = x + w / 2;
    const cy = y + h / 2;
    if (glifo === 'min') {
      ctx.beginPath();
      ctx.moveTo(cx - 9, y + h - 12);
      ctx.lineTo(cx + 9, y + h - 12);
      ctx.stroke();
    } else if (glifo === 'max') {
      ctx.strokeRect(cx - 10, cy - 10, 20, 20);
    } else {
      ctx.beginPath();
      ctx.moveTo(cx - 9, cy - 9);
      ctx.lineTo(cx + 9, cy + 9);
      ctx.moveTo(cx + 9, cy - 9);
      ctx.lineTo(cx - 9, cy + 9);
      ctx.stroke();
    }
  }

  function cargarPortada(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => resolve(null), 8000);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = url;
    });
  }

  async function crearImagen() {
    if (!currentQuote || !currentAlbum) return;

    imageBtn.disabled = true;
    setStatus('Generando imagen…');

    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (err) { /* seguimos */ }
    }

    const S = 1200;
    const ctx = canvas.getContext('2d');
    const mono = '"Fixedsys Excelsior 3.01", Fixedsys, "Lucida Console", "Courier New", monospace';
    const ui = 'Tahoma, "MS Shell Dlg", "Microsoft Sans Serif", Arial, sans-serif';

    /* Escritorio */
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#008080';
    ctx.fillRect(0, 0, S, S);

    /* Ventana */
    const W = 1000;
    const H = 840;
    const X = (S - W) / 2;
    const Y = (S - H) / 2;
    const titleH = 62;
    const menuH = 50;
    const statusH = 46;

    ctx.fillStyle = BEVEL.face;
    ctx.fillRect(X, Y, W, H);
    bevel(ctx, X, Y, W, H, 'raised', 3);

    /* Barra de título */
    const grad = ctx.createLinearGradient(X, 0, X + W, 0);
    grad.addColorStop(0, '#000080');
    grad.addColorStop(1, '#1084d0');
    ctx.fillStyle = grad;
    ctx.fillRect(X + 4, Y + 4, W - 8, titleH - 6);

    const iconS = 30;
    dibujarIconoDoc(ctx, X + 14, Y + 17, iconS);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px ' + ui;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const nombreVentana = (currentTrack || currentAlbum.titulo || 'letra') +
      '.txt - Bloc de notas';
    const anchoTitulo = W - 8 - 14 - iconS - 18 - 3 * 44 - 2 * 6 - 16;
    ctx.fillText(recortar(ctx, nombreVentana, anchoTitulo),
      X + 14 + iconS + 14, Y + 4 + (titleH - 8) / 2);

    const btnW = 44;
    const btnH = 38;
    let bx = X + W - 10 - 3 * btnW - 2 * 6;
    const by = Y + 12;
    dibujarBoton(ctx, bx, by, btnW, btnH, 'min');
    bx += btnW + 6;
    dibujarBoton(ctx, bx, by, btnW, btnH, 'max');
    bx += btnW + 6;
    dibujarBoton(ctx, bx, by, btnW, btnH, 'close');

    /* Barra de menú */
    const menuY = Y + titleH + 2;
    ctx.fillStyle = BEVEL.face;
    ctx.fillRect(X + 4, menuY, W - 8, menuH);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 25px ' + ui;
    ctx.textBaseline = 'middle';
    const menu = ['Archivo', 'Edición', 'Buscar', 'Ayuda'];
    let mx = X + 22;
    const menuMid = menuY + menuH / 2;
    menu.forEach((item) => {
      ctx.fillText(item, mx, menuMid);
      mx += ctx.measureText(item).width + 34;
    });
    ctx.fillStyle = BEVEL.dark;
    ctx.fillRect(X + 6, menuY + menuH - 3, W - 12, 2);
    ctx.fillStyle = BEVEL.hi;
    ctx.fillRect(X + 6, menuY + menuH - 1, W - 12, 1);

    /* Área del documento */
    const bodyX = X + 14;
    const bodyY = menuY + menuH + 12;
    const bodyW = W - 28;
    const bodyH = H - (bodyY - Y) - statusH - 12;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bodyX, bodyY, bodyW, bodyH);
    bevel(ctx, bodyX, bodyY, bodyW, bodyH, 'sunken', 3);

    const padX = 52;
    const innerX = bodyX + padX;
    const innerW = bodyW - padX * 2;

    /* --- Cabecera: [portada] Título/Artista-Álbum, pegada a la izquierda --- */
    const tituloCancion = currentTrack || currentAlbum.titulo || 'letra';
    const artista = currentAlbum.artista || '';
    const albumTxt = currentAlbum.titulo || '';
    const tituloCab = tituloCancion;
    const subCab = artista && albumTxt ? artista + ' · ' + albumTxt : (artista || albumTxt);

    const portada = await cargarPortada(currentAlbum.portada);
    const coverSize = 140;
    const gapIcono = 24;
    const cabeceraMax = innerW - coverSize - gapIcono;

    let cabSize = 34;
    const cabSizes = [34, 32, 30, 28, 26, 24, 22, 20];
    for (let i = 0; i < cabSizes.length; i++) {
      cabSize = cabSizes[i];
      ctx.font = 'bold ' + cabSize + 'px ' + ui;
      if (ctx.measureText(tituloCab).width <= cabeceraMax) break;
    }
    const cabTexto = recortar(ctx, tituloCab, cabeceraMax);

    let subSize = 21;
    const subSizes = [21, 20, 19, 18, 17, 16];
    for (let i = 0; i < subSizes.length; i++) {
      subSize = subSizes[i];
      ctx.font = subSize + 'px ' + ui;
      if (ctx.measureText(subCab).width <= cabeceraMax) break;
    }
    const subTexto = recortar(ctx, subCab, cabeceraMax);

    const cabCY = bodyY + 82;
    const coverY = cabCY - coverSize / 2;
    const textoX = innerX + coverSize + gapIcono;

    if (portada) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(innerX, coverY, coverSize, coverSize);
      ctx.drawImage(portada, innerX + 3, coverY + 3, coverSize - 6, coverSize - 6);
      bevel(ctx, innerX, coverY, coverSize, coverSize, 'sunken', 3);
    } else {
      dibujarNota(ctx, innerX + coverSize / 2 - 35, cabCY - 49, 98);
    }

    ctx.fillStyle = '#000000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + cabSize + 'px ' + ui;
    ctx.fillText(cabTexto, textoX, cabCY - 21);
    ctx.font = subSize + 'px ' + ui;
    ctx.fillText(subTexto, textoX, cabCY + 23);

    /* Separador estilo ranura Win98 */
    ctx.fillStyle = BEVEL.dark;
    ctx.fillRect(innerX, bodyY + 174, innerW, 2);
    ctx.fillStyle = BEVEL.hi;
    ctx.fillRect(innerX, bodyY + 176, innerW, 1);

    /* --- Letra, cada línea pegada a la izquierda --- */
    const areaTop = bodyY + 200;
    const areaBottom = bodyY + bodyH - 48;
    const maxAlto = Math.max(60, areaBottom - areaTop);

    let size = 46;
    let lineas = [];
    const textoFinal = currentQuote.replace(/\s+$/, '');
    const textoConPunto = /[.!?…]$/.test(textoFinal) ? textoFinal : textoFinal + '.';
    const sizes = [46, 42, 38, 34, 30, 26, 22, 19, 16];
    for (let i = 0; i < sizes.length; i++) {
      size = sizes[i];
      ctx.font = size + 'px ' + mono;
      lineas = wrapText(ctx, textoConPunto, innerW);
      if (lineas.length * size * 1.45 <= maxAlto) break;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(bodyX + 4, bodyY + 4, bodyW - 8, bodyH - 8);
    ctx.clip();

    ctx.fillStyle = '#000000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const lh = size * 1.45;
    const altoTexto = lineas.length * lh;
    let ty = areaTop + Math.max(0, (maxAlto - altoTexto) / 2) + (lh - size) / 2;
    lineas.forEach((linea) => {
      ctx.fillText(linea, innerX, ty);
      ty += lh;
    });

    ctx.restore();

    /* Barra de estado */
    const stY = Y + H - statusH - 4;
    const stX = X + 6;
    const stW = W - 12;
    ctx.fillStyle = BEVEL.face;
    ctx.fillRect(stX, stY, stW, statusH);
    ctx.fillStyle = BEVEL.hi;
    ctx.fillRect(stX, stY, stW, 2);
    ctx.fillStyle = BEVEL.dark;
    ctx.fillRect(stX, stY + 2, stW, 1);

    function panel(px, pw, texto) {
      const py = stY + 7;
      const ph = statusH - 13;
      ctx.fillStyle = BEVEL.face;
      ctx.fillRect(px, py, pw, ph);
      bevel(ctx, px, py, pw, ph, 'sunken', 2);
      ctx.fillStyle = '#000000';
      ctx.font = '21px ' + ui;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(recortar(ctx, texto, pw - 18), px + 9, py + ph / 2);
    }

    const elegidas = selStart >= 0 ? (selEnd - selStart + 1) : 1;
    const p1 = stX + 4;
    const p3 = stX + stW - 4 - 180;
    const p2 = p1 + 150 + 6;
    panel(p1, 150, elegidas + ' línea(s)');
    panel(p2, p3 - p2 - 6,
      (currentAlbum.titulo || '') + ' — ' + (currentAlbum.artista || '') +
      (currentTrack ? ' · ' + currentTrack : ''));
    panel(p3, 180, 'musicOs');

    const nombre = 'musicos-' +
      String(currentAlbum.titulo || 'album')
        .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') +
      (currentTrack
        ? '-' + String(currentTrack)
          .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        : '') +
      '.png';

    canvas.toBlob((blob) => {
      imageBtn.disabled = false;
      if (!blob) {
        setStatus('No se pudo generar la imagen.');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus('Imagen descargada: ' + nombre);
    }, 'image/png');
  }

  /* ---------- Eventos ---------- */
  albumEl.addEventListener('change', () => {
    currentAlbum = albums[Number(albumEl.value)] || null;
    if (!currentAlbum) return;
    cargarCanciones(currentAlbum);
  });

  selectEl.addEventListener('change', () => {
    resetSalida();
    if (manualWrap) manualWrap.hidden = true;

    if (selectEl.value === '__otra') {
      currentTrack = '';
      if (titleWrap) titleWrap.hidden = false;
      if (titleInput) {
        titleInput.value = '';
        titleInput.focus();
      }
      setStatus('Escribe el título de la canción que quieres.');
      return;
    }

    if (titleWrap) titleWrap.hidden = true;
    currentTrack = trackList[Number(selectEl.value)] || '';
    if (currentTrack) {
      setStatus('Pulsa "Buscar letra" para traer la letra de "' + currentTrack + '".');
    }
  });

  if (titleInput) {
    titleInput.addEventListener('input', () => {
      currentTrack = titleInput.value.trim();
      resetSalida();
      if (manualWrap) manualWrap.hidden = true;
    });
  }

  fetchBtn.addEventListener('click', async () => {
    if (!currentAlbum) {
      setStatus('Primero elige un álbum.');
      return;
    }
    const pista = currentTrack || (titleInput ? titleInput.value.trim() : '');
    if (!pista) {
      setStatus('Primero elige una canción.');
      return;
    }
    currentTrack = pista;

    fetchBtn.disabled = true;
    resetSalida();
    if (manualWrap) manualWrap.hidden = true;
    setStatus('Buscando letra de "' + pista + '"…');

    try {
      const res = await buscarLetra(pista, currentAlbum.artista);
      if (res) {
        pintarLetra(res.letra);
        setSource('Letra vía ' + res.fuente);
      } else {
        setSource('');
        setStatus('No encontré la letra online. Pégala a mano abajo.');
        if (manualWrap) manualWrap.hidden = false;
        if (manualInput) manualInput.focus();
      }
    } catch (err) {
      setStatus('No se pudo buscar la letra: ' + err.message);
      if (manualWrap) manualWrap.hidden = false;
    } finally {
      fetchBtn.disabled = false;
    }
  });

  if (manualUse && manualInput) {
    manualUse.addEventListener('click', () => {
      const texto = manualInput.value.trim();
      if (!texto) {
        setStatus('Pega primero la letra.');
        return;
      }
      resetSalida();
      pintarLetra(texto);
      if (manualWrap) manualWrap.hidden = true;
    });
  }

  imageBtn.addEventListener('click', () => {
    crearImagen().catch((err) => {
      console.error(err);
      imageBtn.disabled = false;
      setStatus('No se pudo generar la imagen.');
    });
  });

  /* ---------- Arranque ---------- */
  resetSalida();
  loadAlbums();
})();
