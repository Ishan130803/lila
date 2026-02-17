export interface DFA {
  initialState: string;
  transitions: {
    [state: string]: {
      [input: string]: string;
    };
  };
  acceptStates: Set<string>;
  numberOfStates: number;
}

type Token =
  | { type: "LITERAL"; value: string }
  | { type: "UNION" }
  | { type: "CONCAT" }
  | { type: "STAR" }
  | { type: "OPTIONAL" }
  | { type: "LPAREN" }
  | { type: "RPAREN" };

interface NFA {
  start: number;
  accept: number;
  transitions: Map<number, Map<string, Set<number>>>;
  epsilonTransitions: Map<number, Set<number>>;
}

interface NFAFragment {
  start: number;
  accept: number;
}

const OP_PRECEDENCE: Record<"UNION" | "CONCAT", number> = {
  UNION: 1,
  CONCAT: 2,
};

function addSymbolTransition(
  transitions: Map<number, Map<string, Set<number>>>,
  from: number,
  symbol: string,
  to: number,
): void {
  if (!transitions.has(from)) transitions.set(from, new Map());
  const bySymbol = transitions.get(from)!;
  if (!bySymbol.has(symbol)) bySymbol.set(symbol, new Set());
  bySymbol.get(symbol)!.add(to);
}

function addEpsilonTransition(
  epsilonTransitions: Map<number, Set<number>>,
  from: number,
  to: number,
): void {
  if (!epsilonTransitions.has(from)) epsilonTransitions.set(from, new Set());
  epsilonTransitions.get(from)!.add(to);
}

function tokenize(regex: string): Token[] {
  if (regex.length === 0) {
    throw new Error("Regex cannot be empty");
  }

  const tokens: Token[] = [];

  for (let i = 0; i < regex.length; i++) {
    const ch = regex[i];

    if (ch === "\\") {
      if (i === regex.length - 1) {
        throw new Error("Invalid escape: trailing backslash");
      }
      i += 1;
      tokens.push({ type: "LITERAL", value: regex[i] });
      continue;
    }

    if (ch === "|") {
      tokens.push({ type: "UNION" });
    } else if (ch === "*") {
      tokens.push({ type: "STAR" });
    } else if (ch === "?") {
      tokens.push({ type: "OPTIONAL" });
    } else if (ch === "(") {
      tokens.push({ type: "LPAREN" });
    } else if (ch === ")") {
      tokens.push({ type: "RPAREN" });
    } else {
      tokens.push({ type: "LITERAL", value: ch });
    }
  }

  return tokens;
}

function isAtomEnd(token: Token): boolean {
  return (
    token.type === "LITERAL" ||
    token.type === "RPAREN" ||
    token.type === "STAR" ||
    token.type === "OPTIONAL"
  );
}

function isAtomStart(token: Token): boolean {
  return token.type === "LITERAL" || token.type === "LPAREN";
}

function insertExplicitConcatenation(tokens: Token[]): Token[] {
  const result: Token[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const current = tokens[i];
    result.push(current);

    if (i === tokens.length - 1) continue;

    const next = tokens[i + 1];
    if (isAtomEnd(current) && isAtomStart(next)) {
      result.push({ type: "CONCAT" });
    }
  }

  return result;
}

