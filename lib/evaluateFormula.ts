// Безопасный вычислитель арифметических выражений для полей типа "формула".
// Раньше использовался `new Function(...)`, что выполняло произвольный JS —
// опасно, если формулу видит/заполняет не только её автор (публичные шаблоны).
// Здесь разрешены только числа, объявленные переменные, + - * / ( ) и унарный минус.

type Token =
  | { type: 'num'; value: string }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: '+' | '-' | '*' | '/' }
  | { type: 'lparen' }
  | { type: 'rparen' };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      tokens.push({ type: 'num', value: expr.slice(i, j) });
      i = j;
      continue;
    }
    if (/[a-zA-Zа-яА-Я_]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[a-zA-Zа-яА-Я0-9_]/.test(expr[j])) j++;
      tokens.push({ type: 'ident', value: expr.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }

    throw new Error(`Недопустимый символ в формуле: "${ch}"`);
  }

  return tokens;
}

class FormulaParser {
  private pos = 0;

  constructor(private tokens: Token[], private vars: Record<string, number>) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const tok = this.tokens[this.pos];
    if (!tok) throw new Error('Неожиданный конец формулы');
    this.pos++;
    return tok;
  }

  parse(): number {
    const value = this.parseExpression();
    if (this.pos !== this.tokens.length) {
      throw new Error('Лишние символы в формуле');
    }
    return value;
  }

  private parseExpression(): number {
    let value = this.parseTerm();
    for (let tok = this.peek(); tok?.type === 'op' && (tok.value === '+' || tok.value === '-'); tok = this.peek()) {
      this.next();
      const rhs = this.parseTerm();
      value = tok.value === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  private parseTerm(): number {
    let value = this.parseUnary();
    for (let tok = this.peek(); tok?.type === 'op' && (tok.value === '*' || tok.value === '/'); tok = this.peek()) {
      this.next();
      const rhs = this.parseUnary();
      value = tok.value === '*' ? value * rhs : value / rhs;
    }
    return value;
  }

  private parseUnary(): number {
    const tok = this.peek();
    if (tok?.type === 'op' && tok.value === '-') {
      this.next();
      return -this.parseUnary();
    }
    if (tok?.type === 'op' && tok.value === '+') {
      this.next();
      return this.parseUnary();
    }
    return this.parseFactor();
  }

  private parseFactor(): number {
    const tok = this.peek();
    if (!tok) throw new Error('Неожиданный конец формулы');

    if (tok.type === 'num') {
      this.next();
      return parseFloat(tok.value);
    }
    if (tok.type === 'ident') {
      this.next();
      if (!(tok.value in this.vars)) {
        throw new Error(`Неизвестная переменная: ${tok.value}`);
      }
      return this.vars[tok.value];
    }
    if (tok.type === 'lparen') {
      this.next();
      const value = this.parseExpression();
      const close = this.next();
      if (close.type !== 'rparen') throw new Error('Не хватает закрывающей скобки');
      return value;
    }

    throw new Error('Некорректная формула');
  }
}

export function evaluateFormula(expr: string, vars: Record<string, number>): number {
  const tokens = tokenize(expr);
  return new FormulaParser(tokens, vars).parse();
}
