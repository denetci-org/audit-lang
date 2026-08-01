/* =============================================================
   audit-lang — küçük bir rapor dili
   sözcükleyici → çözümleyici → yorumlayıcı → HTML
   kullanım: node audit-lang.js ornek.audit > rapor.html
   ============================================================= */

/* ---------------------------------------------------------------
   1. SÖZCÜKLEYİCİ (lexer)
   --------------------------------------------------------------- */

const KW = new Set(['function', 'if', 'else', 'for', 'in', 'where',
                    'return', 'true', 'false', 'null']);

const PUNCS = ['==', '!=', '<=', '>=', '&&', '||', '=>',
               '+', '-', '*', '/', '%', '<', '>', '!', '=',
               ':', ',', '.', '(', ')', '{', '}', '[', ']'];

const ID = /[\p{L}_]/u, IDN = /[\p{L}\p{N}_]/u;

function tokenize(src) {
  const T = [];
  let i = 0, line = 1;

  while (i < src.length) {
    const c = src[i];

    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c) || c === ';') { i++; continue; }   // ; isteğe bağlı

    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      i += 2; continue;
    }

    if (c === '"' || c === "'") {
      const [parts, next] = scanString(src, i);
      T.push({ t: 'str', parts, line }); i = next; continue;
    }

    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      T.push({ t: 'num', v: parseFloat(src.slice(i, j)), line }); i = j; continue;
    }

    if (ID.test(c)) {
      let j = i;
      while (j < src.length && IDN.test(src[j])) j++;
      const w = src.slice(i, j);
      T.push({ t: KW.has(w) ? w : 'ident', v: w, line }); i = j; continue;
    }

    const p = PUNCS.find(p => src.startsWith(p, i));
    if (!p) throw new SyntaxError(`Beklenmeyen karakter '${c}' — satır ${line}`);
    T.push({ t: p, line }); i += p.length;
  }

  T.push({ t: 'eof', line });
  return T;
}

/* "metin ${ifade} ve ${f(x)}" → parça listesi; süssüz $ düz metindir */
function scanString(src, i) {
  const q = src[i++];
  const parts = [];
  let buf = '';

  while (i < src.length && src[i] !== q) {
    if (src[i] === '\\') { buf += src[i + 1]; i += 2; continue; }

    // ${ ... }
    if (src[i] === '$' && src[i + 1] === '{') {
      if (buf) { parts.push({ t: 'text', v: buf }); buf = ''; }
      let j = i + 2, depth = 1, inQ = null;
      while (j < src.length && depth) {
        const ch = src[j];
        if (inQ) { if (ch === '\\') j++; else if (ch === inQ) inQ = null; }
        else if (ch === '"' || ch === "'") inQ = ch;
        else if (ch === '{') depth++;
        else if (ch === '}') depth--;
        if (depth) j++;
      }
      parts.push({ t: 'expr', src: src.slice(i + 2, j) });
      i = j + 1; continue;
    }

    buf += src[i++];
  }

  if (buf) parts.push({ t: 'text', v: buf });
  return [parts, i + 1];
}

/* ---------------------------------------------------------------
   2. ÇÖZÜMLEYİCİ (parser)
   --------------------------------------------------------------- */

const BIN = {
  where: 1,
  '||': 2, '&&': 3,
  '==': 4, '!=': 4,
  '<': 5, '>': 5, '<=': 5, '>=': 5,
  '+': 6, '-': 6,
  '*': 7, '/': 7, '%': 7,
};

class Parser {
  constructor(toks) { this.T = toks; this.i = 0; }

  peek(k = 0) { return this.T[this.i + k]; }
  at(t) { return this.peek().t === t; }
  next() { return this.T[this.i++]; }
  eat(t) { return this.at(t) ? this.next() : null; }
  expect(t) {
    if (this.at(t)) return this.next();
    const g = this.peek();
    throw new SyntaxError(`'${t}' bekleniyordu, '${g.v ?? g.t}' bulundu — satır ${g.line}`);
  }

  program() {
    const body = [];
    while (!this.at('eof')) body.push(this.statement());
    return { k: 'Block', body };
  }

