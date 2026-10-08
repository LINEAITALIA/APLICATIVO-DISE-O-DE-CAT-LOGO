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
  function menuDesplegable(v, etiqueta, opciones) { // botón con menú; opciones: [{ texto, accion }] o '-' para separador
    const cont = el('div', 'relative');
    const b = boton(`${etiqueta} ▾`, () => panel.classList.toggle('hidden'));
    b.textContent = `${etiqueta} ▾`; b.setAttribute('aria-haspopup', 'true');
    const panel = el('div', 'absolute right-0 top-full z-20 mt-1 hidden min-w-[15rem] overflow-hidden rounded-md border border-[#D5DBE2] bg-white py-1 text-[#1B2430] shadow-lg dark:border-[#2E3A48] dark:bg-[#1B232D] dark:text-[#E6EAEF]');
    panel.setAttribute('role', 'menu');
    for (const o of opciones) {
      if (o === '-') { panel.append(el('div', 'my-1 border-t border-[#E3E7EC] dark:border-[#2E3A48]')); continue; }
      const it = el('button', 'block w-full px-3 py-2 text-left text-sm hover:bg-[#F4F6F8] focus:bg-[#F4F6F8] focus:outline-none dark:hover:bg-[#243040] dark:focus:bg-[#243040]', o.texto);
      it.type = 'button'; it.setAttribute('role', 'menuitem'); it.onclick = () => { panel.classList.add('hidden'); o.accion(); }; panel.append(it);
    }
    v.raiz.addEventListener('pointerdown', ev => { if (!cont.contains(ev.target)) panel.classList.add('hidden'); }, true);
    cont.append(b, panel);
    return { nodo: cont, boton: b, etiqueta: t => { b.textContent = `${t} ▾`; } };
  }