function toPostfix(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const operators: Token[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.type === "LITERAL") {
      output.push(token);
      continue;
    }

    if (token.type === "STAR") {
      const prev = tokens[i - 1];
      if (!prev || !(prev.type === "LITERAL" || prev.type === "RPAREN" || prev.type === "STAR")) {
        throw new Error("Invalid '*' usage");
      }
      output.push(token);
      continue;
    }

    if (token.type === "OPTIONAL") {
      const prev = tokens[i - 1];
      if (
        !prev ||
        !(
          prev.type === "LITERAL" ||
          prev.type === "RPAREN" ||
          prev.type === "STAR" ||
          prev.type === "OPTIONAL"
        )
      ) {
        throw new Error("Invalid '?' usage");
      }
      output.push(token);
      continue;
    }

    if (token.type === "LPAREN") {
      operators.push(token);
      continue;
    }

    if (token.type === "RPAREN") {
      let foundLeft = false;
      while (operators.length > 0) {
        const top = operators.pop()!;
        if (top.type === "LPAREN") {
          foundLeft = true;
          break;
        }
        output.push(top);
      }
      if (!foundLeft) {
        throw new Error("Mismatched parentheses");
      }
      continue;
    }

    if (token.type === "UNION" || token.type === "CONCAT") {
      const prev = tokens[i - 1];
      const next = tokens[i + 1];

      if (!prev || !next) {
        throw new Error("Operator cannot be at regex boundary");
      }

      const prevValid =
        prev.type === "LITERAL" ||
        prev.type === "RPAREN" ||
        prev.type === "STAR" ||
        prev.type === "OPTIONAL";
      const nextValid = next.type === "LITERAL" || next.type === "LPAREN";

      if (!prevValid || !nextValid) {
        throw new Error("Invalid operator placement");
      }

      while (operators.length > 0) {
        const top = operators[operators.length - 1];
        if (top.type !== "UNION" && top.type !== "CONCAT") break;
        if (OP_PRECEDENCE[top.type] >= OP_PRECEDENCE[token.type]) {
          output.push(operators.pop()!);
        } else {
          break;
        }
      }

      operators.push(token);
      continue;
    }
  }

  while (operators.length > 0) {
    const top = operators.pop()!;
    if (top.type === "LPAREN" || top.type === "RPAREN") {
      throw new Error("Mismatched parentheses");
    }
    output.push(top);
  }

  return output;
}

function buildNFAFromPostfix(postfix: Token[]): NFA {
  let nextStateId = 0;
  const newState = () => nextStateId++;

  const transitions = new Map<number, Map<string, Set<number>>>();
  const epsilonTransitions = new Map<number, Set<number>>();
  const stack: NFAFragment[] = [];

  for (const token of postfix) {
    if (token.type === "LITERAL") {
      const start = newState();
      const accept = newState();
      addSymbolTransition(transitions, start, token.value, accept);
      stack.push({ start, accept });
      continue;
    }

    if (token.type === "CONCAT") {
      if (stack.length < 2) throw new Error("Invalid regex for concatenation");
      const right = stack.pop()!;
      const left = stack.pop()!;
      addEpsilonTransition(epsilonTransitions, left.accept, right.start);
      stack.push({ start: left.start, accept: right.accept });
      continue;
    }

    if (token.type === "UNION") {
      if (stack.length < 2) throw new Error("Invalid regex for union");
      const right = stack.pop()!;
      const left = stack.pop()!;
      const start = newState();
      const accept = newState();
      addEpsilonTransition(epsilonTransitions, start, left.start);
      addEpsilonTransition(epsilonTransitions, start, right.start);
      addEpsilonTransition(epsilonTransitions, left.accept, accept);
      addEpsilonTransition(epsilonTransitions, right.accept, accept);
      stack.push({ start, accept });
      continue;
    }

    if (token.type === "STAR") {
      if (stack.length < 1) throw new Error("Invalid regex for Kleene star");
      const fragment = stack.pop()!;
      const start = newState();
      const accept = newState();
      addEpsilonTransition(epsilonTransitions, start, fragment.start);
      addEpsilonTransition(epsilonTransitions, start, accept);
      addEpsilonTransition(epsilonTransitions, fragment.accept, fragment.start);
      addEpsilonTransition(epsilonTransitions, fragment.accept, accept);
      stack.push({ start, accept });
      continue;
    }

    if (token.type === "OPTIONAL") {
      if (stack.length < 1) throw new Error("Invalid regex for optional operator");
      const fragment = stack.pop()!;
      const start = newState();
      const accept = newState();
      addEpsilonTransition(epsilonTransitions, start, fragment.start);
      addEpsilonTransition(epsilonTransitions, start, accept);
      addEpsilonTransition(epsilonTransitions, fragment.accept, accept);
      stack.push({ start, accept });
      continue;
    }
  }

  if (stack.length !== 1) {
    throw new Error("Invalid regex expression");
  }

  const root = stack[0];
  return {
    start: root.start,
    accept: root.accept,
    transitions,
    epsilonTransitions,
  };
}