  /* ---- deyimler ---- */

  statement() {
    if (this.at('function')) {
      this.next();
      const name = this.expect('ident').v;
      return { k: 'Bind', name, value: { k: 'Fn', params: this.params(), body: this.block() } };
    }
    if (this.at('if')) return this.ifStmt();
    if (this.at('for')) return this.forStmt();
    if (this.at('return')) {
      this.next();
      const bare = this.at('}') || this.at('eof');
      return { k: 'Return', value: bare ? null : this.expression() };
    }
    // ad: değer
    if (this.at('ident') && this.peek(1).t === ':') {
      const name = this.next().v;
      this.next();
      return { k: 'Bind', name, value: this.expression() };
    }
    return { k: 'Expr', expr: this.expression() };
  }

  ifStmt() {
    this.expect('if'); this.expect('(');
    const test = this.expression();
    this.expect(')');
    const cons = this.block();
    let alt = null;
    if (this.eat('else')) alt = this.at('if') ? this.ifStmt() : this.block();
    return { k: 'If', test, cons, alt };
  }

  forStmt() {
    this.expect('for'); this.expect('(');
    const name = this.expect('ident').v;
    this.expect('in');
    const list = this.expression();
    this.expect(')');
    return { k: 'For', name, list, body: this.block() };
  }

  block() {
    this.expect('{');
    const body = [];
    while (!this.at('}')) body.push(this.statement());
    this.expect('}');
    return { k: 'Block', body };
  }

  params() {
    this.expect('(');
    const ps = [];
    while (!this.at(')')) {
      const name = this.expect('ident').v;
      const def = this.eat('=') ? this.expression() : null;
      ps.push({ name, def });
      if (!this.eat(',')) break;
    }
    this.expect(')');
    return ps;
  }

  /* ---- ifadeler (Pratt) ---- */

  expression(min = 0) {
    let left = this.unary();
    for (;;) {
      const op = this.peek().t;
      const prec = BIN[op];
      if (prec === undefined || prec <= min) return left;
      this.next();
      left = op === 'where'
        ? { k: 'Where', list: left, pred: this.expression(prec) }
        : { k: 'Bin', op, left, right: this.expression(prec) };
    }
  }

  unary() {
    if (this.at('!') || this.at('-')) {
      const op = this.next().t;
      return { k: 'Un', op, arg: this.unary() };
    }
    return this.postfix(this.primary());
  }

  postfix(node) {
    for (;;) {
      if (this.eat('.')) {
        const t = this.next();                    // anahtar sözcük de alan adı olabilir
        node = { k: 'Member', obj: node, name: t.v ?? t.t };
      } else if (this.eat('[')) {
        const index = this.expression();
        this.expect(']');
        node = { k: 'Index', obj: node, index };
      } else if (this.at('(')) {
        const args = this.args();
        if (this.at('{')) args.push(this.block());
        node = { k: 'Call', callee: node, args };
      } else return node;
    }
  }

  args() {
    this.expect('(');
    const a = [];
    while (!this.at(')')) {
      const line = this.peek().line;
      const arg = this.expression();
      if (arg.k === 'Block') {
        throw new SyntaxError(`Çağrı bloğu parantez dışında yazılmalı — satır ${line}`);
      }
      a.push(arg);
      if (!this.eat(',')) break;
    }
    this.expect(')');
    return a;
  }

  primary() {
    const t = this.peek();
    switch (t.t) {
      case 'num':   this.next(); return { k: 'Lit', v: t.v };
      case 'true':  this.next(); return { k: 'Lit', v: true };
      case 'false': this.next(); return { k: 'Lit', v: false };
      case 'null':  this.next(); return { k: 'Lit', v: null };
      case 'ident': this.next(); return { k: 'Ref', name: t.v };
      case 'str':
        this.next();
        return {
          k: 'Str',
          parts: t.parts.map(p => p.t === 'text' ? p : { t: 'expr', node: parseExpr(p.src) }),
        };
      case '[': {
        this.next();
        const items = [];
        while (!this.at(']')) { items.push(this.expression()); if (!this.eat(',')) break; }
        this.expect(']');
        return { k: 'Arr', items };
      }
      case '{': return this.braces();
      case '(': return this.parenOrArrow();
    }
    throw new SyntaxError(`Beklenmeyen '${t.v ?? t.t}' — satır ${t.line}`);
  }

