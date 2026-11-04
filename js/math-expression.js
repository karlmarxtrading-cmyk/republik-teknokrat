// math-expression.js
// ------------------------------------------------------------
// A deliberately small mathematical expression compiler used by
// the graph, 3D plot, and vector-field renderers. It never calls
// eval() or Function(); only allowlisted operators, variables,
// constants, and functions can be evaluated.
// ------------------------------------------------------------

const CACHE = new Map(); // bounded LRU: see CACHE_LIMIT
const CACHE_LIMIT = 256;
const MAX_EXPRESSION_LENGTH = 500;
const MAX_TOKEN_COUNT = 600;

const CONSTANTS = Object.freeze({
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
});

const FUNCTIONS = Object.freeze({
  abs: Math.abs,
  acos: Math.acos,
  acosh: Math.acosh,
  asin: Math.asin,
  asinh: Math.asinh,
  atan: Math.atan,
  atan2: Math.atan2,
  atanh: Math.atanh,
  ceil: Math.ceil,
  cos: Math.cos,
  cosh: Math.cosh,
  exp: Math.exp,
  floor: Math.floor,
  ln: Math.log,
  log: Math.log,
  log10: Math.log10,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sign: Math.sign,
  sin: Math.sin,
  sinh: Math.sinh,
  sqrt: Math.sqrt,
  tan: Math.tan,
  tanh: Math.tanh,
});

function tokenize(source) {
  if (typeof source !== 'string' || !source.trim()) {
    throw new Error('Expression must be a non-empty string.');
  }
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new Error('Expression is too long.');
  }

  const tokens = [];
  let i = 0;

  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      const rest = source.slice(i);
      const match = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
      if (!match) throw new Error('Invalid number near position ' + i + '.');
      const value = Number(match[0]);
      if (!Number.isFinite(value)) throw new Error('Number is outside the supported range.');
      tokens.push({ type: 'number', value });
      i += match[0].length;
    } else if (/[A-Za-z_]/.test(char)) {
      const match = source.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      tokens.push({ type: 'identifier', value: match[0].toLowerCase() });
      i += match[0].length;
    } else if ('+-*/^%,()'.includes(char)) {
      tokens.push({
        type: char === '(' || char === ')' || char === ',' ? char : 'operator',
        value: char,
      });
      i += 1;
    } else {
      throw new Error('Unsupported character "' + char + '" at position ' + i + '.');
    }

    if (tokens.length > MAX_TOKEN_COUNT) {
      throw new Error('Expression has too many tokens.');
    }
  }

  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

function parser(tokens) {
  let position = 0;

  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const matchesOperator = (value) => peek().type === 'operator' && peek().value === value;

  function parseExpression() {
    let node = parseTerm();
    while (matchesOperator('+') || matchesOperator('-')) {
      const op = take().value;
      node = { kind: 'binary', op, left: node, right: parseTerm() };
    }
    return node;
  }

  function parseTerm() {
    let node = parseUnary();
    while (true) {
      if (matchesOperator('*') || matchesOperator('/') || matchesOperator('%')) {
        const op = take().value;
        node = { kind: 'binary', op, left: node, right: parseUnary() };
        continue;
      }

      // Mathematical authoring commonly uses implicit multiplication
      // (2x, 3(x+1), or 2sin(x)). Treat the start of another primary
      // as multiplication while keeping the grammar deterministic.
      const next = peek();
      if (next.type === 'number' || next.type === 'identifier' || next.type === '(') {
        node = { kind: 'binary', op: '*', left: node, right: parseUnary() };
        continue;
      }
      break;
    }
    return node;
  }

  function parseUnary() {
    if (matchesOperator('+') || matchesOperator('-')) {
      const op = take().value;
      return { kind: 'unary', op, value: parseUnary() };
    }
    return parsePower();
  }

  function parsePower() {
    let node = parsePrimary();
    if (matchesOperator('^')) {
      take();
      node = { kind: 'binary', op: '^', left: node, right: parseUnary() };
    }
    return node;
  }

  function parsePrimary() {
    const token = take();

    if (token.type === 'number') {
      return { kind: 'number', value: token.value };
    }

    if (token.type === 'identifier') {
      if (peek().type === '(') {
        take();
        const args = [];
        if (peek().type !== ')') {
          while (true) {
            args.push(parseExpression());
            if (peek().type !== ',') break;
            take();
          }
        }
        if (peek().type !== ')') {
          throw new Error('Missing closing parenthesis after function ' + token.value + '.');
        }
        take();
        if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, token.value)) {
          throw new Error('Unsupported function "' + token.value + '".');
        }
        return { kind: 'call', name: token.value, args };
      }
      return { kind: 'identifier', name: token.value };
    }

    if (token.type === '(') {
      const node = parseExpression();
      if (peek().type !== ')') throw new Error('Missing closing parenthesis.');
      take();
      return node;
    }

    throw new Error('Unexpected token "' + token.value + '".');
  }

  const tree = parseExpression();
  if (peek().type !== 'eof') {
    throw new Error('Unexpected token "' + peek().value + '".');
  }
  return tree;
}

function evaluate(node, variables) {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'identifier': {
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, node.name)) {
        return CONSTANTS[node.name];
      }
      if (!Object.prototype.hasOwnProperty.call(variables, node.name)) {
        throw new Error('Unknown variable "' + node.name + '".');
      }
      const value = Number(variables[node.name]);
      return Number.isFinite(value) ? value : NaN;
    }
    case 'unary': {
      const value = evaluate(node.value, variables);
      return node.op === '-' ? -value : value;
    }
    case 'binary': {
      const left = evaluate(node.left, variables);
      const right = evaluate(node.right, variables);
      switch (node.op) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return right === 0 ? NaN : left / right;
        case '%': return right === 0 ? NaN : left % right;
        case '^': return Math.pow(left, right);
        default: return NaN;
      }
    }
    case 'call': {
      const fn = FUNCTIONS[node.name];
      const args = node.args.map((arg) => evaluate(arg, variables));
      return fn(...args);
    }
    default:
      return NaN;
  }
}

/**
 * Compiles an allowlisted expression into a function accepting a
 * variable object, e.g. compileExpression('sin(x)')({ x: 1 }).
 */
export function compileExpression(source) {
  const key = String(source).trim();
  if (CACHE.has(key)) { const hit = CACHE.get(key); CACHE.delete(key); CACHE.set(key, hit); return hit; }
  const tree = parser(tokenize(key));
  const compiled = (variables = {}) => evaluate(tree, variables);
  CACHE.set(key, compiled);
  if (CACHE.size > CACHE_LIMIT) CACHE.delete(CACHE.keys().next().value);
  return compiled;
}

export function evaluateExpression(source, variables = {}) {
  return compileExpression(source)(variables);
}