function epsilonClosure(
  states: Set<number>,
  epsilonTransitions: Map<number, Set<number>>,
): Set<number> {
  const closure = new Set<number>(states);
  const stack = [...states];

  while (stack.length > 0) {
    const state = stack.pop()!;
    const nextStates = epsilonTransitions.get(state);
    if (!nextStates) continue;

    for (const next of nextStates) {
      if (!closure.has(next)) {
        closure.add(next);
        stack.push(next);
      }
    }
  }

  return closure;
}

function move(
  states: Set<number>,
  symbol: string,
  transitions: Map<number, Map<string, Set<number>>>,
): Set<number> {
  const result = new Set<number>();

  for (const state of states) {
    const bySymbol = transitions.get(state);
    const nextStates = bySymbol?.get(symbol);
    if (!nextStates) continue;
    for (const next of nextStates) result.add(next);
  }

  return result;
}

function collectAlphabet(transitions: Map<number, Map<string, Set<number>>>): Set<string> {
  const alphabet = new Set<string>();
  for (const bySymbol of transitions.values()) {
    for (const symbol of bySymbol.keys()) {
      alphabet.add(symbol);
    }
  }
  return alphabet;
}

function stateSetKey(states: Set<number>): string {
  return [...states].sort((a, b) => a - b).join(",");
}

function nfaToDfa(nfa: NFA): DFA {
  const alphabet = [...collectAlphabet(nfa.transitions)];
  const dfaTransitions: DFA["transitions"] = {};
  const dfaAcceptStates = new Set<string>();

  const initialClosure = epsilonClosure(new Set([nfa.start]), nfa.epsilonTransitions);
  const initialKey = stateSetKey(initialClosure);

  const keyToDfaState = new Map<string, string>();
  const dfaStateToSet = new Map<string, Set<number>>();
  const queue: string[] = [];

  keyToDfaState.set(initialKey, "0");
  dfaStateToSet.set("0", initialClosure);
  queue.push("0");

  while (queue.length > 0) {
    const dfaState = queue.shift()!;
    const nfaStates = dfaStateToSet.get(dfaState)!;

    if (nfaStates.has(nfa.accept)) {
      dfaAcceptStates.add(dfaState);
    }

    for (const symbol of alphabet) {
      const moved = move(nfaStates, symbol, nfa.transitions);
      if (moved.size === 0) continue;

      const targetClosure = epsilonClosure(moved, nfa.epsilonTransitions);
      if (targetClosure.size === 0) continue;

      const targetKey = stateSetKey(targetClosure);
      if (!keyToDfaState.has(targetKey)) {
        const newStateName = String(keyToDfaState.size);
        keyToDfaState.set(targetKey, newStateName);
        dfaStateToSet.set(newStateName, targetClosure);
        queue.push(newStateName);
      }

      const targetState = keyToDfaState.get(targetKey)!;
      if (!dfaTransitions[dfaState]) dfaTransitions[dfaState] = {};
      dfaTransitions[dfaState][symbol] = targetState;
    }
  }

  return {
    initialState: "0",
    transitions: dfaTransitions,
    acceptStates: dfaAcceptStates,
    numberOfStates: keyToDfaState.size,
  };
}

export function regexToDFA(regex: string): DFA {
  const tokens = tokenize(regex);
  const withConcat = insertExplicitConcatenation(tokens);
  const postfix = toPostfix(withConcat);
  const nfa = buildNFAFromPostfix(postfix);
  return nfaToDfa(nfa);
}

export class RegParser {
  private readonly regex: string;

  constructor(regex: string) {
    this.regex = regex;
  }

  parseToDFA(): DFA {
    return regexToDFA(this.regex);
  }
}