  /* { } hem obje hem blok:  ilk eleman "anahtar:" ise obje, değilse blok */
  braces() {
    const a = this.peek(1), b = this.peek(2);
    const looksObject =
      a.t === '}' ||
      ((a.t === 'ident' || a.t === 'str' || KW.has(a.t)) && b.t === ':');
    return looksObject ? this.object() : this.block();
  }

  object() {
    this.expect('{');
    const props = [];
    while (!this.at('}')) {
      const t = this.next();
      const key = t.t === 'str'
        ? t.parts.map(p => p.v ?? '').join('')
        : (t.v ?? t.t);
      this.expect(':');
      props.push({ key, value: this.expression() });
      if (!this.eat(',')) break;
    }
    this.expect('}');
    return { k: 'Obj', props };
  }

  /* (a, b) => { }   ya da   (ifade) */
  parenOrArrow() {
    const save = this.i;
    try {
      const params = this.params();
      if (this.eat('=>')) {
        // gövde blok da olabilir, tek ifade de:  (f) => renk[f.severity]
        const b = this.at('{') ? this.braces() : this.expression();
        const body = b.k === 'Block' ? b : { k: 'Block', body: [{ k: 'Return', value: b }] };
        return { k: 'Fn', params, body };
      }
    } catch { /* geri sar */ }
    this.i = save;
    this.expect('(');
    const e = this.expression();
    this.expect(')');
    return e;
  }
}

const parse     = src => new Parser(tokenize(src)).program();
const parseExpr = src => new Parser(tokenize(src)).expression();

/* ---------------------------------------------------------------
   3. YORUMLAYICI (interpreter)
   --------------------------------------------------------------- */

class Return { constructor(v) { this.v = v; } }

class Scope {
  constructor(parent = null, vars = {}, soft = false) {
    this.vars = new Map(Object.entries(vars));
    this.parent = parent;
    this.soft = soft;               // where içinde: olmayan alan hata değil, boş değer
  }
  get(n) {
    for (let s = this; s; s = s.parent) if (s.vars.has(n)) return s.vars.get(n);
    if (this.soft) return undefined;
    throw new Error(`Tanımsız değişken: ${n}`);
  }
  set(n, v) {                       // varsa bulunduğu kapsamda güncelle, yoksa burada tanımla
    for (let s = this; s; s = s.parent) if (s.vars.has(n)) { s.vars.set(n, v); return; }
    this.vars.set(n, v);
  }
  define(n, v) { this.vars.set(n, v); }
}

const truthy = v => {
  if (v == null || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
};

const text = v =>
  v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);

const AYLAR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
               'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

function formatDate(v, fmt = 'd MMM yyyy') {
  if (v == null) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(v);
  const [, Y, M, D] = m;
  const map = { yyyy: Y, MMM: AYLAR[+M - 1], MM: M, dd: D, d: String(+D) };
  return fmt.replace(/yyyy|MMM|MM|dd|d/g, t => map[t]);
}

class Interp {
  constructor() {
    this.doc = { header: null, footer: null, children: [] };
    this.stack = [this.doc.children];
    this.columnStack = [];
    this.global = new Scope(null, this.builtins());
  }

  run(src) {
    const ast = parse(src);
    for (const st of ast.body) this.exec(st, this.global);
    return this.doc;
  }

  /* --- çıktı yığını --- */
  emit(node) { this.stack.at(-1).push(node); }

  collect(block) {
    const kids = [];
    this.stack.push(kids);
    try { this.callBlock(block); } finally { this.stack.pop(); }
    return kids;
  }

  callBlock(b) {
    if (!b || !b.__block) return;
    const sc = new Scope(b.scope);
    for (const st of b.node.body) this.exec(st, sc);
  }

