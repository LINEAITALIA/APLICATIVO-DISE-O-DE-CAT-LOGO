/**
 * Ingeniería de producto — VISOR DE PIEZAS (DXF en 2D, IGES en 3D)
 * Módulo independiente: si este archivo no carga, el aplicativo funciona igual
 * (solo no aparece el botón "Ver pieza").
 *
 * Uso: VisorCorte.abrir({ nombre: 'LATERAL.IGS', subtitulo: '1000 · v2', obtenerBytes: async () => Uint8Array })
 * Las librerías se descargan solo la primera vez que se usan:
 *   DXF  → dxf-parser (ligero) · IGES → OpenCascade (~8 MB la primera vez) + three.js
 */
(function () {
  'use strict';
  const CDN = {
    dxf: 'https://cdn.jsdelivr.net/npm/dxf-parser@1.1.2/dist/dxf-parser.js',
    three: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
    orbit: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js',
    occt: 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.js',
    occtBase: 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/'
  };
  const scripts = {};
  function cargarScript(src) {
    if (!scripts[src]) scripts[src] = new Promise((ok, mal) => {
      const s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = ok; s.onerror = () => { delete scripts[src]; mal(new Error('No se pudo descargar el visor. Revisa tu conexión a internet.')); };
      document.head.appendChild(s);
    });
    return scripts[src];
  }
  let occtListo = null;
  function motorOcct() {
    if (!occtListo) occtListo = cargarScript(CDN.occt).then(() => window.occtimportjs({ locateFile: f => CDN.occtBase + f }))
      .catch(e => { occtListo = null; throw e; });
    return occtListo;
  }
  const esOscuro = () => document.documentElement.classList.contains('dark');
  const colores = () => esOscuro()
    ? { fondo: '#10161D', tinta: '#E6EAEF', pieza: 0x9aa7b6, arista: 0x10161d }
    : { fondo: '#FFFFFF', tinta: '#1B2430', pieza: 0xb8c1cb, arista: 0x2b3440 };
  const fmt = n => { const t = Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(2); return t.includes('.') ? t.replace(/\.?0+$/, '') : t; };

  /* ---------- Ventana ---------- */
  let actual = null;
  function el(tag, clases, texto) { const e = document.createElement(tag); if (clases) e.className = clases; if (texto != null) e.textContent = texto; return e; }
  function boton(texto, fn, etiqueta) {
    const b = el('button', 'rounded-md border border-[#C3CBD4] bg-white px-3 py-1.5 text-sm font-medium text-[#1B2430] hover:bg-[#F4F6F8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E4E79] dark:border-[#3A4756] dark:bg-[#1B232D] dark:text-[#E6EAEF] dark:hover:bg-[#243040]', texto);
    b.type = 'button'; if (etiqueta) { b.title = etiqueta; b.setAttribute('aria-label', etiqueta); } b.onclick = fn; return b;
  }
  function cerrar() {
    if (!actual) return;
    try { actual.limpiar && actual.limpiar(); } catch (e) { /* nada */ }
    document.removeEventListener('keydown', actual.tecla, true);
    actual.raiz.remove();
    const foco = actual.foco; actual = null;
    if (foco && foco.focus) foco.focus();
  }
  function armarVentana(nombre, subtitulo) {
    cerrar();
    const raiz = el('div', 'fixed inset-0 z-[80] flex flex-col bg-[#F4F6F8] text-[#1B2430] dark:bg-[#0B1015] dark:text-[#E6EAEF]');
    raiz.setAttribute('role', 'dialog'); raiz.setAttribute('aria-modal', 'true'); raiz.setAttribute('aria-label', `Vista de ${nombre}`);
    const barra = el('div', 'flex flex-wrap items-center gap-2 border-b border-[#D5DBE2] bg-white px-4 py-2.5 dark:border-[#26313D] dark:bg-[#141B23]');
    const titulos = el('div', 'min-w-0 flex-1');
    titulos.append(el('p', 'truncate text-sm font-semibold', nombre), el('p', 'truncate text-xs text-[#5B6675] dark:text-[#9AA7B6]', subtitulo || ''));
    const herramientas = el('div', 'flex flex-wrap items-center gap-2');
    const btnCerrar = boton('Cerrar', cerrar, 'Cerrar visor (Esc)');
    barra.append(titulos, herramientas, btnCerrar);
    const lienzo = el('div', 'relative min-h-0 flex-1 overflow-hidden');
    const pie = el('div', 'flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-[#D5DBE2] bg-white px-4 py-2 text-xs text-[#5B6675] dark:border-[#26313D] dark:bg-[#141B23] dark:text-[#9AA7B6]');
    raiz.append(barra, lienzo, pie);
    document.body.appendChild(raiz);
    const tecla = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); cerrar(); } };
    document.addEventListener('keydown', tecla, true);
    actual = { raiz, herramientas, lienzo, pie, tecla, foco: document.activeElement, limpiar: null };
    btnCerrar.focus();
    return actual;
  }
  function mensaje(v, texto, esError) {
    v.lienzo.innerHTML = '';
    const caja = el('div', 'absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center');
    caja.setAttribute('role', esError ? 'alert' : 'status');
    if (!esError) caja.append(el('div', 'h-8 w-8 animate-spin rounded-full border-2 border-[#1E4E79] border-t-transparent dark:border-[#7FB2E5] dark:border-t-transparent'));
    caja.append(el('p', `max-w-md text-sm ${esError ? 'font-medium text-[#B42318] dark:text-[#F28B82]' : 'text-[#5B6675] dark:text-[#9AA7B6]'}`, texto));
    v.lienzo.append(caja);
  }
  function datoPie(v, etiqueta, valor) {
    const p = el('span'), b = el('span', 'font-semibold tabular-nums text-[#1B2430] dark:text-[#E6EAEF]', valor);
    p.append(el('span', '', etiqueta + ' '), b); v.pie.append(p); return b;
  }

  /* ---------- DXF 2D ---------- */
  function arcoPuntos(cx, cy, r, a0, a1, horario) {
    let d = a1 - a0;
    if (horario) { if (d > 0) d -= Math.PI * 2; } else if (d <= 0) d += Math.PI * 2;
    const n = Math.max(8, Math.ceil(Math.abs(d) / (Math.PI / 36))), pts = [];
    for (let i = 0; i <= n; i++) { const a = a0 + d * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return pts;
  }
  function bulgePuntos(p1, p2, b) { // tramo curvo de una polilínea (bulge = tan(ángulo/4))
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1], c = Math.hypot(dx, dy);
    if (!b || c < 1e-12) return [p2];
    const th = 4 * Math.atan(b), r = c / (2 * Math.sin(th / 2));
    const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2, d = r * Math.cos(th / 2);
    const cx = mx - d * dy / c, cy = my + d * dx / c;
    return arcoPuntos(cx, cy, Math.abs(r), Math.atan2(p1[1] - cy, p1[0] - cx), Math.atan2(p2[1] - cy, p2[0] - cx), b < 0).slice(1);
  }
  function bspline(grado, ctrl, nudos) {
    const n = ctrl.length;
    if (!nudos || nudos.length < n + grado + 1) return ctrl.map(p => [p.x, p.y]);
    const t0 = nudos[grado], t1 = nudos[n], pasos = Math.max(24, n * 8), pts = [];
    for (let i = 0; i <= pasos; i++) {
      const t = Math.min(t0 + (t1 - t0) * i / pasos, t1 - 1e-9);
      let s = grado; while (s < n - 1 && t >= nudos[s + 1]) s++;
      const d = []; for (let j = 0; j <= grado; j++) { const p = ctrl[s - grado + j]; d.push([p.x, p.y]); }
      for (let r = 1; r <= grado; r++) for (let j = grado; j >= r; j--) {
        const k = s - grado + j, den = nudos[k + grado - r + 1] - nudos[k], a = den ? (t - nudos[k]) / den : 0;
        d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1]];
      }
      pts.push(d[grado]);
    }
    return pts;
  }
  function geometriaDxf(dxf) {
    const trazos = [], textos = [], bloques = dxf.blocks || {};
    const mat = (m, x, y) => [m[0] * x + m[1] * y + m[4], m[2] * x + m[3] * y + m[5]];
    function recorrer(entidades, m, nivel) {
      for (const e of entidades || []) {
        try {
          const P = (x, y) => mat(m, x, y);
          switch (e.type) {
            case 'LINE': trazos.push([P(e.vertices[0].x, e.vertices[0].y), P(e.vertices[1].x, e.vertices[1].y)]); break;
            case 'LWPOLYLINE': case 'POLYLINE': {
              const v = (e.vertices || []).filter(p => p && isFinite(p.x)); if (v.length < 2) break;
              const pts = [P(v[0].x, v[0].y)], n = (e.shape || e.closed) ? v.length : v.length - 1;
              for (let i = 0; i < n; i++) { const a = v[i], b = v[(i + 1) % v.length]; bulgePuntos([a.x, a.y], [b.x, b.y], a.bulge || 0).forEach(p => pts.push(P(p[0], p[1]))); }
              trazos.push(pts); break;
            }
            case 'CIRCLE': trazos.push(arcoPuntos(e.center.x, e.center.y, e.radius, 0, Math.PI * 2, false).map(p => P(p[0], p[1]))); break;
            case 'ARC': trazos.push(arcoPuntos(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle, false).map(p => P(p[0], p[1]))); break;
            case 'ELLIPSE': {
              const ax = e.majorAxisEndPoint, ra = Math.hypot(ax.x, ax.y), rb = ra * e.axisRatio, rot = Math.atan2(ax.y, ax.x);
              let a0 = e.startAngle || 0, a1 = e.endAngle == null ? Math.PI * 2 : e.endAngle; if (a1 <= a0) a1 += Math.PI * 2;
              const pts = []; for (let i = 0; i <= 96; i++) { const t = a0 + (a1 - a0) * i / 96, x = ra * Math.cos(t), y = rb * Math.sin(t);
                pts.push(P(e.center.x + x * Math.cos(rot) - y * Math.sin(rot), e.center.y + x * Math.sin(rot) + y * Math.cos(rot))); }
              trazos.push(pts); break;
            }
            case 'SPLINE': {
              const pts = e.controlPoints && e.controlPoints.length ? bspline(e.degreeOfSplineCurve || 3, e.controlPoints, e.knotValues) : (e.fitPoints || []).map(p => [p.x, p.y]);
              if (pts.length > 1) trazos.push(pts.map(p => P(p[0], p[1]))); break;
            }
            case 'TEXT': case 'MTEXT': {
              const pos = e.startPoint || e.position; if (!pos) break;
              const txt = String(e.text || '').replace(/\\[A-Za-z][^;\\]*;/g, '').replace(/\\P/g, ' ').replace(/[{}]/g, '').trim();
              if (txt) textos.push({ p: P(pos.x, pos.y), h: (e.textHeight || e.height || 2.5) * Math.hypot(m[0], m[2]), txt, rot: (e.rotation || 0) * Math.PI / 180 + Math.atan2(m[2], m[0]) });
              break;
            }
            case 'INSERT': case 'DIMENSION': {
              const b = bloques[e.name || e.block]; if (!b || nivel > 8) break;
              const sx = e.xScale || 1, sy = e.yScale || 1, r = (e.rotation || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
              const pos = e.type === 'DIMENSION' || !e.position ? { x: 0, y: 0 } : e.position, bp = b.position || { x: 0, y: 0 };
              const L = [c * sx, -s * sy, s * sx, c * sy, 0, 0];
              L[4] = pos.x - (L[0] * bp.x + L[1] * bp.y); L[5] = pos.y - (L[2] * bp.x + L[3] * bp.y);
              recorrer(b.entities, [m[0] * L[0] + m[1] * L[2], m[0] * L[1] + m[1] * L[3], m[2] * L[0] + m[3] * L[2], m[2] * L[1] + m[3] * L[3],
                m[0] * L[4] + m[1] * L[5] + m[4], m[2] * L[4] + m[3] * L[5] + m[5]], nivel + 1);
              break;
            }
          }
        } catch (err) { /* una entidad rara no detiene el dibujo */ }
      }
    }
    recorrer(dxf.entities, [1, 0, 0, 1, 0, 0], 0);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of trazos) for (const [x, y] of t) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return { trazos, textos, caja: isFinite(x0) ? { x0, y0, x1, y1 } : null, entidades: (dxf.entities || []).length };
  }
  const UNIDADES = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };
  async function verDxf(v, bytes) {
    await cargarScript(CDN.dxf);
    const dxf = new window.DxfParser().parseSync(new TextDecoder('latin1').decode(bytes));
    const g = geometriaDxf(dxf);
    if (!g.caja) throw new Error('El archivo no tiene líneas que dibujar.');
    const uni = UNIDADES[dxf.header && dxf.header.$INSUNITS] || 'mm', c = g.caja;
    v.lienzo.innerHTML = '';
    const canvas = el('canvas', 'absolute inset-0 h-full w-full cursor-grab touch-none'); v.lienzo.append(canvas);
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `Dibujo 2D de ${fmt(c.x1 - c.x0)} por ${fmt(c.y1 - c.y0)} ${uni}`);
    const ctx = canvas.getContext('2d'), vista = { s: 1, ox: 0, oy: 0 }, W = () => canvas.clientWidth, H = () => canvas.clientHeight;
    function dibujar() {
      const dpr = window.devicePixelRatio || 1, col = colores();
      if (canvas.width !== Math.round(W() * dpr) || canvas.height !== Math.round(H() * dpr)) { canvas.width = Math.round(W() * dpr); canvas.height = Math.round(H() * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = col.fondo; ctx.fillRect(0, 0, W(), H());
      ctx.strokeStyle = col.tinta; ctx.lineWidth = 1.3; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
      for (const t of g.trazos) {
        ctx.moveTo(t[0][0] * vista.s + vista.ox, -t[0][1] * vista.s + vista.oy);
        for (let i = 1; i < t.length; i++) ctx.lineTo(t[i][0] * vista.s + vista.ox, -t[i][1] * vista.s + vista.oy);
      }
      ctx.stroke(); ctx.fillStyle = col.tinta;
      for (const t of g.textos) {
        const px = t.h * vista.s; if (px < 4) continue;
        ctx.save(); ctx.translate(t.p[0] * vista.s + vista.ox, -t.p[1] * vista.s + vista.oy); ctx.rotate(-t.rot);
        ctx.font = `${px}px system-ui, sans-serif`; ctx.fillText(t.txt, 0, 0); ctx.restore();
      }
    }
    function ajustar() {
      const w = Math.max(c.x1 - c.x0, 1e-6), h = Math.max(c.y1 - c.y0, 1e-6);
      vista.s = Math.min(W() / w, H() / h) * 0.9; vista.ox = W() / 2 - (c.x0 + w / 2) * vista.s; vista.oy = H() / 2 + (c.y0 + h / 2) * vista.s; dibujar();
    }
    function zoom(f, cx, cy) { cx = cx == null ? W() / 2 : cx; cy = cy == null ? H() / 2 : cy; vista.ox = cx - (cx - vista.ox) * f; vista.oy = cy - (cy - vista.oy) * f; vista.s *= f; dibujar(); }
    let arrastre = null;
    const coord = datoPie(v, 'Cursor:', '—');
    canvas.addEventListener('pointerdown', e => { arrastre = { x: e.clientX, y: e.clientY, ox: vista.ox, oy: vista.oy }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
    canvas.addEventListener('pointerup', () => { arrastre = null; canvas.style.cursor = ''; });
    canvas.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      coord.textContent = `X ${fmt((mx - vista.ox) / vista.s)}  Y ${fmt((vista.oy - my) / vista.s)} ${uni}`;
      if (arrastre) { vista.ox = arrastre.ox + e.clientX - arrastre.x; vista.oy = arrastre.oy + e.clientY - arrastre.y; dibujar(); }
    });
    canvas.addEventListener('wheel', e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    v.herramientas.append(boton('−', () => zoom(1 / 1.3), 'Alejar'), boton('+', () => zoom(1.3), 'Acercar'), boton('Ajustar', ajustar, 'Ver la pieza completa'));
    datoPie(v, 'Medidas:', `${fmt(c.x1 - c.x0)} × ${fmt(c.y1 - c.y0)} ${uni}`);
    datoPie(v, 'Elementos:', String(g.entidades));
    v.pie.append(el('span', 'ml-auto', 'Arrastra para mover · rueda del mouse para acercar'));
    const obs = new ResizeObserver(() => dibujar()); obs.observe(canvas);
    v.limpiar = () => obs.disconnect();
    ajustar();
  }

  /* ---------- IGES 3D ---------- */
  async function verIges(v, bytes) {
    mensaje(v, 'Preparando el visor 3D… La primera vez tarda unos segundos porque descarga el motor de CAD.');
    await cargarScript(CDN.three); await cargarScript(CDN.orbit);
    const occt = await motorOcct();
    if (actual !== v) return;
    mensaje(v, 'Leyendo la pieza…'); await new Promise(r => setTimeout(r, 30));
    const res = occt.ReadIgesFile(bytes, null);
    if (!res || !res.success || !res.meshes.length) throw new Error('No se pudo leer la geometría de este IGES. Puede estar dañado o usar un formato no compatible.');
    const THREE = window.THREE, col = colores();
    v.lienzo.innerHTML = '';
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.domElement.className = 'absolute inset-0 h-full w-full';
    renderer.domElement.setAttribute('role', 'img');
    v.lienzo.append(renderer.domElement);
    const escena = new THREE.Scene(); escena.background = new THREE.Color(col.fondo);
    escena.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.9));
    const luz = new THREE.DirectionalLight(0xffffff, 0.8); escena.add(luz);
    const grupo = new THREE.Group(), aristas = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: col.pieza, metalness: 0.35, roughness: 0.55, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const matArista = new THREE.LineBasicMaterial({ color: col.arista });
    let triangulos = 0;
    for (const m of res.meshes) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
      if (m.attributes.normal) geo.setAttribute('normal', new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
      geo.setIndex(Array.from(m.index.array)); if (!m.attributes.normal) geo.computeVertexNormals();
      triangulos += m.index.array.length / 3;
      grupo.add(new THREE.Mesh(geo, material));
      aristas.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), matArista));
    }
    escena.add(grupo, aristas);
    const caja = new THREE.Box3().setFromObject(grupo), tam = caja.getSize(new THREE.Vector3()), centro = caja.getCenter(new THREE.Vector3());
    grupo.position.sub(centro); aristas.position.sub(centro);
    renderer.domElement.setAttribute('aria-label', `Pieza 3D de ${fmt(tam.x)} por ${fmt(tam.y)} por ${fmt(tam.z)} milímetros`);
    const radio = Math.max(tam.length() / 2, 1e-3);
    const camara = new THREE.PerspectiveCamera(35, 1, radio / 100, radio * 100);
    const control = new THREE.OrbitControls(camara, renderer.domElement); control.enableDamping = true;
    function vista(dir) {
      const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize(), dist = radio / Math.sin(THREE.MathUtils.degToRad(camara.fov / 2)) * 1.05;
      camara.position.copy(d.multiplyScalar(dist));
      if (Math.abs(dir[1]) > 0.99) camara.up.set(0, 0, -1); else camara.up.set(0, 1, 0);
      control.target.set(0, 0, 0); control.update();
    }
    const ISO = [1, 0.8, 1.2];
    v.herramientas.append(boton('Isométrica', () => vista(ISO)), boton('Frente', () => vista([0, 0, 1])), boton('Lado', () => vista([1, 0, 0])),
      boton('Arriba', () => vista([0, 1, 0])), boton('Aristas', () => { aristas.visible = !aristas.visible; }, 'Mostrar u ocultar las aristas'));
    datoPie(v, 'Medidas:', `${fmt(tam.x)} × ${fmt(tam.y)} × ${fmt(tam.z)} mm`);
    datoPie(v, 'Superficies:', String(res.meshes.length));
    datoPie(v, 'Triángulos:', triangulos.toLocaleString('es-MX'));
    v.pie.append(el('span', 'ml-auto', 'Arrastra para girar · clic derecho para mover · rueda para acercar'));
    function tamano() { const w = v.lienzo.clientWidth, h = v.lienzo.clientHeight; renderer.setSize(w, h, false); camara.aspect = w / Math.max(h, 1); camara.updateProjectionMatrix(); }
    const obs = new ResizeObserver(tamano); obs.observe(v.lienzo); tamano(); vista(ISO);
    let vivo = true;
    (function ciclo() { if (!vivo) return; control.update(); luz.position.copy(camara.position); renderer.render(escena, camara); requestAnimationFrame(ciclo); })();
    v.limpiar = () => {
      vivo = false; obs.disconnect(); control.dispose();
      grupo.children.forEach(o => o.geometry.dispose()); aristas.children.forEach(o => o.geometry.dispose());
      material.dispose(); matArista.dispose(); renderer.dispose();
    };
  }

  /* ---------- Funciones públicas ---------- */
  const tipoDe = n => ((/\.([a-z0-9]+)$/i.exec(n || '') || [])[1] || '').toLowerCase();
  window.VisorCorte = {
    puedeVer(nombre) { return ['dxf', 'igs', 'iges'].includes(tipoDe(nombre)); },
    async abrir({ nombre, subtitulo, bytes, obtenerBytes }) {
      const v = armarVentana(nombre, subtitulo);
      mensaje(v, 'Abriendo la pieza…');
      try {
        const datos = bytes || (obtenerBytes ? await obtenerBytes() : null);
        if (actual !== v) return; // se cerró mientras cargaba
        if (!datos) throw new Error('No se recibió el archivo.');
        const tipo = tipoDe(nombre);
        if (tipo === 'dxf') { mensaje(v, 'Dibujando la pieza…'); await verDxf(v, datos); }
        else if (tipo === 'igs' || tipo === 'iges') await verIges(v, datos);
        else throw new Error('Este visor solo abre archivos DXF e IGES.');
      } catch (e) { if (actual === v) mensaje(v, e.message || String(e), true); }
    },
    cerrar
  };
})();