// Ajuste de cilindro a una cara curva: eje por las normales, círculo por mínimos cuadrados
function jacobi3(A) { // valores y vectores propios de una matriz simétrica 3x3
  const a = A.map(r => r.slice()), V = [[1,0,0],[0,1,0],[0,0,1]];
  for (let it = 0; it < 50; it++) {
    let p = 0, q = 1; for (const [i, j] of [[0,1],[0,2],[1,2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    if (Math.abs(a[p][q]) < 1e-12) break;
    const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
    for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
    for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
    for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
  }
  return { valores: [a[0][0], a[1][1], a[2][2]], vectores: [0,1,2].map(j => [V[0][j], V[1][j], V[2][j]]) };
}
function ajustarCilindro(pos, nor) { // pos, nor: arreglos planos [x,y,z,...]
  const n = pos.length / 3; if (n < 6) return { error: 'La cara es muy pequeña para medir.' };
  let minDot = 1; const n0 = [nor[0], nor[1], nor[2]];
  const M = [[0,0,0],[0,0,0],[0,0,0]];
  for (let i = 0; i < n; i++) { const v = [nor[3*i], nor[3*i+1], nor[3*i+2]]; minDot = Math.min(minDot, v[0]*n0[0] + v[1]*n0[1] + v[2]*n0[2]);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a][b] += v[a] * v[b]; }
  if (minDot > 0.996) return { error: 'Esa cara es plana. Da clic en una superficie curva: la pared de un barreno o una esquina redondeada.' };
  const { valores, vectores } = jacobi3(M);
  const eje = vectores[valores.indexOf(Math.min(...valores))];
  const aux = Math.abs(eje[0]) < 0.9 ? [1,0,0] : [0,1,0];
  const cruz = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]], unit = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
  const u = unit(cruz(eje, aux)), w = cruz(eje, u);
  // círculo por mínimos cuadrados (Kasa) en el plano perpendicular al eje
  let Sxx=0,Sxy=0,Syy=0,Sx=0,Sy=0,Sz=0,Sxz=0,Syz=0; const P = [];
  for (let i = 0; i < n; i++) { const p = [pos[3*i], pos[3*i+1], pos[3*i+2]], x = p[0]*u[0]+p[1]*u[1]+p[2]*u[2], y = p[0]*w[0]+p[1]*w[1]+p[2]*w[2], z = x*x + y*y;
    P.push([x, y]); Sxx+=x*x; Sxy+=x*y; Syy+=y*y; Sx+=x; Sy+=y; Sz+=z; Sxz+=x*z; Syz+=y*z; }
  const A = [[Sxx,Sxy,Sx],[Sxy,Syy,Sy],[Sx,Sy,n]], B = [-Sxz,-Syz,-Sz];
  const det = m => m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
  const D = det(A); if (Math.abs(D) < 1e-12) return { error: 'No se pudo calcular el radio de esa cara.' };
  const sol = [0,1,2].map(k => det(A.map((r, i) => r.map((v, j) => j === k ? B[i] : v))) / D);
  const cx = -sol[0] / 2, cy = -sol[1] / 2, r = Math.sqrt(Math.max(cx*cx + cy*cy - sol[2], 0));
  let err = 0; const angs = [];
  for (const [x, y] of P) { err += (Math.hypot(x - cx, y - cy) - r) ** 2; angs.push(Math.atan2(y - cy, x - cx)); }
  err = Math.sqrt(err / n);
  if (!(r > 0) || err > Math.max(0.02 * r, 0.02)) return { error: 'Esa superficie no es circular; no tiene un radio que medir.' };
  angs.sort((a, b) => a - b); let hueco = angs[0] + 2 * Math.PI - angs[angs.length - 1]; for (let i = 1; i < angs.length; i++) hueco = Math.max(hueco, angs[i] - angs[i-1]);
  const cobertura = 360 - hueco * 180 / Math.PI;
  // centro en 3D (a la altura media de la cara) y si la superficie mira hacia el eje (barreno) o hacia afuera
  let h = 0; for (let i = 0; i < n; i++) h += pos[3*i]*eje[0] + pos[3*i+1]*eje[1] + pos[3*i+2]*eje[2]; h /= n;
  const c3 = [0,1,2].map(k => cx*u[k] + cy*w[k] + h*eje[k]);
  let haciaEje = 0; for (let i = 0; i < n; i++) { const d = [c3[0]-pos[3*i], c3[1]-pos[3*i+1], c3[2]-pos[3*i+2]]; haciaEje += d[0]*nor[3*i] + d[1]*nor[3*i+1] + d[2]*nor[3*i+2]; }
  return { r, centro: c3, eje, u, w, cobertura, completo: cobertura > 300, interior: haciaEje > 0, error: null };
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
    const btnCerrar = boton('Cerrar', cerrar, 'Cerrar visor');
    barra.append(titulos, herramientas, btnCerrar);
    const lienzo = el('div', 'relative min-h-0 flex-1 overflow-hidden');
    const pie = el('div', 'flex h-9 shrink-0 flex-nowrap items-center gap-x-5 overflow-hidden whitespace-nowrap border-t border-[#D5DBE2] bg-white px-4 text-xs text-[#5B6675] dark:border-[#26313D] dark:bg-[#141B23] dark:text-[#9AA7B6]');
    raiz.append(barra, lienzo, pie);
    document.body.appendChild(raiz);
    const tecla = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); if (actual && actual.cancelar) actual.cancelar(); } }; // Esc cancela la selección; el visor se cierra con el botón Cerrar
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
    const trazos = [], textos = [], puntos = [], curvas = [], segmentos = [], bloques = dxf.blocks || {};
    const mat = (m, x, y) => [m[0] * x + m[1] * y + m[4], m[2] * x + m[3] * y + m[5]];
    function recorrer(entidades, m, nivel) {
      for (const e of entidades || []) {
        try {
          const P = (x, y) => mat(m, x, y);
          switch (e.type) {
            case 'LINE': { const a = P(e.vertices[0].x, e.vertices[0].y), b = P(e.vertices[1].x, e.vertices[1].y); trazos.push([a, b]); puntos.push(a, b); segmentos.push([a, b]); break; }
            case 'LWPOLYLINE': case 'POLYLINE': {
              const v = (e.vertices || []).filter(p => p && isFinite(p.x)); if (v.length < 2) break;
              const pts = [P(v[0].x, v[0].y)], n = (e.shape || e.closed) ? v.length : v.length - 1;
              for (let i = 0; i < n; i++) { const a = v[i], b = v[(i + 1) % v.length]; bulgePuntos([a.x, a.y], [b.x, b.y], a.bulge || 0).forEach(p => pts.push(P(p[0], p[1]))); if (!a.bulge) segmentos.push([P(a.x, a.y), P(b.x, b.y)]); }
              trazos.push(pts); v.forEach(q => puntos.push(P(q.x, q.y))); break;
            }
            case 'CIRCLE': {
              trazos.push(arcoPuntos(e.center.x, e.center.y, e.radius, 0, Math.PI * 2, false).map(p => P(p[0], p[1])));
              const c = P(e.center.x, e.center.y); puntos.push(c); curvas.push({ c, r: e.radius * Math.hypot(m[0], m[2]), completo: true }); break;
            }
            case 'ARC': {
              const pts = arcoPuntos(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle, false).map(p => P(p[0], p[1]));
              trazos.push(pts); const c = P(e.center.x, e.center.y);
              puntos.push(c, pts[0], pts[pts.length - 1]); curvas.push({ c, r: e.radius * Math.hypot(m[0], m[2]), completo: false, pts }); break;
            }
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
    return { trazos, textos, puntos, curvas, segmentos, caja: isFinite(x0) ? { x0, y0, x1, y1 } : null, entidades: (dxf.entities || []).length };
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
      dibujarMedidas(col);
    }
    /* ----- Medición 2D -----
       Se eligen "referencias": un barreno (por su orilla), una esquina o una arista recta.
       Modos: horizontal/vertical (predeterminado), perpendicular a una arista, longitud de arista y barreno o radio. */
    const med = { herramienta: 'orto', lista: [], a: null, hover: null, cursor: null };
    v.raiz.__vista2d = vista; // solo para pruebas automáticas
    const acento = () => esOscuro() ? '#FFB347' : '#D9480F';
    const aPantalla = p => [p[0] * vista.s + vista.ox, -p[1] * vista.s + vista.oy];
    const aMundo = (mx, my) => [(mx - vista.ox) / vista.s, (vista.oy - my) / vista.s];
    const esVertice = p => !g.curvas.some(cv => cv.c === p); // los centros no se ofrecen: el barreno se toma por su orilla
    function barrenoCercano(mx, my) { // círculo o arco cuya orilla está a menos de 7 px (o un barreno chico bajo el cursor)
      const w = aMundo(mx, my); let mejor = null, dmin = 7;
      for (const cv of g.curvas) {
        const dc = Math.hypot(w[0] - cv.c[0], w[1] - cv.c[1]) * vista.s, rp = cv.r * vista.s;
        const d = rp < 9 ? Math.max(0, dc - rp) : Math.abs(dc - rp);
        if (d < dmin) { dmin = d; mejor = cv; }
      }
      return mejor;
    }
    function verticeCercano(mx, my) {
      let mejor = null, dmin = 8;
      for (const p of g.puntos) { if (!esVertice(p)) continue; const [x, y] = aPantalla(p), d = Math.hypot(x - mx, y - my); if (d < dmin) { dmin = d; mejor = p; } }
      return mejor;
    }
    function segmentoCercano(mx, my) {
      let mejor = null, dmin = 6;
      for (const sg of g.segmentos) {
        const [ax, ay] = aPantalla(sg[0]), [bx, by] = aPantalla(sg[1]), dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((mx - ax) * dx + (my - ay) * dy) / l2)) : 0, d = Math.hypot(mx - (ax + t * dx), my - (ay + t * dy));
        if (d < dmin) { dmin = d; mejor = sg; }
      }
      return mejor;
    }
    function referencia(mx, my, admite) { // lo que está bajo el cursor, en orden de prioridad
      if (admite.includes('barreno')) { const b = barrenoCercano(mx, my); if (b) return { tipo: 'barreno', c: b, p: b.c }; }
      if (admite.includes('punto')) { const p = verticeCercano(mx, my); if (p) return { tipo: 'punto', p }; }
      if (admite.includes('arista')) { const sg = segmentoCercano(mx, my); if (sg) return { tipo: 'arista', sg }; }
      return null;
    }
    const ADMITE = { orto: ['barreno', 'punto', 'arista'], arista: med => med.a ? ['barreno', 'punto'] : ['arista'], longitud: ['arista'], radio: ['barreno'] };
    const admiteAhora = () => typeof ADMITE[med.herramienta] === 'function' ? ADMITE[med.herramienta](med) : ADMITE[med.herramienta] || [];
    const orientacion = sg => { const dx = sg[1][0] - sg[0][0], dy = sg[1][1] - sg[0][1], a = Math.abs(Math.atan2(dy, dx)) % Math.PI; return a < 0.0175 || a > Math.PI - 0.0175 ? 'H' : Math.abs(a - Math.PI / 2) < 0.0175 ? 'V' : 'I'; };
    const pie = (sg, p) => { const [a, b] = sg, dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2; return [a[0] + t * dx, a[1] + t * dy]; };
    function medirOrto(A, B) { // distancia en línea recta, sin ángulo, entre dos referencias
      if (A.tipo === 'arista' && B.tipo === 'arista') {
        const oa = orientacion(A.sg), ob = orientacion(B.sg);
        if (oa !== ob) return { error: 'Las dos aristas deben ser paralelas: ambas horizontales o ambas verticales.' };
        const f = pie(A.sg, B.sg[0]), d = Math.hypot(B.sg[0][0] - f[0], B.sg[0][1] - f[1]);
        return { a: B.sg[0], b: f, d, eje: oa === 'H' ? 'vertical' : oa === 'V' ? 'horizontal' : 'perpendicular' };
      }
      if (A.tipo === 'arista' || B.tipo === 'arista') {
        const ar = A.tipo === 'arista' ? A : B, pt = A.tipo === 'arista' ? B.p : A.p, o = orientacion(ar.sg);
        if (o === 'H') return { a: pt, b: [pt[0], ar.sg[0][1]], d: Math.abs(pt[1] - ar.sg[0][1]), eje: 'vertical' };
        if (o === 'V') return { a: pt, b: [ar.sg[0][0], pt[1]], d: Math.abs(pt[0] - ar.sg[0][0]), eje: 'horizontal' };
        const f = pie(ar.sg, pt); return { a: pt, b: f, d: Math.hypot(pt[0] - f[0], pt[1] - f[1]), eje: 'perpendicular' };
      }
      const a = A.p, b = B.p, horiz = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
      return horiz ? { a, b: [b[0], a[1]], d: Math.abs(b[0] - a[0]), eje: 'horizontal' } : { a, b: [a[0], b[1]], d: Math.abs(b[1] - a[1]), eje: 'vertical' };
    }
    function etiqueta(texto, x, y, col) {
      ctx.font = '600 12px system-ui, sans-serif';
      const w = ctx.measureText(texto).width + 10;
      ctx.fillStyle = col.fondo; ctx.globalAlpha = 0.92; ctx.fillRect(x - w / 2, y - 18, w, 18); ctx.globalAlpha = 1;
      ctx.strokeStyle = acento(); ctx.lineWidth = 1; ctx.strokeRect(x - w / 2, y - 18, w, 18);
      ctx.fillStyle = acento(); ctx.textAlign = 'center'; ctx.fillText(texto, x, y - 5); ctx.textAlign = 'start';
    }
    function resaltar(r, grueso) { // ilumina la referencia: la orilla del barreno, la esquina o la arista
      if (!r) return;
      ctx.strokeStyle = acento(); ctx.lineWidth = grueso ? 3 : 2;
      if (r.tipo === 'barreno') { const [x, y] = aPantalla(r.c.c); ctx.beginPath(); ctx.arc(x, y, Math.max(r.c.r * vista.s, 3), 0, Math.PI * 2); ctx.stroke(); }
      else if (r.tipo === 'punto') { const [x, y] = aPantalla(r.p); ctx.strokeRect(x - 4, y - 4, 8, 8); }
      else { const [ax, ay] = aPantalla(r.sg[0]), [bx, by] = aPantalla(r.sg[1]); ctx.globalAlpha = 0.6; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.globalAlpha = 1; }
    }
    function cota(m, col) { // línea de la medida con su etiqueta
      const [ax, ay] = aPantalla(m.a), [bx, by] = aPantalla(m.b);
      ctx.strokeStyle = acento(); ctx.lineWidth = 1.6; if (m.punteada) ctx.setLineDash([5, 3]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      etiqueta(m.texto, (ax + bx) / 2, (ay + by) / 2 - 4, col);
    }
    function dibujarMedidas(col) {
      ctx.save();
      for (const m of med.lista) { (m.refs || []).forEach(r => resaltar(r)); if (m.a) cota(m, col); if (m.etiquetaEn) { const [x, y] = aPantalla(m.etiquetaEn); etiqueta(m.texto, x, y - 6, col); } }
      if (med.a) resaltar(med.a, true);
      if (med.hover) resaltar(med.hover);
      // vista previa mientras se elige la segunda referencia
      if (med.a && med.herramienta === 'orto') { const B = med.hover || (med.cursor && { tipo: 'punto', p: med.cursor }); if (B) { const r = medirOrto(med.a, B); if (!r.error) cota({ ...r, texto: `${fmt(r.d)} ${uni}`, punteada: true }, col); } }
      if (med.a && med.herramienta === 'arista') { const B = med.hover || (med.cursor && { tipo: 'punto', p: med.cursor }); if (B) { const f = pie(med.a.sg, B.p); cota({ a: B.p, b: f, texto: `${fmt(Math.hypot(B.p[0] - f[0], B.p[1] - f[1]))} ${uni} ⟂`, punteada: true }, col); } }
      ctx.restore();
    }
    function ajustar() {
      const w = Math.max(c.x1 - c.x0, 1e-6), h = Math.max(c.y1 - c.y0, 1e-6);
      vista.s = Math.min(W() / w, H() / h) * 0.9; vista.ox = W() / 2 - (c.x0 + w / 2) * vista.s; vista.oy = H() / 2 + (c.y0 + h / 2) * vista.s; dibujar();
    }
    let tocado = false; // mientras el usuario no mueva ni acerque, la pieza se reajusta al tamaño de la ventana
    function zoom(f, cx, cy) { tocado = true; cx = cx == null ? W() / 2 : cx; cy = cy == null ? H() / 2 : cy; vista.ox = cx - (cx - vista.ox) * f; vista.oy = cy - (cy - vista.oy) * f; vista.s *= f; dibujar(); }
    let arrastre = null;
    const coord = datoPie(v, 'Cursor:', '—');
    canvas.addEventListener('pointerdown', e => { arrastre = { x: e.clientX, y: e.clientY, ox: vista.ox, oy: vista.oy, movio: false }; canvas.setPointerCapture(e.pointerId); });
    function avisar(t) { resultado.textContent = t; }
    function registrar(m) { med.lista.push(m); avisar(m.resumen || m.texto); }
    canvas.addEventListener('pointerup', e => {
      const fueClic = arrastre && !arrastre.movio; arrastre = null; canvas.style.cursor = med.herramienta ? 'crosshair' : '';
      if (!fueClic || !med.herramienta) return;
      tocado = true;
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const ref = referencia(mx, my, admiteAhora());
      const h = med.herramienta;
      if (h === 'radio') {
        if (!ref) avisar('Da clic en la orilla de un barreno o sobre un arco.');
        else { const cv = ref.c; registrar({ refs: [ref], etiquetaEn: [cv.c[0] + cv.r * 0.7071, cv.c[1] + cv.r * 0.7071], texto: cv.completo ? `Ø ${fmt(cv.r * 2)} · R ${fmt(cv.r)} ${uni}` : `R ${fmt(cv.r)} ${uni}`,
          resumen: cv.completo ? `Barreno: Ø ${fmt(cv.r * 2)} · R ${fmt(cv.r)} ${uni}` : `Arco: R ${fmt(cv.r)} ${uni}` }); }
      } else if (h === 'longitud') {
        if (!ref) avisar('Da clic sobre una arista recta.');
        else { const [a, b] = ref.sg, d = Math.hypot(b[0] - a[0], b[1] - a[1]); registrar({ refs: [ref], a, b, texto: `${fmt(d)} ${uni}`, resumen: `Longitud de la arista: ${fmt(d)} ${uni}` }); }
      } else if (h === 'orto') {
        if (!ref) avisar('Da clic en la orilla de un barreno, en una esquina o sobre una arista.');
        else if (!med.a) { med.a = ref; avisar('Ahora la segunda referencia: otro barreno, una esquina o una arista.'); }
        else { const res = medirOrto(med.a, ref);
          if (res.error) avisar(res.error);
          else registrar({ refs: [med.a, ref], ...res, texto: `${fmt(res.d)} ${uni}${res.eje === 'horizontal' ? ' ↔' : res.eje === 'vertical' ? ' ↕' : ' ⟂'}`,
            resumen: `${fmt(res.d)} ${uni} en línea recta ${res.eje}${med.a.tipo === 'barreno' && ref.tipo === 'barreno' ? ', entre centros de barrenos' : ''}` });
          med.a = null; }
      } else if (h === 'arista') {
        if (!med.a) { if (ref) { med.a = ref; avisar('Arista elegida. Ahora da clic en la orilla de un barreno o en una esquina.'); } else avisar('Da clic sobre una arista recta.'); }
        else if (!ref) avisar('Da clic en la orilla de un barreno o en una esquina.');
        else { const f = pie(med.a.sg, ref.p), d = Math.hypot(ref.p[0] - f[0], ref.p[1] - f[1]);
          registrar({ refs: [med.a, ref], a: ref.p, b: f, punteada: true, texto: `${fmt(d)} ${uni} ⟂`, resumen: `${fmt(d)} ${uni} perpendicular a la arista` }); med.a = null; }
      }
      dibujar();
    });
    canvas.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      coord.textContent = `X ${fmt((mx - vista.ox) / vista.s)}  Y ${fmt((vista.oy - my) / vista.s)} ${uni}`;
      if (arrastre && Math.hypot(e.clientX - arrastre.x, e.clientY - arrastre.y) > 4) { arrastre.movio = true; canvas.style.cursor = 'grabbing'; }
      if (arrastre && arrastre.movio) { tocado = true; vista.ox = arrastre.ox + e.clientX - arrastre.x; vista.oy = arrastre.oy + e.clientY - arrastre.y; dibujar(); return; }
      if (med.herramienta) { med.hover = referencia(mx, my, admiteAhora()); med.cursor = aMundo(mx, my); dibujar(); }
    });
    canvas.addEventListener('pointerleave', () => { med.hover = null; med.cursor = null; dibujar(); });
    const NOMBRES_2D = { orto: 'Horizontal o vertical', arista: 'Perpendicular a una arista', longitud: 'Longitud de una arista', radio: 'Barreno o radio' };
    const AYUDA_2D = { orto: 'Elige dos referencias: la orilla de un barreno, una esquina o una arista. La medida sale en línea recta, sin ángulo.',
      arista: 'Clic sobre una arista y luego en la orilla de un barreno o en una esquina: da la distancia en ángulo recto a esa arista.',
      longitud: 'Clic sobre una arista recta para conocer su longitud completa.',
      radio: 'Clic en la orilla de un barreno o sobre un arco.' };
    const activo = ['ring-2', 'ring-[#D9480F]', 'dark:ring-[#FFB347]'];
    function elegir(h) {
      med.herramienta = h; med.a = null; med.hover = null;
      menuMedir.etiqueta(h ? `Medir: ${NOMBRES_2D[h]}` : 'Medir');
      menuMedir.boton.classList[h ? 'add' : 'remove'](...activo);
      canvas.style.cursor = h ? 'crosshair' : '';
      ayuda.textContent = h ? AYUDA_2D[h] + ' · Esc cancela la selección.' : 'Arrastra para mover · rueda del mouse para acercar';
      dibujar();
    }
    const menuMedir = menuDesplegable(v, 'Medir', [
      ...Object.keys(NOMBRES_2D).map(k => ({ texto: NOMBRES_2D[k], accion: () => elegir(k) })), '-',
      { texto: 'Borrar medidas', accion: () => { med.lista = []; med.a = null; avisar('—'); dibujar(); } },
      { texto: 'Solo mover la pieza (sin medir)', accion: () => elegir(null) }]);
    v.cancelar = () => { if (med.a) { med.a = null; avisar('Selección cancelada.'); dibujar(); } }; // tecla Esc
    canvas.addEventListener('wheel', e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    const btnCompleta = boton('Ver completa', () => { tocado = false; ajustar(); }, 'Centrar y ver la pieza completa'); btnCompleta.textContent = 'Ver completa';
    setTimeout(() => elegir('orto'), 0); // al abrir, la medida predeterminada es horizontal o vertical
    v.herramientas.append(menuMedir.nodo, boton('−', () => zoom(1 / 1.3), 'Alejar'), boton('+', () => zoom(1.3), 'Acercar'), btnCompleta);
    datoPie(v, 'Medidas:', `${fmt(c.x1 - c.x0)} × ${fmt(c.y1 - c.y0)} ${uni}`);
    datoPie(v, 'Elementos:', String(g.entidades));
    const resultado = datoPie(v, 'Medida:', '—');
    const ayuda = el('span', 'ml-auto min-w-0 truncate', 'Arrastra para mover · rueda del mouse para acercar'); v.pie.append(ayuda);
    const obs = new ResizeObserver(() => { if (tocado) dibujar(); else ajustar(); }); obs.observe(canvas);
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
    const control = new THREE.OrbitControls(camara, renderer.domElement); control.enableDamping = true; control.screenSpacePanning = true;
    function vista(dir) {
      const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize(), dist = radio / Math.sin(THREE.MathUtils.degToRad(camara.fov / 2)) * 1.05;
      camara.position.copy(d.multiplyScalar(dist));
      if (Math.abs(dir[1]) > 0.99) camara.up.set(0, 0, -1); else camara.up.set(0, 1, 0);
      control.target.set(0, 0, 0); control.update();
    }
    const ISO = [1, 0.8, 1.2];
    function verCompleta() { // centra la pieza y la ajusta a la pantalla sin cambiar el ángulo
      const dir = camara.position.clone().sub(control.target); if (dir.lengthSq() < 1e-9) dir.set(...ISO);
      const dist = radio / Math.sin(THREE.MathUtils.degToRad(camara.fov / 2)) * 1.05;
      control.target.set(0, 0, 0); camara.position.copy(dir.normalize().multiplyScalar(dist)); control.update();
    }
    const VISTAS = [['Isométrica', ISO], ['Frente', [0, 0, 1]], ['Atrás', [0, 0, -1]], ['Derecha', [1, 0, 0]], ['Izquierda', [-1, 0, 0]], ['Arriba', [0, 1, 0]], ['Abajo', [0, -1, 0]]];
    const menuVistas = menuDesplegable(v, 'Vista', VISTAS.map(([t, d]) => ({ texto: t, accion: () => { vista(d); menuVistas.etiqueta(`Vista: ${t}`); } })));
    let modoMover = false;
    const btnMover = boton('Mover', () => {
      modoMover = !modoMover;
      control.mouseButtons = modoMover ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE } : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      control.touches = modoMover ? { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE } : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
      btnMover.textContent = modoMover ? 'Modo: mover' : 'Modo: girar';
      btnMover.classList[modoMover ? 'add' : 'remove']('ring-2', 'ring-[#1E4E79]', 'dark:ring-[#7FB2E5]');
      if (!med.herramienta) ayuda.textContent = modoMover ? 'Arrastra para recorrer la pieza · clic derecho para girar · rueda para acercar' : 'Arrastra para girar · clic derecho para recorrer · rueda para acercar';
    }, 'Cambiar entre girar y recorrer la pieza con el mouse');
    btnMover.textContent = 'Modo: girar';
    const btnCompleta = boton('Ver completa', verCompleta, 'Centrar y ver la pieza completa'); btnCompleta.textContent = 'Ver completa';
    v.raiz.__vista3d = { grupo, camara, control }; // solo para pruebas automáticas
    const btnAristas = boton('Aristas', () => { aristas.visible = !aristas.visible; }, 'Mostrar u ocultar las aristas'); btnAristas.textContent = 'Aristas';
    v.herramientas.append(menuVistas.nodo, btnMover, btnCompleta, btnAristas);
    datoPie(v, 'Medidas:', `${fmt(tam.x)} × ${fmt(tam.y)} × ${fmt(tam.z)} mm`);
    datoPie(v, 'Superficies:', String(res.meshes.length));
    datoPie(v, 'Triángulos:', triangulos.toLocaleString('es-MX'));
    /* ----- Medición 3D -----
       Referencias: la orilla circular de un barreno (o una esquina redondeada), una esquina de la pieza,
       una cara plana o una arista recta. Se iluminan al pasar el cursor. */
    const resultado = datoPie(v, 'Medida:', '—');
    const ayuda = el('span', 'ml-auto min-w-0 truncate', 'Arrastra para girar · clic derecho para recorrer · rueda para acercar'); v.pie.append(ayuda);
    const capa = el('div', 'pointer-events-none absolute inset-0 overflow-hidden'); v.lienzo.append(capa);
    const med = { herramienta: 'barreno', a: null, hover: null, objetos: [], etiquetas: [] };
    const colMed = esOscuro() ? 0xffb347 : 0xd9480f;
    const matMed = new THREE.MeshBasicMaterial({ color: colMed, depthTest: false, transparent: true, opacity: 0.95 });
    const matLinea = new THREE.LineBasicMaterial({ color: colMed, depthTest: false });
    const matCara = new THREE.MeshBasicMaterial({ color: colMed, transparent: true, opacity: 0.28, depthTest: false, side: THREE.DoubleSide });
    const texPunto = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
      x.fillStyle = '#' + colMed.toString(16).padStart(6, '0'); x.beginPath(); x.arc(32, 32, 26, 0, Math.PI * 2); x.fill();
      x.lineWidth = 8; x.strokeStyle = esOscuro() ? '#10161D' : '#FFFFFF'; x.stroke(); return new THREE.CanvasTexture(c); })();
    const matPunto = new THREE.PointsMaterial({ size: 11, sizeAttenuation: false, map: texPunto, transparent: true, depthTest: false, alphaTest: 0.1 });
    const geoPunto = null;
    const rayo = new THREE.Raycaster(), raton = new THREE.Vector2();
    const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    // --- datos de la pieza para medir: cilindros (barrenos y radios), caras planas, esquinas y aristas ---
    const cilindros = [], planos = new Map(), esquinas = [], segmentos = [];
    for (const m of grupo.children) {
      const P = m.geometry.attributes.position, N = m.geometry.attributes.normal, pos = [], nor = [];
      for (let i = 0; i < P.count; i++) { const p = new THREE.Vector3().fromBufferAttribute(P, i).add(grupo.position); pos.push(p.x, p.y, p.z); nor.push(N.getX(i), N.getY(i), N.getZ(i)); }
      let plana = true; for (let i = 1; i < N.count && plana; i++) plana = N.getX(0) * N.getX(i) + N.getY(0) * N.getY(i) + N.getZ(0) * N.getZ(i) > 0.9995;
      if (plana) { planos.set(m, { n: V3([N.getX(0), N.getY(0), N.getZ(0)]).normalize(), p0: V3(pos.slice(0, 3)) }); continue; }
      const a = ajustarCilindro(pos, nor); if (a.error) continue;
      const eje = V3(a.eje).normalize(), c = V3(a.centro);
      let hmin = Infinity, hmax = -Infinity;
      for (let i = 0; i < pos.length; i += 3) { const hh = V3(pos.slice(i, i + 3)).sub(c).dot(eje); hmin = Math.min(hmin, hh); hmax = Math.max(hmax, hh); }
      const bordes = [c.clone().add(eje.clone().multiplyScalar(hmin)), c.clone().add(eje.clone().multiplyScalar(hmax))];
      cilindros.push({ malla: m, r: a.r, eje, c, u: V3(a.u), w: V3(a.w), bordes, completo: a.completo, cobertura: a.cobertura });
    }
    { const E = []; aristas.children.forEach(l => { const P = l.geometry.attributes.position; for (let i = 0; i < P.count; i += 2) E.push([new THREE.Vector3().fromBufferAttribute(P, i).add(aristas.position), new THREE.Vector3().fromBufferAttribute(P, i + 1).add(aristas.position)]); });
      const clave = p => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`, vistos = new Set();
      for (const [a, b] of E) { segmentos.push([a, b]); for (const p of [a, b]) { const k = clave(p); if (!vistos.has(k)) { vistos.add(k); esquinas.push(p); } } } }
    // --- pantalla ---
    const rect = () => renderer.domElement.getBoundingClientRect();
    const aPantalla = p => { const q = p.clone().project(camara), r = rect(); return [(q.x + 1) / 2 * r.width, (1 - q.y) / 2 * r.height, q.z]; };
    function circulo(c, u, w, r, n = 48) { const pts = []; for (let i = 0; i <= n; i++) { const t = i / n * Math.PI * 2; pts.push(c.clone().add(u.clone().multiplyScalar(r * Math.cos(t))).add(w.clone().multiplyScalar(r * Math.sin(t)))); } return pts; }
    function distSegPantalla(a, b, mx, my) { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((mx - a[0]) * dx + (my - a[1]) * dy) / l2)) : 0; return Math.hypot(mx - (a[0] + t * dx), my - (a[1] + t * dy)); }
    function bordeCercano(mx, my) { // orilla circular a menos de 9 px
      let mejor = null, dmin = 9;
      for (const cl of cilindros) for (const bc of cl.bordes) {
        const pts = circulo(bc, cl.u, cl.w, cl.r, 32).map(aPantalla);
        if (pts.every(p => p[2] > 1)) continue;
        for (let i = 1; i < pts.length; i++) { const d = distSegPantalla(pts[i - 1], pts[i], mx, my); if (d < dmin) { dmin = d; mejor = { tipo: 'barreno', cl, c: bc }; } }
      }
      return mejor;
    }
    function tocado3d(mx, my) { const r = rect(); raton.set(mx / r.width * 2 - 1, -(my / r.height) * 2 + 1); rayo.setFromCamera(raton, camara); return rayo.intersectObjects(grupo.children, false)[0] || null; }
    function esquinaCercana(mx, my) { let mejor = null, dmin = 8; for (const p of esquinas) { const q = aPantalla(p); if (q[2] > 1) continue; const d = Math.hypot(q[0] - mx, q[1] - my); if (d < dmin) { dmin = d; mejor = p; } } return mejor ? { tipo: 'esquina', p: mejor } : null; }
    function aristaCercana(mx, my) { let mejor = null, dmin = 7; for (const s of segmentos) { const a = aPantalla(s[0]), b = aPantalla(s[1]); if (a[2] > 1 && b[2] > 1) continue; const d = distSegPantalla(a, b, mx, my); if (d < dmin) { dmin = d; mejor = s; } } return mejor ? { tipo: 'arista', sg: mejor } : null; }
    function caraBajo(mx, my) { const hit = tocado3d(mx, my); if (!hit) return null; const pl = planos.get(hit.object); return pl ? { tipo: 'cara', malla: hit.object, n: pl.n, p0: pl.p0 } : null; }
    function referencia(mx, my) {
      const h = med.herramienta;
      if (h === 'barreno' || h === 'entre') return bordeCercano(mx, my) || (() => { const hit = tocado3d(mx, my); const cl = hit && cilindros.find(x => x.malla === hit.object); return cl ? { tipo: 'barreno', cl, c: cl.bordes[0] } : null; })();
      if (h === 'cara') return med.a ? caraBajo(mx, my) : (bordeCercano(mx, my) || esquinaCercana(mx, my));
      if (h === 'longitud') return aristaCercana(mx, my);
      if (h === 'vertices') return esquinaCercana(mx, my);
      return null;
    }
    // --- dibujo ---
    function nuevo(obj) { obj.renderOrder = 10; escena.add(obj); return obj; }
    function linea(pts, mat = matLinea) { return nuevo(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat)); }
    function punto(p) { return nuevo(new THREE.Points(new THREE.BufferGeometry().setFromPoints([p]), matPunto)); } // siempre del mismo tamaño en pantalla
    function figura(r) { // lo que ilumina una referencia
      if (!r) return [];
      if (r.tipo === 'barreno') return [linea(circulo(r.c, r.cl.u, r.cl.w, r.cl.r))];
      if (r.tipo === 'esquina') return [punto(r.p)];
      if (r.tipo === 'arista') return [linea(aristaCompleta(r.sg).pts)];
      if (r.tipo === 'cara') { const m = nuevo(new THREE.Mesh(r.malla.geometry, matCara)); m.position.copy(grupo.position); return [m]; }
      return [];
    }
    function quitar(objs) { for (const o of objs) { escena.remove(o); if (o.geometry && o.geometry !== geoPunto && !(o.material === matCara)) o.geometry.dispose(); } }
    let hoverObjs = [], selObjs = [];
    function ponerHover(r) { quitar(hoverObjs); hoverObjs = figura(r); }
    function etiqueta3d(p, texto) {
      const d = el('div', 'absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-[#D9480F] bg-white/95 px-1.5 py-0.5 text-xs font-semibold text-[#D9480F] dark:border-[#FFB347] dark:bg-[#10161D]/95 dark:text-[#FFB347]', texto);
      capa.append(d); med.etiquetas.push({ d, p: p.clone() });
    }
    function aristaCompleta(sg) { // une los tramos rectos alineados para medir la arista entera
      const dir = sg[1].clone().sub(sg[0]).normalize(), tol = radio * 1e-4;
      const enLinea = p => p.clone().sub(sg[0]).cross(dir).length() < tol * 10;
      let tmin = 0, tmax = sg[1].clone().sub(sg[0]).dot(dir), crecio = true;
      const usados = new Set([sg]);
      while (crecio) { crecio = false;
        for (const s of segmentos) { if (usados.has(s)) continue; const d2 = s[1].clone().sub(s[0]).normalize(); if (Math.abs(d2.dot(dir)) < 0.99995 || !enLinea(s[0])) continue;
          const t0 = s[0].clone().sub(sg[0]).dot(dir), t1 = s[1].clone().sub(sg[0]).dot(dir), a = Math.min(t0, t1), b = Math.max(t0, t1);
          if (a <= tmax + tol && b >= tmin - tol) { tmin = Math.min(tmin, a); tmax = Math.max(tmax, b); usados.add(s); crecio = true; } } }
      const a = sg[0].clone().add(dir.clone().multiplyScalar(tmin)), b = sg[0].clone().add(dir.clone().multiplyScalar(tmax));
      return { a, b, pts: [a, b], largo: tmax - tmin };
    }
    function registrar(objs, etiquetas, texto) { med.objetos.push(...objs); etiquetas.forEach(([p, t]) => etiqueta3d(p, t)); resultado.textContent = texto; }
    function medir(ref) {
      const h = med.herramienta;
      if (h === 'barreno') {
        const cl = ref.cl, tipo = cl.completo ? 'Barreno' : `Radio (arco de ${Math.round(cl.cobertura)}°)`;
        registrar([...figura(ref), punto(ref.c)], [[ref.c, cl.completo ? `Ø ${fmt(cl.r * 2)} · R ${fmt(cl.r)} mm` : `R ${fmt(cl.r)} mm`]], `${tipo}: Ø ${fmt(cl.r * 2)} · R ${fmt(cl.r)} mm`);
      } else if (h === 'longitud') {
        const ac = aristaCompleta(ref.sg);
        registrar([linea(ac.pts), punto(ac.a), punto(ac.b)], [[ac.a.clone().add(ac.b).multiplyScalar(0.5), `${fmt(ac.largo)} mm`]], `Longitud de la arista: ${fmt(ac.largo)} mm`);
      } else if (h === 'vertices') {
        if (!med.a) { med.a = ref; quitar(selObjs); selObjs = figura(ref); resultado.textContent = 'Ahora el segundo vértice.'; return; }
        const A = med.a.p, B = ref.p, d = A.distanceTo(B);
        if (d < 1e-6) { resultado.textContent = 'Elige un vértice distinto.'; return; }
        quitar(selObjs); selObjs = [];
        registrar([linea([A, B]), punto(A), punto(B)], [[A.clone().add(B).multiplyScalar(0.5), `${fmt(d)} mm`]],
          `${fmt(d)} mm entre vértices  (ΔX ${fmt(Math.abs(B.x - A.x))}, ΔY ${fmt(Math.abs(B.y - A.y))}, ΔZ ${fmt(Math.abs(B.z - A.z))})`);
        med.a = null;
      } else if (h === 'entre') {
        if (!med.a) { med.a = ref; quitar(selObjs); selObjs = figura(ref); resultado.textContent = 'Ahora la orilla del segundo barreno.'; return; }
        const A = med.a, B = ref, paralelos = Math.abs(A.cl.eje.dot(B.cl.eje)) > 0.999;
        const d = paralelos ? B.c.clone().sub(A.c).cross(A.cl.eje).length() : A.c.distanceTo(B.c);
        const pb = paralelos ? A.c.clone().add(A.cl.eje.clone().multiplyScalar(B.c.clone().sub(A.c).dot(A.cl.eje))) : A.c;
        quitar(selObjs); selObjs = [];
        registrar([...figura(A), ...figura(B), linea([pb, B.c]), punto(pb), punto(B.c)], [[pb.clone().add(B.c).multiplyScalar(0.5), `${fmt(d)} mm`]],
          `${fmt(d)} mm entre ${paralelos ? 'ejes' : 'centros'} de los barrenos (Ø ${fmt(A.cl.r * 2)} y Ø ${fmt(B.cl.r * 2)})`);
        med.a = null;
      } else if (h === 'cara') {
        if (!med.a) { med.a = ref; quitar(selObjs); selObjs = figura(ref); resultado.textContent = 'Ahora da clic en la cara plana de referencia.'; return; }
        const P = med.a.tipo === 'barreno' ? med.a.c : med.a.p, n = ref.n, d = P.clone().sub(ref.p0).dot(n), pie = P.clone().sub(n.clone().multiplyScalar(d));
        const perpendicular = med.a.tipo !== 'barreno' || Math.abs(med.a.cl.eje.dot(n)) < 0.01;
        quitar(selObjs); selObjs = [];
        registrar([...figura(med.a), linea([P, pie]), punto(P), punto(pie)], [[P.clone().add(pie).multiplyScalar(0.5), `${fmt(Math.abs(d))} mm ⟂`]],
          `${fmt(Math.abs(d))} mm del ${med.a.tipo === 'barreno' ? (perpendicular ? 'eje del barreno' : 'centro de la orilla del barreno') : 'punto'} a la cara`);
        med.a = null;
      }
    }
    let presion = null;
    renderer.domElement.addEventListener('pointerdown', ev => { presion = { x: ev.clientX, y: ev.clientY }; });
    renderer.domElement.addEventListener('pointerup', ev => {
      if (!med.herramienta || !presion || Math.hypot(ev.clientX - presion.x, ev.clientY - presion.y) > 5 || ev.button !== 0) return;
      const r = rect(), ref = referencia(ev.clientX - r.left, ev.clientY - r.top);
      if (!ref) { resultado.textContent = { barreno: 'Da clic en la orilla de un barreno o en una esquina redondeada.', entre: 'Da clic en la orilla circular de un barreno.', cara: med.a ? 'Da clic sobre una cara plana.' : 'Da clic en la orilla de un barreno o en una esquina de la pieza.', vertices: 'Da clic justo sobre un vértice (esquina) de la pieza.', longitud: 'Da clic sobre una arista recta.' }[med.herramienta]; return; }
      medir(ref);
    });
    let pendienteHover = false;
    renderer.domElement.addEventListener('pointermove', ev => {
      if (!med.herramienta || ev.buttons || pendienteHover) return;
      pendienteHover = true;
      requestAnimationFrame(() => { pendienteHover = false; const r = rect(); med.hover = referencia(ev.clientX - r.left, ev.clientY - r.top); ponerHover(med.hover); });
    });
    renderer.domElement.addEventListener('pointerleave', () => { med.hover = null; ponerHover(null); });
    function borrarMedidas() {
      quitar(med.objetos); quitar(selObjs); selObjs = []; med.etiquetas.forEach(e => e.d.remove());
      med.objetos = []; med.etiquetas = []; med.a = null; resultado.textContent = '—';
    }
    const NOMBRES_3D = { barreno: 'Barreno o radio', entre: 'Distancia entre barrenos', cara: 'Barreno o esquina a una cara', vertices: 'De un vértice a otro', longitud: 'Longitud de una arista' };
    const AYUDA_3D = { barreno: 'Pasa el cursor por la orilla de un barreno: se ilumina. Da clic para ver su diámetro o radio.',
      entre: 'Clic en la orilla de un barreno y luego en la de otro: da la distancia entre sus ejes.',
      cara: 'Clic en la orilla de un barreno o en una esquina, y luego en una cara plana: da la distancia perpendicular.',
      vertices: 'Clic en un vértice (esquina) y luego en otro, por ejemplo dos esquinas de una misma cara.',
      longitud: 'Pasa el cursor por una arista recta: se ilumina completa. Da clic para ver su longitud.' };
    const activo = ['ring-2', 'ring-[#D9480F]', 'dark:ring-[#FFB347]'];
    function elegir(h) {
      med.herramienta = h; med.a = null; quitar(selObjs); selObjs = []; ponerHover(null);
      menuMedir.etiqueta(h ? `Medir: ${NOMBRES_3D[h]}` : 'Medir');
      menuMedir.boton.classList[h ? 'add' : 'remove'](...activo);
      renderer.domElement.style.cursor = h ? 'crosshair' : '';
      ayuda.textContent = h ? `${AYUDA_3D[h]} · Esc cancela la selección.` : (modoMover ? 'Arrastra para recorrer la pieza · clic derecho para girar · rueda para acercar' : 'Arrastra para girar · clic derecho para recorrer · rueda para acercar');
    }
    const menuMedir = menuDesplegable(v, 'Medir', [...Object.keys(NOMBRES_3D).map(k => ({ texto: NOMBRES_3D[k], accion: () => elegir(k) })), '-',
      { texto: 'Borrar medidas', accion: borrarMedidas }, { texto: 'Solo mover la pieza (sin medir)', accion: () => elegir(null) }]);
    v.herramientas.prepend(menuMedir.nodo);
    setTimeout(() => elegir('barreno'), 0);
    Object.assign(v.raiz.__vista3d, { cilindros, segmentos, med }); // solo para pruebas automáticas
    v.cancelar = () => { if (med.a) { med.a = null; quitar(selObjs); selObjs = []; resultado.textContent = 'Selección cancelada.'; } }; // tecla Esc
    function moverEtiquetas() {
      const w = v.lienzo.clientWidth, h = v.lienzo.clientHeight;
      for (const e of med.etiquetas) { const q = e.p.clone().project(camara); e.d.style.left = `${(q.x + 1) / 2 * w}px`; e.d.style.top = `${(1 - q.y) / 2 * h - 6}px`; e.d.style.display = q.z < 1 ? '' : 'none'; }
    }
    function tamano() { const w = v.lienzo.clientWidth, h = v.lienzo.clientHeight; renderer.setSize(w, h, false); camara.aspect = w / Math.max(h, 1); camara.updateProjectionMatrix(); }
    const obs = new ResizeObserver(tamano); obs.observe(v.lienzo); tamano(); vista(ISO);
    let vivo = true;
    (function ciclo() { if (!vivo) return; control.update(); luz.position.copy(camara.position); renderer.render(escena, camara); moverEtiquetas(); requestAnimationFrame(ciclo); })();
    v.limpiar = () => {
      vivo = false; obs.disconnect(); control.dispose();
      grupo.children.forEach(o => o.geometry.dispose()); aristas.children.forEach(o => o.geometry.dispose());
      borrarMedidas(); quitar(hoverObjs); matPunto.dispose(); texPunto.dispose(); matMed.dispose(); matLinea.dispose(); matCara.dispose();
      material.dispose(); matArista.dispose(); renderer.dispose();
    };
  }


  /* ---------- E2. Comparador de versiones ----------
     Dibuja las dos versiones encimadas: gris lo que no cambió, rojo lo que se quitó y verde lo que se agregó. */
  const COL_QUITADO = '#D92D20', COL_AGREGADO = '#12B76A';
  function claveSeg(p, q, dec) { // un tramo, sin importar su sentido, redondeado a 0.01
    const a = p.map(x => Math.round(x * dec)), b = q.map(x => Math.round(x * dec));
    return a.join(',') < b.join(',') ? `${a}|${b}` : `${b}|${a}`;
  }
  function diferencias(segsA, segsB) {
    const iguales = [], quitados = [], agregados = [];
    for (const [k, s] of segsB) (segsA.has(k) ? iguales : agregados).push(s);
    for (const [k, s] of segsA) if (!segsB.has(k)) quitados.push(s);
    return { iguales, quitados, agregados };
  }
  function leyendaComparar(v, etA, etB, dif, unidad, cajaA, cajaB, dim) {
    v.pie.innerHTML = '';
    const resumen = !dif.quitados.length && !dif.agregados.length ? 'Sin diferencias en la geometría' : 'Hay diferencias en la geometría';
    const p = el('span', 'font-semibold text-[#1B2430] dark:text-[#E6EAEF]', resumen); v.pie.append(p);
    const leyenda = (color, texto) => { const s = el('span', 'inline-flex items-center gap-1.5'); const c = el('span', 'inline-block h-0.5 w-5'); c.style.background = color; s.append(c, el('span', '', texto)); v.pie.append(s); };
    leyenda(COL_QUITADO, `Se quitó (solo en ${etA})`); leyenda(COL_AGREGADO, `Se agregó (solo en ${etB})`); leyenda('#98A2B3', 'Sin cambio');
    if ((dif.quitados.length || dif.agregados.length) && dim.length === 2) leyenda('rgba(250, 176, 5, 0.9)', 'Zona con cambios');
    const med = c => dim.map(k => fmt(c[k + '1'] - c[k + '0'])).join(' × ');
    datoPie(v, `Medidas ${etA}:`, `${med(cajaA)} ${unidad}`); datoPie(v, `${etB}:`, `${med(cajaB)} ${unidad}`);
  }
  async function compararDxf(v, bA, bB, etA, etB) {
    await cargarScript(CDN.dxf);
    const leer = b => { const dxf = new window.DxfParser().parseSync(new TextDecoder('latin1').decode(b)); return { dxf, g: geometriaDxf(dxf) }; };
    const A = leer(bA), B = leer(bB);
    if (!A.g.caja || !B.g.caja) throw new Error('Alguna de las dos versiones no tiene líneas que dibujar.');
    const uni = UNIDADES[B.dxf.header && B.dxf.header.$INSUNITS] || 'mm';
    const segs = g => { const m = new Map(); for (const t of g.trazos) for (let i = 1; i < t.length; i++) { const k = claveSeg(t[i - 1], t[i], 100); if (!m.has(k)) m.set(k, [t[i - 1], t[i]]); } return m; };
    const dif = diferencias(segs(A.g), segs(B.g));
    const c = { x0: Math.min(A.g.caja.x0, B.g.caja.x0), y0: Math.min(A.g.caja.y0, B.g.caja.y0), x1: Math.max(A.g.caja.x1, B.g.caja.x1), y1: Math.max(A.g.caja.y1, B.g.caja.y1) };
    v.lienzo.innerHTML = '';
    const canvas = el('canvas', 'absolute inset-0 h-full w-full cursor-grab touch-none'); v.lienzo.append(canvas);
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `Comparación de ${etA} contra ${etB}`);
    const ctx = canvas.getContext('2d'), vista = { s: 1, ox: 0, oy: 0 }, W = () => canvas.clientWidth, H = () => canvas.clientHeight;
    let modo = 'cambios';
    function trazar(lista, color, ancho) {
      ctx.strokeStyle = color; ctx.lineWidth = ancho; ctx.beginPath();
      for (const [p, q] of lista) { ctx.moveTo(p[0] * vista.s + vista.ox, -p[1] * vista.s + vista.oy); ctx.lineTo(q[0] * vista.s + vista.ox, -q[1] * vista.s + vista.oy); }
      ctx.stroke();
    }
    function dibujar() {
      const dpr = window.devicePixelRatio || 1, col = colores();
      if (canvas.width !== Math.round(W() * dpr) || canvas.height !== Math.round(H() * dpr)) { canvas.width = Math.round(W() * dpr); canvas.height = Math.round(H() * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = col.fondo; ctx.fillRect(0, 0, W(), H()); ctx.lineCap = 'round';
      if (modo === 'cambios') {
        // halo alrededor de cada zona con cambios, para encontrarlas aunque sean pequeñas
        const zonas = new Map();
        for (const [p, q] of [...dif.quitados, ...dif.agregados]) {
          const x = ((p[0] + q[0]) / 2) * vista.s + vista.ox, y = -((p[1] + q[1]) / 2) * vista.s + vista.oy, k = `${Math.round(x / 30)},${Math.round(y / 30)}`;
          if (!zonas.has(k)) zonas.set(k, [x, y]);
        }
        ctx.fillStyle = 'rgba(250, 176, 5, 0.22)'; ctx.strokeStyle = 'rgba(250, 176, 5, 0.9)'; ctx.lineWidth = 1.5;
        for (const [x, y] of zonas.values()) { ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
        trazar(dif.iguales, '#98A2B3', 1.1); trazar(dif.quitados, COL_QUITADO, 2.2); trazar(dif.agregados, COL_AGREGADO, 2.2);
      }
      else if (modo === 'anterior') trazar([...dif.iguales, ...dif.quitados], col.tinta, 1.3);
      else trazar([...dif.iguales, ...dif.agregados], col.tinta, 1.3);
    }
    function ajustar() {
      const w = Math.max(c.x1 - c.x0, 1e-6), hh = Math.max(c.y1 - c.y0, 1e-6);
      vista.s = Math.min((W() - 60) / w, (H() - 60) / hh);
      vista.ox = W() / 2 - (c.x0 + w / 2) * vista.s; vista.oy = H() / 2 + (c.y0 + hh / 2) * vista.s; dibujar();
    }
    let arrastre = null;
    canvas.addEventListener('pointerdown', ev => { arrastre = { x: ev.clientX, y: ev.clientY, ox: vista.ox, oy: vista.oy }; canvas.setPointerCapture(ev.pointerId); });
    canvas.addEventListener('pointermove', ev => { if (!arrastre) return; vista.ox = arrastre.ox + ev.clientX - arrastre.x; vista.oy = arrastre.oy + ev.clientY - arrastre.y; dibujar(); });
    canvas.addEventListener('pointerup', () => { arrastre = null; });
    canvas.addEventListener('wheel', ev => { ev.preventDefault(); const r = canvas.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top, f = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
      vista.ox = mx - (mx - vista.ox) * f; vista.oy = my - (my - vista.oy) * f; vista.s *= f; dibujar(); }, { passive: false });
    const ro = new ResizeObserver(() => dibujar()); ro.observe(canvas);
    const botones = {};
    const elegir = m => { modo = m; for (const [k, b] of Object.entries(botones)) b.setAttribute('aria-pressed', String(k === m)); dibujar(); };
    botones.cambios = boton('Cambios', () => elegir('cambios')); botones.anterior = boton(`Solo ${etA}`, () => elegir('anterior')); botones.vigente = boton(`Solo ${etB}`, () => elegir('vigente'));
    v.herramientas.append(botones.cambios, botones.anterior, botones.vigente, boton('Ver completa', ajustar));
    botones.cambios.setAttribute('aria-pressed', 'true');
    leyendaComparar(v, etA, etB, dif, uni, A.g.caja, B.g.caja, ['x', 'y']);
    v.limpiar = () => ro.disconnect(); v.cancelar = () => {};
    v.__comparacion = { quitados: dif.quitados.length, agregados: dif.agregados.length, iguales: dif.iguales.length };
    requestAnimationFrame(ajustar);
  }
  async function compararIges(v, bA, bB, etA, etB) {
    mensaje(v, 'Preparando el visor 3D…');
    await cargarScript(CDN.three); await cargarScript(CDN.orbit);
    const occt = await motorOcct(); if (actual !== v) return;
    mensaje(v, 'Leyendo las dos versiones…'); await new Promise(r => setTimeout(r, 30));
    const leer = b => { const r = occt.ReadIgesFile(b, null); if (!r || !r.success || !r.meshes.length) throw new Error('No se pudo leer alguna de las dos versiones.'); return r.meshes; };
    const mA = leer(bA), mB = leer(bB), THREE = window.THREE, col = colores();
    const geos = ms => ms.map(m => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(m.attributes.position.array, 3)); g.setIndex(Array.from(m.index.array)); g.computeVertexNormals(); return g; });
    const gA = geos(mA), gB = geos(mB);
    const segs = gs => { const m = new Map(); for (const g of gs) { const p = new THREE.EdgesGeometry(g, 25).attributes.position.array;
      for (let i = 0; i < p.length; i += 6) { const a = [p[i], p[i + 1], p[i + 2]], b = [p[i + 3], p[i + 4], p[i + 5]], k = claveSeg(a, b, 20); if (!m.has(k)) m.set(k, [a, b]); } } return m; };
    const dif = diferencias(segs(gA), segs(gB));
    const caja = gs => { const bb = new THREE.Box3(); for (const g of gs) { g.computeBoundingBox(); bb.union(g.boundingBox); } return { x0: bb.min.x, x1: bb.max.x, y0: bb.min.y, y1: bb.max.y, z0: bb.min.z, z1: bb.max.z, bb }; };
    const cA = caja(gA), cB = caja(gB), total = cA.bb.clone().union(cB.bb);
    v.lienzo.innerHTML = '';
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.domElement.className = 'absolute inset-0 h-full w-full'; v.lienzo.append(renderer.domElement);
    const escena = new THREE.Scene(); escena.background = new THREE.Color(col.fondo);
    escena.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.9)); const luz = new THREE.DirectionalLight(0xffffff, 0.6); escena.add(luz);
    const matPieza = new THREE.MeshStandardMaterial({ color: col.pieza, metalness: 0.2, roughness: 0.7, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    const piezaB = new THREE.Group(); gB.forEach(g => piezaB.add(new THREE.Mesh(g, matPieza))); escena.add(piezaB);
    const lineas = (lista, color) => { const arr = new Float32Array(lista.length * 6); lista.forEach(([a, b], i) => arr.set([...a, ...b], i * 6));
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3)); return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color })); };
    const lIg = lineas(dif.iguales, 0x98A2B3), lQu = lineas(dif.quitados, 0xD92D20), lAg = lineas(dif.agregados, 0x12B76A);
    escena.add(lIg, lQu, lAg);
    const centro = total.getCenter(new THREE.Vector3()), radio = Math.max(total.getSize(new THREE.Vector3()).length() / 2, 1);
    const camara = new THREE.PerspectiveCamera(40, 1, radio / 100, radio * 100);
    const control = new THREE.OrbitControls(camara, renderer.domElement); control.target.copy(centro);
    const ajustar = () => { camara.position.copy(centro).add(new THREE.Vector3(1, 0.8, 1.2).normalize().multiplyScalar(radio * 2.6)); camara.up.set(0, 1, 0); control.update(); };
    const tam = () => { const w = v.lienzo.clientWidth, h = v.lienzo.clientHeight; renderer.setSize(w, h, false); camara.aspect = w / Math.max(h, 1); camara.updateProjectionMatrix(); };
    const ro = new ResizeObserver(tam); ro.observe(v.lienzo); tam(); ajustar();
    let vivo = true; (function ciclo() { if (!vivo) return; luz.position.copy(camara.position); renderer.render(escena, camara); requestAnimationFrame(ciclo); })();
    const botones = {};
    const elegir = m => { lIg.visible = true; lQu.visible = m !== 'vigente'; lAg.visible = m !== 'anterior';
      lIg.material.color.set(m === 'cambios' ? 0x98A2B3 : col.arista); for (const [k, b] of Object.entries(botones)) b.setAttribute('aria-pressed', String(k === m)); };
    botones.cambios = boton('Cambios', () => elegir('cambios')); botones.anterior = boton(`Solo ${etA}`, () => elegir('anterior')); botones.vigente = boton(`Solo ${etB}`, () => elegir('vigente'));
    const btnPieza = boton('Pieza', () => { piezaB.visible = !piezaB.visible; btnPieza.setAttribute('aria-pressed', String(piezaB.visible)); }); btnPieza.setAttribute('aria-pressed', 'true');
    v.herramientas.append(botones.cambios, botones.anterior, botones.vigente, btnPieza, boton('Ver completa', ajustar));
    botones.cambios.setAttribute('aria-pressed', 'true');
    leyendaComparar(v, etA, etB, dif, 'mm', cA, cB, ['x', 'y', 'z']);
    v.cancelar = () => {};
    v.__comparacion = { quitados: dif.quitados.length, agregados: dif.agregados.length, iguales: dif.iguales.length };
    v.limpiar = () => { vivo = false; ro.disconnect(); control.dispose(); renderer.dispose(); [...gA, ...gB].forEach(g => g.dispose()); };
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
    /* E2. Compara dos versiones de la misma pieza */
    async comparar({ nombre, subtitulo, etiquetaA, etiquetaB, obtenerA, obtenerB }) {
      const v = armarVentana(nombre, subtitulo);
      mensaje(v, 'Descargando las dos versiones…');
      try {
        const [bA, bB] = await Promise.all([obtenerA(), obtenerB()]);
        if (actual !== v) return;
        const tipo = tipoDe(nombre);
        if (tipo === 'dxf') { mensaje(v, 'Comparando…'); await compararDxf(v, bA, bB, etiquetaA, etiquetaB); }
        else if (tipo === 'igs' || tipo === 'iges') await compararIges(v, bA, bB, etiquetaA, etiquetaB);
        else throw new Error('Solo se pueden comparar archivos DXF e IGES.');
      } catch (e) { if (actual === v) mensaje(v, e.message || String(e), true); }
    },
    cerrar
  };
})();