  /* --- gömülü fonksiyonlar --- */
  builtins() {
    const I = this;

    const requiredBlock = (name, opts, blk) => {
      if (opts && opts.__block) { blk = opts; opts = {}; }  // name() { ... }
      if (!blk || !blk.__block) throw new Error(`${name}(...) çağrısından sonra blok gerekli`);
      return [opts || {}, blk];
    };

    const container = kind => (opts, blk) => {
      [opts, blk] = requiredBlock(kind, opts, blk);
      I.emit({ kind, opts, children: I.collect(blk) });
    };

    /* table(satirlar, seçenekler) { column(başlık, değer, seçenekler) }
       değer : "alan" | "alan.altalan" | (satir) => değer
       style : stil objesi | (satir) => stil objesi                         */
    const cell = (col, row) => {
      const g = col.value;
      if (g && (typeof g === 'function' || g.__fn)) return I.call(g, [row]);
      if (typeof g === 'string') return g.split('.').reduce((o, k) => o == null ? undefined : o[k], row);
      return undefined;
    };
    const cellStyle = (col, row) => {
      const s = col.style;
      return (s && (typeof s === 'function' || s.__fn)) ? I.call(s, [row]) : (s || {});
    };

    return {
      print:   (v, opts) => I.emit({ kind: 'text', value: text(v), opts: opts || {} }),
      box:     container('box'),
      row:     container('row'),
      col:     container('col'),

      column:  (head, value, opts = {}) => {
        const cols = I.columnStack.at(-1);
        if (!cols) throw new Error('column(...) yalnızca table(...) { ... } içinde kullanılabilir');
        cols.push({ ...(opts || {}), head, value });
      },

      table:   (rows, opts, blk) => {
        [opts, blk] = requiredBlock('table', opts, blk);
        if (Object.hasOwn(opts, 'cols')) {
          throw new Error("table seçeneklerinde 'cols' kullanılamaz; sütunları blok içinde column(...) ile tanımla");
        }

        const cols = [];
        I.columnStack.push(cols);
        let stray;
        try { stray = I.collect(blk); }
        finally { I.columnStack.pop(); }

        if (stray.length) {
          throw new Error('table bloğunda yalnızca column(...) tanımları kullanılabilir');
        }
        if (!cols.length) throw new Error('table bloğunda en az bir column(...) gerekli');

        I.emit({
          kind: 'table',
          opts,
          cols: cols.map(c => ({ head: text(c.head ?? ''), width: c.width, align: c.align })),
          rows: (rows || []).map(r => cols.map(c => ({
            text: text(cell(c, r)),
            style: cellStyle(c, r),
          }))),
        });
      },

      header:  o => { I.doc.header = o || {}; },
      footer:  o => { I.doc.footer = o || {}; },
      newpage: () => I.emit({ kind: 'pagebreak' }),

      style: (...o) => Object.assign({}, ...o),
      count: x => Array.isArray(x) ? x.length : (x == null ? 0 : 1),
      join:  (a, sep = ', ') => (a || []).join(sep),
      sum:   (a, key) => (a || []).reduce((t, x) => t + (Number(key ? x[key] : x) || 0), 0),
      upper: s => text(s).toLocaleUpperCase('tr'),
      lower: s => text(s).toLocaleLowerCase('tr'),
      date:  formatDate,

      page: '{page}', pages: '{pages}',
    };
  }

  /* --- deyim çalıştırma --- */
  exec(n, sc) {
    switch (n.k) {
      case 'Bind':   sc.set(n.name, this.eval(n.value, sc)); return;
      case 'Expr':   this.eval(n.expr, sc); return;
      case 'Return': throw new Return(n.value ? this.eval(n.value, sc) : undefined);

      case 'If':
        if (truthy(this.eval(n.test, sc))) this.body(n.cons.body, new Scope(sc));
        else if (n.alt) {
          if (n.alt.k === 'If') this.exec(n.alt, sc);
          else this.body(n.alt.body, new Scope(sc));
        }
        return;

      case 'For': {
        const list = this.eval(n.list, sc) || [];
        for (const item of list) {
          const s = new Scope(sc);
          s.define(n.name, item);
          this.body(n.body.body, s);
        }
        return;
      }
    }
    throw new Error(`Bilinmeyen deyim: ${n.k}`);
  }

