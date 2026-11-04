// fraction.js — exact rational arithmetic on BigInt. Never converts to a
// floating-point approximation unless toNumber() is called explicitly.

const abs = (x) => (x < 0n ? -x : x);
function gcd(a, b) { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a || 1n; }

export class Fraction {
  constructor(n, d = 1n) {
    n = BigInt(n); d = BigInt(d);
    if (d === 0n) throw new Error('Penyebut tidak boleh nol.');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d);
    this.n = n / g; this.d = d / g;
    Object.freeze(this);
  }
  static from(value) {
    if (value instanceof Fraction) return value;
    if (typeof value === 'bigint') return new Fraction(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Bilangan harus berhingga.');
      return Fraction.parse(String(value));
    }
    return Fraction.parse(String(value));
  }
  /** Accepts "3", "-3/4", "1.25", "2 1/3" (mixed), "-0.5". */
  static parse(text) {
    const s = String(text).trim().replace(/−/g, '-');
    if (s.length > 40) throw new Error('Bilangan terlalu panjang.');
    let m = s.match(/^([+-]?)(\d+)\s+(\d+)\/(\d+)$/);
    if (m) { const sign = m[1] === '-' ? -1n : 1n; const w = BigInt(m[2]); const n = BigInt(m[3]); const d = BigInt(m[4]); return new Fraction(sign * (w * d + n), d); }
    m = s.match(/^([+-]?\d+)\s*\/\s*([+-]?\d+)$/);
    if (m) return new Fraction(BigInt(m[1]), BigInt(m[2]));
    m = s.match(/^([+-]?)(\d*)\.(\d+)$/);
    if (m) { const sign = m[1] === '-' ? -1n : 1n; const d = 10n ** BigInt(m[3].length); return new Fraction(sign * (BigInt(m[2] || '0') * d + BigInt(m[3])), d); }
    m = s.match(/^[+-]?\d+$/);
    if (m) return new Fraction(BigInt(s));
    throw new Error(`“${text}” bukan bilangan rasional yang valid (contoh: 3, -2/5, 1.25, 2 1/3).`);
  }
  add(o) { o = Fraction.from(o); return new Fraction(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { o = Fraction.from(o); return new Fraction(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { o = Fraction.from(o); return new Fraction(this.n * o.n, this.d * o.d); }
  div(o) { o = Fraction.from(o); if (o.n === 0n) throw new Error('Pembagian dengan nol.'); return new Fraction(this.n * o.d, this.d * o.n); }
  neg() { return new Fraction(-this.n, this.d); }
  isZero() { return this.n === 0n; }
  equals(o) { o = Fraction.from(o); return this.n === o.n && this.d === o.d; }
  toNumber() { return Number(this.n) / Number(this.d); }
  toString() { return this.d === 1n ? String(this.n) : `${this.n}/${this.d}`; }
  toMixed() {
    if (this.d === 1n || abs(this.n) < this.d) return this.toString();
    const sign = this.n < 0n ? '-' : '';
    const w = abs(this.n) / this.d; const r = abs(this.n) % this.d;
    return `${sign}${w} ${r}/${this.d}`;
  }
  toTex() {
    if (this.d === 1n) return String(this.n);
    return (this.n < 0n ? '-' : '') + `\\frac{${abs(this.n)}}{${this.d}}`;
  }
}
export const F = (v) => Fraction.from(v);
