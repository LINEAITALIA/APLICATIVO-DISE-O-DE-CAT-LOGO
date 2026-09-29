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
    /* ----- Medición: distancia (2 clics, se pega a esquinas y centros) y radio (1 clic en círculo o arco) ----- */
    const med = { herramienta: null, lista: [], pendiente: null, cursor: null, iman: null };
    v.raiz.__vista2d = vista; // solo para pruebas automáticas
    const acento = () => esOscuro() ? '#FFB347' : '#D9480F';
    const aPantalla = p => [p[0] * vista.s + vista.ox, -p[1] * vista.s + vista.oy];
    const aMundo = (mx, my) => [(mx - vista.ox) / vista.s, (vista.oy - my) / vista.s];
    function iman(mx, my) { // punto notable más cercano a menos de 12 px
      let mejor = null, dmin = 12;
      for (const p of g.puntos) { const [x, y] = aPantalla(p), d = Math.hypot(x - mx, y - my); if (d < dmin) { dmin = d; mejor = p; } }
      return mejor;
    }
    function segmentoCercano(mx, my) { // arista recta más cercana a menos de 8 px
      let mejor = null, dmin = 8;
      for (const sg of g.segmentos) {
        const [ax, ay] = aPantalla(sg[0]), [bx, by] = aPantalla(sg[1]), dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((mx - ax) * dx + (my - ay) * dy) / l2)) : 0, d = Math.hypot(mx - (ax + t * dx), my - (ay + t * dy));
        if (d < dmin) { dmin = d; mejor = sg; }
      }
      return mejor;
    }
    function pieDePerpendicular(sg, p) { // punto de la recta de la arista más cercano a p
      const [a, b] = sg, dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
      return [a[0] + t * dx, a[1] + t * dy];
    }
    function puntoOrto(a, p) { // horizontal o vertical, según el eje con más recorrido
      return Math.abs(p[0] - a[0]) >= Math.abs(p[1] - a[1]) ? [p[0], a[1]] : [a[0], p[1]];
    }
    function curvaCercana(mx, my) {
      const w = aMundo(mx, my); let mejor = null, dmin = 10 / vista.s;
      for (const cv of g.curvas) { const d = Math.abs(Math.hypot(w[0] - cv.c[0], w[1] - cv.c[1]) - cv.r); if (d < dmin) { dmin = d; mejor = cv; } }
      return mejor;
    }
    function etiqueta(texto, x, y, col) {
      ctx.font = '600 12px system-ui, sans-serif';
      const w = ctx.measureText(texto).width + 10;
      ctx.fillStyle = col.fondo; ctx.globalAlpha = 0.92; ctx.fillRect(x - w / 2, y - 18, w, 18); ctx.globalAlpha = 1;
      ctx.strokeStyle = acento(); ctx.lineWidth = 1; ctx.strokeRect(x - w / 2, y - 18, w, 18);
      ctx.fillStyle = acento(); ctx.textAlign = 'center'; ctx.fillText(texto, x, y - 5); ctx.textAlign = 'start';
    }
    function marca(p) { const [x, y] = aPantalla(p); ctx.strokeStyle = acento(); ctx.lineWidth = 1.5; ctx.strokeRect(x - 4, y - 4, 8, 8); }
    function dibujarMedidas(col) {
      ctx.save();
      for (const m of med.lista) {
        ctx.strokeStyle = acento(); ctx.lineWidth = 1.8; ctx.setLineDash([]);
        if (m.tipo === 'arista') { // arista resaltada y perpendicular punteada hasta el punto
          const [sx, sy] = aPantalla(m.sg[0]), [ex, ey] = aPantalla(m.sg[1]);
          ctx.lineWidth = 3; ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = 1.8;
        }
        if (m.tipo === 'dist' || m.tipo === 'orto' || m.tipo === 'arista') {
          const [ax, ay] = aPantalla(m.a), [bx, by] = aPantalla(m.b);
          if (m.tipo === 'arista') ctx.setLineDash([5, 3]);
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]); marca(m.a); marca(m.b);
          etiqueta(`${fmt(m.d)} ${uni}${m.tipo === 'orto' ? (m.eje === 'X' ? ' ↔' : ' ↕') : m.tipo === 'arista' ? ' ⟂' : ''}`, (ax + bx) / 2, (ay + by) / 2 - 4, col);
        } else {
          const [cx, cy] = aPantalla(m.c.c);
          ctx.beginPath(); ctx.arc(cx, cy, m.c.r * vista.s, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + m.c.r * vista.s * 0.7071, cy - m.c.r * vista.s * 0.7071); ctx.stroke();
          etiqueta(`R ${fmt(m.c.r)} · Ø ${fmt(m.c.r * 2)} ${uni}`, cx + m.c.r * vista.s * 0.7071, cy - m.c.r * vista.s * 0.7071 - 4, col);
        }
      }
      if (med.herramienta === 'arista' && !med.arista && med.cursorSeg) { const [sx, sy] = aPantalla(med.cursorSeg[0]), [ex, ey] = aPantalla(med.cursorSeg[1]); ctx.strokeStyle = acento(); ctx.lineWidth = 3; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke(); ctx.globalAlpha = 1; }
      if (med.herramienta === 'arista' && med.arista && med.cursor) {
        const pie = pieDePerpendicular(med.arista, med.cursor), [sx, sy] = aPantalla(med.arista[0]), [ex, ey] = aPantalla(med.arista[1]), [ax, ay] = aPantalla(med.cursor), [bx, by] = aPantalla(pie);
        ctx.strokeStyle = acento(); ctx.lineWidth = 3; ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
        etiqueta(`${fmt(Math.hypot(med.cursor[0] - pie[0], med.cursor[1] - pie[1]))} ${uni} ⟂`, (ax + bx) / 2, (ay + by) / 2 - 4, col);
      }
      if ((med.herramienta === 'dist' || med.herramienta === 'orto') && med.pendiente && med.cursor) { // línea elástica mientras se elige el segundo punto
        if (med.herramienta === 'orto') med.cursor = puntoOrto(med.pendiente, med.cursor);
        const [ax, ay] = aPantalla(med.pendiente), [bx, by] = aPantalla(med.cursor);
        ctx.strokeStyle = acento(); ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
        marca(med.pendiente); etiqueta(`${fmt(Math.hypot(med.cursor[0] - med.pendiente[0], med.cursor[1] - med.pendiente[1]))} ${uni}`, (ax + bx) / 2, (ay + by) / 2 - 4, col);
      }
      if (med.herramienta && med.iman) marca(med.iman);
      if (med.herramienta === 'radio' && med.cursorCurva) { const [cx, cy] = aPantalla(med.cursorCurva.c); ctx.strokeStyle = acento(); ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(cx, cy, med.cursorCurva.r * vista.s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
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
    canvas.addEventListener('pointerup', e => {
      const fueClic = arrastre && !arrastre.movio; arrastre = null; canvas.style.cursor = med.herramienta ? 'crosshair' : '';
      if (!fueClic || !med.herramienta) return;
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      if (med.herramienta === 'dist' || med.herramienta === 'orto') {
        let p = iman(mx, my) || aMundo(mx, my);
        if (!med.pendiente) { med.pendiente = p; resultado.textContent = 'Ahora el segundo punto…'; }
        else {
          const a = med.pendiente;
          if (med.herramienta === 'orto') {
            p = puntoOrto(a, p); const eje = p[1] === a[1] ? 'X' : 'Y', d = Math.abs(eje === 'X' ? p[0] - a[0] : p[1] - a[1]);
            med.lista.push({ tipo: 'orto', a, b: p, d, eje }); resultado.textContent = `${fmt(d)} ${uni} en línea recta ${eje === 'X' ? 'horizontal' : 'vertical'}`;
          } else {
            const d = Math.hypot(p[0] - a[0], p[1] - a[1]);
            med.lista.push({ tipo: 'dist', a, b: p, d }); resultado.textContent = `${fmt(d)} ${uni}  (ΔX ${fmt(Math.abs(p[0] - a[0]))}, ΔY ${fmt(Math.abs(p[1] - a[1]))})`;
          }
          med.pendiente = null;
        }
      } else if (med.herramienta === 'arista') {
        if (!med.arista) { const sg = segmentoCercano(mx, my); if (sg) { med.arista = sg; resultado.textContent = 'Arista elegida. Ahora da clic en el punto a medir (se pega a centros de barrenos).'; } else resultado.textContent = 'Da clic justo sobre una línea recta del dibujo.'; }
        else { const p = iman(mx, my) || aMundo(mx, my), pie = pieDePerpendicular(med.arista, p), d = Math.hypot(p[0] - pie[0], p[1] - pie[1]);
          med.lista.push({ tipo: 'arista', sg: med.arista, a: p, b: pie, d }); med.arista = null; resultado.textContent = `${fmt(d)} ${uni} perpendicular a la arista`; }
      } else {
        const cv = curvaCercana(mx, my);
        if (cv) { med.lista.push({ tipo: 'radio', c: cv }); resultado.textContent = `R ${fmt(cv.r)} · Ø ${fmt(cv.r * 2)} ${uni}${cv.completo ? ' (barreno)' : ' (arco)'}`; }
        else resultado.textContent = 'Da clic justo sobre la línea de un círculo o un arco.';
      }
      dibujar();
    });
    canvas.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      coord.textContent = `X ${fmt((mx - vista.ox) / vista.s)}  Y ${fmt((vista.oy - my) / vista.s)} ${uni}`;
      if (arrastre && Math.hypot(e.clientX - arrastre.x, e.clientY - arrastre.y) > 4) { arrastre.movio = true; canvas.style.cursor = 'grabbing'; }
      if (arrastre && arrastre.movio) { tocado = true; vista.ox = arrastre.ox + e.clientX - arrastre.x; vista.oy = arrastre.oy + e.clientY - arrastre.y; dibujar(); return; }
      if (med.herramienta) {
        med.iman = med.herramienta === 'dist' || med.herramienta === 'orto' || (med.herramienta === 'arista' && med.arista) ? iman(mx, my) : null;
        med.cursor = med.iman || aMundo(mx, my);
        med.cursorSeg = med.herramienta === 'arista' && !med.arista ? segmentoCercano(mx, my) : null;
        med.cursorCurva = med.herramienta === 'radio' ? curvaCercana(mx, my) : null;
        dibujar();
      }
    });
    // Botones de medición
    const NOMBRES_2D = { dist: 'Distancia libre', orto: 'Horizontal o vertical', arista: 'Perpendicular a una arista', radio: 'Radio o diámetro' };
    const AYUDA_2D = { dist: 'Clic en el primer punto y luego en el segundo. Se pega a esquinas y centros de barrenos.',
      orto: 'Clic en dos puntos: la medida sale en línea recta, sin ángulo (horizontal o vertical, la que tenga más recorrido).',
      arista: 'Clic sobre una arista recta y luego en el punto a medir: da la distancia perpendicular a esa arista.',
      radio: 'Clic sobre la línea de un círculo o arco.' };
    const activo = ['ring-2', 'ring-[#D9480F]', 'dark:ring-[#FFB347]'];
    function elegir(h) {
      med.herramienta = h; med.pendiente = null; med.arista = null; med.iman = null; med.cursorCurva = null; med.cursorSeg = null;
      menuMedir.etiqueta(h ? `Medir: ${NOMBRES_2D[h]}` : 'Medir');
      menuMedir.boton.classList[h ? 'add' : 'remove'](...activo);
      canvas.style.cursor = h ? 'crosshair' : '';
      ayuda.textContent = h ? AYUDA_2D[h] : 'Arrastra para mover · rueda del mouse para acercar';
      dibujar();
    }
    const menuMedir = menuDesplegable(v, 'Medir', [
      ...Object.keys(NOMBRES_2D).map(k => ({ texto: NOMBRES_2D[k], accion: () => elegir(k) })), '-',
      { texto: 'Borrar medidas', accion: () => { med.lista = []; med.pendiente = null; med.arista = null; resultado.textContent = '—'; dibujar(); } },
      { texto: 'Salir de medición', accion: () => elegir(null) }]);
    canvas.addEventListener('wheel', e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    const btnCompleta = boton('Ver completa', () => { tocado = false; ajustar(); }, 'Centrar y ver la pieza completa'); btnCompleta.textContent = 'Ver completa';
    v.herramientas.append(menuMedir.nodo, boton('−', () => zoom(1 / 1.3), 'Alejar'), boton('+', () => zoom(1.3), 'Acercar'), btnCompleta);
    datoPie(v, 'Medidas:', `${fmt(c.x1 - c.x0)} × ${fmt(c.y1 - c.y0)} ${uni}`);
    datoPie(v, 'Elementos:', String(g.entidades));
    const resultado = datoPie(v, 'Medida:', '—');
    const ayuda = el('span', 'ml-auto', 'Arrastra para mover · rueda del mouse para acercar'); v.pie.append(ayuda);
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
    /* ----- Medición 3D: distancia (2 clics) y radio (3 clics sobre un borde curvo). Se pega a los vértices. ----- */
    const resultado = datoPie(v, 'Medida:', '—');
    const ayuda = el('span', 'ml-auto', 'Arrastra para girar · clic derecho para recorrer · rueda para acercar'); v.pie.append(ayuda);
    const capa = el('div', 'pointer-events-none absolute inset-0 overflow-hidden'); v.lienzo.append(capa);
    const med = { herramienta: null, puntos: [], objetos: [], etiquetas: [] };
    const colMed = esOscuro() ? 0xffb347 : 0xd9480f;
    const matMed = new THREE.MeshBasicMaterial({ color: colMed, depthTest: false });
    const matLinea = new THREE.LineBasicMaterial({ color: colMed, depthTest: false });
    const geoPunto = new THREE.SphereGeometry(radio * 0.008, 12, 8);
    const rayo = new THREE.Raycaster(), raton = new THREE.Vector2();
    function puntoEn(ev) {
      const r = renderer.domElement.getBoundingClientRect();
      raton.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      rayo.setFromCamera(raton, camara);
      const hit = rayo.intersectObjects(grupo.children, false)[0]; if (!hit) return null;
      // pegarse al vértice más cercano del triángulo tocado si está a menos de 14 px
      const pos = hit.object.geometry.attributes.position, idx = [hit.face.a, hit.face.b, hit.face.c];
      let mejor = hit.point.clone(), dmin = 14;
      for (const i of idx) {
        const w = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(hit.object.matrixWorld);
        const s2 = w.clone().project(camara), px = (s2.x + 1) / 2 * r.width, py = (1 - s2.y) / 2 * r.height;
        const d = Math.hypot(px - (ev.clientX - r.left), py - (ev.clientY - r.top)); if (d < dmin) { dmin = d; mejor = w; }
      }
      return mejor;
    }
    function ponerPunto(p) { const m = new THREE.Mesh(geoPunto, matMed); m.position.copy(p); m.renderOrder = 10; escena.add(m); med.objetos.push(m); }
    function ponerLinea(ps) { const g2 = new THREE.BufferGeometry().setFromPoints(ps); const l = new THREE.Line(g2, matLinea); l.renderOrder = 10; escena.add(l); med.objetos.push(l); }
    function ponerEtiqueta(p, texto) {
      const d = el('div', 'absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-[#D9480F] bg-white/95 px-1.5 py-0.5 text-xs font-semibold text-[#D9480F] dark:border-[#FFB347] dark:bg-[#10161D]/95 dark:text-[#FFB347]', texto);
      capa.append(d); med.etiquetas.push({ d, p: p.clone() });
    }
    function circunradio(a, b, c) {
      const ab = b.clone().sub(a), ac = c.clone().sub(a), cruz = ab.clone().cross(ac), area2 = cruz.length();
      if (area2 < 1e-9) return null;
      // centro = a + ( |ac|²·(ab×ac)×ab + |ab|²·ac×(ab×ac) ) / (2·|ab×ac|²)
      const centro = a.clone().add(cruz.clone().cross(ab).multiplyScalar(ac.lengthSq()).add(ac.clone().cross(cruz).multiplyScalar(ab.lengthSq())).multiplyScalar(1 / (2 * area2 * area2)));
      return { r: ab.length() * ac.length() * b.distanceTo(c) / (2 * area2), centro };
    }
    function ponerAnillo(c, eje, r) { // círculo del barreno o radio medido
      const e = new THREE.Vector3(...eje).normalize(), a = Math.abs(e.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const u = e.clone().cross(a).normalize(), w = e.clone().cross(u), pts = [];
      for (let i = 0; i <= 64; i++) { const t = i / 64 * Math.PI * 2; pts.push(c.clone().add(u.clone().multiplyScalar(r * Math.cos(t))).add(w.clone().multiplyScalar(r * Math.sin(t)))); }
      ponerLinea(pts);
    }
    function medirCara(ev) {
      const r = renderer.domElement.getBoundingClientRect();
      raton.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      rayo.setFromCamera(raton, camara);
      const hit = rayo.intersectObjects(grupo.children, false)[0];
      if (!hit) { resultado.textContent = 'Da clic sobre la pieza.'; return; }
      const geo = hit.object.geometry, mw = hit.object.matrixWorld, nm = new THREE.Matrix3().getNormalMatrix(mw);
      const P = geo.attributes.position, N = geo.attributes.normal, pos = [], nor = [];
      for (let i = 0; i < P.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(P, i).applyMatrix4(mw), n = new THREE.Vector3().fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
        pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z);
      }
      const a = ajustarCilindro(pos, nor);
      if (a.error) { resultado.textContent = a.error; return; }
      const c = new THREE.Vector3(...a.centro);
      ponerAnillo(c, a.eje, a.r); ponerPunto(c);
      const tipo = a.completo ? 'Barreno (círculo completo)' : `Radio (arco de ${Math.round(a.cobertura)}°)`;
      ponerEtiqueta(c, a.completo ? `Ø ${fmt(a.r * 2)} · R ${fmt(a.r)} mm` : `R ${fmt(a.r)} mm`);
      resultado.textContent = `${tipo}: R ${fmt(a.r)} · Ø ${fmt(a.r * 2)} mm`;
    }
    let presion = null;
    renderer.domElement.addEventListener('pointerdown', ev => { presion = { x: ev.clientX, y: ev.clientY }; });
    renderer.domElement.addEventListener('pointerup', ev => {
      if (!med.herramienta || !presion || Math.hypot(ev.clientX - presion.x, ev.clientY - presion.y) > 5 || ev.button !== 0) return;
      if (med.herramienta === 'cara') { medirCara(ev); return; }
      const p = puntoEn(ev); if (!p) { resultado.textContent = 'Da clic sobre la pieza.'; return; }
      med.puntos.push(p); ponerPunto(p);
      if (med.herramienta === 'dist' && med.puntos.length === 2) {
        const [a, b] = med.puntos, d = a.distanceTo(b); ponerLinea([a, b]);
        ponerEtiqueta(a.clone().add(b).multiplyScalar(0.5), `${fmt(d)} mm`);
        resultado.textContent = `${fmt(d)} mm  (ΔX ${fmt(Math.abs(b.x - a.x))}, ΔY ${fmt(Math.abs(b.y - a.y))}, ΔZ ${fmt(Math.abs(b.z - a.z))})`; med.puntos = [];
      } else if (med.herramienta === 'radio' && med.puntos.length === 3) {
        const cr = circunradio(...med.puntos);
        if (!cr) resultado.textContent = 'Los tres puntos están en línea recta; elige puntos sobre un borde curvo.';
        else { ponerPunto(cr.centro); ponerLinea([cr.centro, med.puntos[0]]); ponerEtiqueta(cr.centro, `R ${fmt(cr.r)} · Ø ${fmt(cr.r * 2)} mm`); resultado.textContent = `R ${fmt(cr.r)} · Ø ${fmt(cr.r * 2)} mm`; }
        med.puntos = [];
      } else resultado.textContent = med.herramienta === 'dist' ? 'Ahora el segundo punto…' : `Punto ${med.puntos.length} de 3…`;
    });
    function borrarMedidas() {
      med.objetos.forEach(o => { escena.remove(o); if (o.geometry && o.geometry !== geoPunto) o.geometry.dispose(); });
      med.etiquetas.forEach(e => e.d.remove()); med.objetos = []; med.etiquetas = []; med.puntos = []; resultado.textContent = '—';
    }
    const NOMBRES_3D = { dist: 'Distancia entre dos puntos', cara: 'Barreno o radio (un clic)', radio: 'Radio por tres puntos' };
    const AYUDA_3D = { dist: 'Clic en dos puntos de la pieza. Se pega a las esquinas.',
      cara: 'Clic sobre la pared de un barreno o sobre una esquina redondeada: da su diámetro o radio.',
      radio: 'Clic en tres puntos sobre un borde curvo; calcula el radio del círculo que pasa por ellos.' };
    const activo = ['ring-2', 'ring-[#D9480F]', 'dark:ring-[#FFB347]'];
    function elegir(h) {
      med.herramienta = h; med.puntos = [];
      menuMedir.etiqueta(h ? `Medir: ${NOMBRES_3D[h]}` : 'Medir');
      menuMedir.boton.classList[h ? 'add' : 'remove'](...activo);
      renderer.domElement.style.cursor = h ? 'crosshair' : '';
      ayuda.textContent = h ? AYUDA_3D[h] : (modoMover ? 'Arrastra para recorrer la pieza · clic derecho para girar · rueda para acercar' : 'Arrastra para girar · clic derecho para recorrer · rueda para acercar');
    }
    const menuMedir = menuDesplegable(v, 'Medir', [...Object.keys(NOMBRES_3D).map(k => ({ texto: NOMBRES_3D[k], accion: () => elegir(k) })), '-',
      { texto: 'Borrar medidas', accion: borrarMedidas }, { texto: 'Salir de medición', accion: () => elegir(null) }]);
    v.herramientas.prepend(menuMedir.nodo);
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
      borrarMedidas(); geoPunto.dispose(); matMed.dispose(); matLinea.dispose();
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