  body(stmts, sc) { for (const st of stmts) this.exec(st, sc); }

  /* --- ifade değerlendirme --- */
  eval(n, sc) {
    switch (n.k) {
      case 'Lit':    return n.v;
      case 'Ref':    return sc.get(n.name);
      case 'Str':    return n.parts
                       .map(p => p.t === 'text' ? p.v : text(this.eval(p.node, sc)))
                       .join('');
      case 'Arr':    return n.items.map(x => this.eval(x, sc));
      case 'Obj': {
        const o = {};
        for (const p of n.props) o[p.key] = this.eval(p.value, sc);
        return o;
      }
      case 'Fn':     return { __fn: true, params: n.params, body: n.body, scope: sc };
      case 'Block':  return { __block: true, node: n, scope: sc };

      case 'Member': { const o = this.eval(n.obj, sc); return o == null ? undefined : o[n.name]; }
      case 'Index':  { const o = this.eval(n.obj, sc); return o == null ? undefined : o[this.eval(n.index, sc)]; }
      case 'Un': {
        const v = this.eval(n.arg, sc);
        return n.op === '!' ? !truthy(v) : -Number(v);
      }
      case 'Bin':    return this.binop(n, sc);

      case 'Where': {
        const list = this.eval(n.list, sc) || [];
        return list.filter(item => {
          const fields = (item && typeof item === 'object') ? item : {};
          return truthy(this.eval(n.pred, new Scope(sc, { ...fields, it: item }, true)));
        });
      }

      case 'Call':
        return this.call(this.eval(n.callee, sc), n.args.map(a => this.eval(a, sc)));
    }
    throw new Error(`Bilinmeyen ifade: ${n.k}`);
  }

  binop(n, sc) {
    const L = () => this.eval(n.left, sc);
    const R = () => this.eval(n.right, sc);
    switch (n.op) {
      case '&&': return truthy(L()) ? R() : false;
      case '||': { const l = L(); return truthy(l) ? l : R(); }
      case '==': return L() === R();
      case '!=': return L() !== R();
      case '<':  return L() <  R();
      case '>':  return L() >  R();
      case '<=': return L() <= R();
      case '>=': return L() >= R();
      case '+':  { const l = L(), r = R();
                   return (typeof l === 'string' || typeof r === 'string') ? text(l) + text(r) : l + r; }
      case '-':  return L() - R();
      case '*':  return L() * R();
      case '/':  return L() / R();
      case '%':  return L() % R();
    }
  }

  call(f, args) {
    if (typeof f === 'function') return f(...args);
    if (f && f.__fn) {
      const sc = new Scope(f.scope);
      f.params.forEach((p, i) => {
        const v = args[i] !== undefined ? args[i] : (p.def ? this.eval(p.def, sc) : undefined);
        sc.define(p.name, v);
      });
      try { this.body(f.body.body, sc); }
      catch (e) { if (e instanceof Return) return e.v; throw e; }
      return undefined;
    }
    throw new Error('Çağrılabilir bir değer değil');
  }
}

/* ---------------------------------------------------------------
   4. HTML ÜRETİCİ (renderer)
   --------------------------------------------------------------- */

const CSS = {
  size:   v => `font-size:${v}px`,
  color:  v => `color:${v}`,
  bold:   v => `font-weight:${v ? 700 : 400}`,
  italic: v => v ? 'font-style:italic' : '',
  line:   v => `line-height:${v}`,
  before: v => `margin-top:${v}px`,
  after:  v => `margin-bottom:${v}px`,
  width:  v => `flex:0 0 ${v}px`,
  align:  v => `text-align:${v}`,
  border: v => `border:1px solid ${v}`,
  pad:    v => `padding:${v}px`,
  radius: v => `border-radius:${v}px`,
  bg:     v => `background:${v}`,
  font:   v => `font-family:${v}`,
};

/* { style: h1, align: "right" } → tek düz stil objesi */
const flatten = (opts = {}) => {
  const { style, ...rest } = opts;
  return { ...(style || {}), ...rest };
};

const css = obj =>
  Object.entries(obj)
    .filter(([k, v]) => CSS[k] && v !== undefined && v !== null)
    .map(([k, v]) => CSS[k](v))
    .filter(Boolean)
    .join(';');

function renderTable(n) {
  const o = n.opts;
  const border = o.border ?? '#e2e2e2';
  const pad = o.pad ?? 8;

  /* hücre: genişlik/hizalama sütundan, geri kalan stil objesinden */
  const cellCss = (style = {}, col = {}, rule = 1) => {
    const { width, ...rest } = style;
    return [
      col.width ? `width:${col.width}px` : '',
      `text-align:${col.align || 'left'}`,
      `padding:${pad}px`,
      `border-bottom:${rule}px solid ${border}`,
      css({ ...(o.cellStyle || {}), ...rest }),
    ].filter(Boolean).join(';');
  };

  const headStyle = o.headStyle || { size: 10, bold: true, color: '#666' };
  const head = n.cols
    .map(c => `<th style="${cellCss(headStyle, c, 2)}">${esc(c.head)}</th>`)
    .join('');

  const rows = n.rows.map((r, i) => {
    const zebra = o.zebra && i % 2 ? `background:${o.zebra};` : '';
    const tds = r
      .map((cell, j) => `<td style="${zebra}${cellCss(cell.style, n.cols[j])}">${esc(cell.text)}</td>`)
      .join('');
    return `<tr>${tds}</tr>`;
  }).join('\n');

  const outer = css({ before: o.before, after: o.after ?? 12 });
  return `<table style="width:100%;border-collapse:collapse;font-size:11px;${outer}">
<thead><tr>${head}</tr></thead>
<tbody>
${rows}
</tbody></table>`;
}

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

function renderNode(n, parent) {
  if (n.kind === 'pagebreak') return '<div class="pb"></div>';
  if (n.kind === 'table') return renderTable(n);

  const st = flatten(n.opts);
  const grow = parent === 'row' && st.width === undefined ? 'flex:1;' : '';

  if (n.kind === 'text') return `<div style="${grow}${css(st)}">${esc(n.value)}</div>`;

  const layout = n.kind === 'row' ? 'display:flex;gap:12px;align-items:baseline;' : '';
  const kids = n.children.map(c => renderNode(c, n.kind)).join('\n');
  return `<div style="${grow}${layout}${css(st)}">\n${kids}\n</div>`;
}

function renderBar(bar) {
  if (!bar) return '';
  const cell = (v, align) =>
    `<div style="flex:1;text-align:${align}">${v ? esc(text(v)) : ''}</div>`;
  return `<div class="bar" style="display:flex">${
    cell(bar.left, 'left')}${cell(bar.center, 'center')}${cell(bar.right, 'right')}</div>`;
}

function toHTML(doc) {
  return `<!doctype html>
<meta charset="utf-8">
<style>
  body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 24px; }
  .bar { font-size: 10px; color: #888; padding: 8px 0; }
  .bar:first-of-type { border-bottom: 1px solid #eee; margin-bottom: 24px; }
  .bar:last-of-type  { border-top: 1px solid #eee; margin-top: 24px; }
  .pb  { break-after: page; height: 24px; }
</style>
${renderBar(doc.header)}
${doc.children.map(c => renderNode(c, null)).join('\n')}
${renderBar(doc.footer)}
`;
}

/* ---------------------------------------------------------------
   5. GİRİŞ NOKTASI
   --------------------------------------------------------------- */

export function compile(src) {
  return toHTML(new Interp().run(src));
}

/* --- KOMUT SATIRI (tarayıcı derlemesinde bu satırdan sonrası kesilir) --- */

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const fs = await import('node:fs');
  const file = process.argv[2];
  if (file) process.stdout.write(compile(fs.readFileSync(file, 'utf8')));
}
