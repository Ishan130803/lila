import { files } from "@lichess-org/chessground/types";
import { parseFen } from "chessops/fen";
import { chessgroundDests, lichessRules } from "chessops/compat";
import { setupPosition } from "chessops/variant";
import { charToRole, opposite, parseUci } from "chessops/util";
import { destsToUcis, sanToUci, sanWriter } from "@/game";
import { renderPieceStr, keyFromAttrs, isKey, pieceStr } from "./render";
import type { PieceStyle, PrefixStyle } from "./setting";
import { type DFA, RegParser } from "./automata"

/* Listen to interactions on the chessboard */
export function leaveSquareHandler(buttons: Cash) {
  return (ev: KeyboardEvent): void => {
    const $currBtn = $(ev.target as HTMLElement);
    $currBtn.removeAttr("ray");
    buttons.removeClass("active");
    $currBtn.addClass("active");
  };
}

export function positionJumpHandler() {
  return (ev: KeyboardEvent): void => {
    const key = keyFromAttrs(ev.target as HTMLElement);
    const digitMatch = ev.code.match(/^Digit([1-8])$/);
    if (!digitMatch || !key) return;
    const newRank = ev.shiftKey ? key[1] : digitMatch[1];
    const newFile = ev.shiftKey ? files[Number(digitMatch[1]) - 1] : key[0];
    document
      .querySelector<HTMLElement>(squareSelector(newRank, newFile))
      ?.focus();
  };
}

export function pieceJumpingHandler(
  selectSound: () => void,
  errorSound: () => void,
  isAntichess = false,
) {
  return (ev: KeyboardEvent): void => {
    const $currBtn = $(ev.target as HTMLElement);

    // TODO: decouple from promotion attribute setting in selectionHandler
    if ($currBtn.attr("promotion") === "true") {
      const $moveBox = $("input.move");
      const $boardLive = $(".boardstatus");
      const promotionPiece = ev.key.toLowerCase();
      const promotionChoice = isAntichess ? /^[kqnrb]$/ : /^[qnrb]$/;
      if (!promotionPiece.match(promotionChoice)) {
        const msg =
          "Invalid promotion piece. q for queen, n for knight, r for rook, b for bishop";
        $boardLive.text(msg + (isAntichess ? ", k for king" : ""));
        return;
      }
      $moveBox.val($moveBox.val() + promotionPiece);
      $currBtn.removeAttr("promotion");
      $("#move-form").trigger("submit");
    }

    const myBtnAttrs = squareSelector(
      $currBtn.attr("rank") ?? "",
      $currBtn.attr("file") ?? "",
    );
    const $allPieces = $(
      `.board-wrapper [piece="${ev.key.toLowerCase()}"], ${myBtnAttrs}`,
    );
    const myPieceIndex = $allPieces.index(myBtnAttrs);
    const next = ev.key.toLowerCase() === ev.key;
    const $prevNextPieces = next
      ? $allPieces.slice(myPieceIndex + 1)
      : $allPieces.slice(0, myPieceIndex);
    const pieceEl = next
      ? $prevNextPieces.get(0)
      : $prevNextPieces.get($prevNextPieces.length - 1);
    if (pieceEl) pieceEl.focus();
    // if detected any matching piece; one is the piece being clicked on,
    else if ($allPieces.length >= 2) {
      const wrapPieceEl = next
        ? $allPieces.get(0)
        : $allPieces.get($allPieces.length - 1);
      wrapPieceEl?.focus();
      selectSound();
    } else errorSound();
  };
}

export function arrowKeyHandler(pov: Color, borderSound: () => void) {
  return (ev: KeyboardEvent): void => {
    const isWhite = pov === "white";
    const key = keyFromAttrs(ev.target as HTMLElement);
    if (!key) return;
    let file = key[0];
    let rank = Number(key[1]);
    if (ev.key === "ArrowUp") rank = isWhite ? (rank += 1) : (rank -= 1);
    else if (ev.key === "ArrowDown") rank = isWhite ? (rank -= 1) : (rank += 1);
    else if (ev.key === "ArrowLeft")
      file = String.fromCharCode(
        isWhite ? file.charCodeAt(0) - 1 : file.charCodeAt(0) + 1,
      );
    else if (ev.key === "ArrowRight")
      file = String.fromCharCode(
        isWhite ? file.charCodeAt(0) + 1 : file.charCodeAt(0) - 1,
      );
    const newSqEl = document.querySelector<HTMLElement>(
      squareSelector(`${rank}`, file),
    );
    newSqEl ? newSqEl.focus() : borderSound();
    ev.preventDefault();
  };
}

export function selectionHandler(
  getOpponentColor: () => Color,
  isTouchDevice = false,
  isAntichess = false,
) {
  return (ev: MouseEvent): void => {
    const opponentColor = getOpponentColor();
    // this depends on the current document structure. This may not be advisable in case the structure wil change.
    const $evBtn = $(ev.target as HTMLElement);
    const rank = $evBtn.attr("rank");
    const file = $evBtn.attr("file");
    const pos = ($evBtn.attr("file") ?? "") + rank;
    const $boardLive = $(".boardstatus");
    const promotionRank = opponentColor === "black" ? "8" : "1";
    const $moveBox = $("input.move");
    if (!$moveBox.length) return;

    // user can select their own piece again if they change their mind
    if (
      $moveBox.val() !== "" &&
      $evBtn.attr("color") === opposite(opponentColor) &&
      !$evBtn.attr("promoteTo")
    ) {
      $moveBox.val("");
    }

    if ($moveBox.val() === "") {
      if (
        $evBtn.attr("color") === opponentColor ||
        $evBtn.attr("piece") === "-" ||
        $evBtn.attr("piece") === "+"
      ) {
        $boardLive.text(keyText(ev.target as HTMLElement) + " not selectable");
      } else {
        $moveBox.val(pos);
        clear("selection");
        $evBtn.addClass("selected");
        $evBtn.text($evBtn.attr("text") + " selected");
      }
    } else {
      const input = $moveBox.val();
      if (typeof input !== "string") return;
      if (isKey(input)) {
        const $firstPiece = $(squareSelector(input[1], input[0]));
        $moveBox.val($moveBox.val() + pos);
        // this is coupled to pieceJumpingHandler() noticing that the attribute is set and acting differently.
        if (
          rank === promotionRank &&
          file &&
          $firstPiece.attr("piece")?.toLowerCase() === "p"
        ) {
          $evBtn.attr("promotion", "true");
          if (!isTouchDevice) {
            const msg =
              "Promote to: q for queen, n for knight, r for rook, b for bishop";
            $boardLive.text(msg + (isAntichess ? ", k for king" : ""));
          } else {
            const promotions: { role: string; text: string }[] = [
              { role: "q", text: "promote to queen" },
              { role: "n", text: "promote to knight" },
              { role: "r", text: "promote to rook" },
              { role: "b", text: "promote to bishop" },
            ];
            if (isAntichess)
              promotions.push({ role: "k", text: "promote to king" });
            promotions.push({ role: "x", text: "cancel" });
            promotions.forEach(({ role, text }, index) => {
              const rank = promotionRank === "8" ? 8 - index : 1 + index;
              const piecePromotionEl = $(squareSelector(rank.toString(), file));
              piecePromotionEl.attr("promoteTo", role);
              piecePromotionEl.text(text);
            });
          }
          return;
        }
        clear("selection");
        $("#move-form").trigger("submit");
      } else {
        const first = input.substring(0, 2);
        const second = input.substring(2, 4);
        if (isKey(first) && isKey(second)) {
          const promoteTo = $evBtn.attr("promoteTo");
          if (promoteTo) {
            if (promoteTo === "x") {
              clear("promotion");
              $moveBox.val("");
              $boardLive.text("promotion cancelled");
            } else {
              $moveBox.val($moveBox.val() + promoteTo);
              clear("all");
              $("#move-form").trigger("submit");
            }
          }
        }
      }
    }
  };
}

function clear(what: "promotion" | "selection" | "all") {
  const $allSquares = $(`.board-wrapper button`);
  $allSquares.each(function (this: HTMLElement) {
    if (what === "promotion" || what === "all")
      this.removeAttribute("promoteTo");
    if (what === "selection" || what === "all")
      this.classList.remove("selected");
    this.textContent = this.getAttribute("text");
  });
}

function keyText(target: HTMLElement) {
  const color = target.getAttribute("color");
  const piece = target.getAttribute("piece");
  const key = keyFromAttrs(target);
  return key && color && piece && color !== "none" && piece !== "-"
    ? key +
        " " +
        pieceStr(charToRole(piece)!, color as Color) +
        (target.classList.contains("selected") ? " selected" : "")
    : key
      ? key
      : "";
}

export function boardCommandsHandler() {
  return (ev: KeyboardEvent): void => {
    const target = ev.target as HTMLElement;
    const $boardLive = $(".boardstatus");
    if (ev.key === "o") {
      $boardLive.text(keyText(target));
    } else if (ev.key === "l") $boardLive.text($("p.lastMove").text());
    else if (ev.key === "t")
      $boardLive.text(
        `${$(".nvui .botc").text()} - ${$(".nvui .topc").text()}`,
      );
  };
}

export function lastCapturedCommandHandler(
  fensteps: () => string[],
  pieceStyle: PieceStyle,
  prefixStyle: PrefixStyle,
) {
  const lastCaptured = (): string => {
    const fens = fensteps();
    const oldFen = fens[fens.length - 2];
    const currentFen = fens[fens.length - 1];
    if (!oldFen || !currentFen) return "none";
    const oldBoardFen = oldFen.split(" ")[0];
    const currentBoardFen = currentFen.split(" ")[0];
    for (const p of "kKqQrRbBnNpP") {
      const diff =
        oldBoardFen.split(p).length - 1 - (currentBoardFen.split(p).length - 1);
      const pcolor = p.toUpperCase() === p ? "white" : "black";
      if (diff === 1) return renderPieceStr(p, pieceStyle, pcolor, prefixStyle);
    }
    return "none";
  };
  return (): Cash => $(".boardstatus").text(lastCaptured());
}

export function possibleMovesHandler(
  yourColor: Color,
  cg: CgApi,
  variant: VariantKey,
  steps: RoundStep[],
) {
  return (ev: KeyboardEvent): void => {
    if (ev.key.toLowerCase() !== "m") return;
    const pos = keyFromAttrs(ev.target as HTMLElement);
    if (!pos) return;
    const $boardLive = $(".boardstatus");

    // possible inefficient to reparse fen; but seems to work when it is AND when it is not the users' turn. Also note that this FEN is incomplete as it only contains the piece information.
    // if it is your turn
    const playThroughToFinalDests = (): Dests => {
      {
        const fromSetup = setupPosition(
          lichessRules(variant),
          parseFen(steps[0].fen).unwrap(),
        ).unwrap();
        steps.forEach((s) => {
          if (s.uci) {
            const move = parseUci(s.uci);
            if (move) fromSetup.play(move);
          }
        });
        // important to override whose turn it is so only the users' own turns will show up
        fromSetup.turn = yourColor;
        return chessgroundDests(fromSetup);
      }
    };
    const rawMoves =
      cg.state.turnColor === yourColor
        ? cg.state.movable.dests
        : playThroughToFinalDests();
    const possibleMoves = rawMoves
      ?.get(pos)
      ?.map((i) => {
        const p = cg.state.pieces.get(i);
        // logic to prevent 'capture rook' on own piece in chess960
        return p && p.color !== yourColor ? `${i} captures ${p.role}` : i;
      })
      ?.filter((i) => ev.key === "m" || i.includes("captures"));
    $boardLive.text(
      !possibleMoves
        ? "None"
        : !possibleMoves.length
          ? "No captures"
          : possibleMoves.join(", "),
    );
  };
}

const promotionRegex = /^([a-h]x?)?[a-h](1|8)=[kqnbr]$/;
const uciPromotionRegex = /^([a-h][1-8])([a-h](1|8))[kqnbr]$/;
const dropRegex = /^(([qrnb])@([a-h][1-8])|p?@([a-h][2-7]))$/;
export type DropMove = { role: Role; key: Key };

export function inputToMove(
  input: string,
  fen: string,
  chessground: CgApi,
): Uci | DropMove | undefined {
  const dests = chessground.state.movable.dests;
  if (!dests || input.length < 1) return;
  const legalUcis = destsToUcis(dests),
    legalSans = sanWriter(fen, legalUcis),
    cleanedMixedCase =
      input[0] + input.slice(1).replace(/\+|#/g, "").toLowerCase();
  // initialize uci preserving first char of input because we need to differentiate bxc3 and Bxc3
  let uci = (
      sanToUci(cleanedMixedCase, legalSans) || cleanedMixedCase
    ).toLowerCase(),
    promotion = "";

  const cleaned = cleanedMixedCase.toLowerCase();
  const drop = cleaned.match(dropRegex);
  if (drop)
    return {
      role: charToRole(cleaned[0]) || "pawn",
      key: cleaned.split("@")[1].slice(0, 2) as Key,
    };
  if (cleaned.match(promotionRegex)) {
    uci = sanToUci(cleaned.slice(0, -2), legalSans) || cleaned;
    promotion = cleaned.slice(-1);
  } else if (cleaned.match(uciPromotionRegex)) {
    uci = cleaned.slice(0, -1);
    promotion = cleaned.slice(-1);
  } else if (
    "18".includes(uci[3]) &&
    chessground.state.pieces.get(uci.slice(0, 2) as Key)?.role === "pawn"
  )
    promotion = "q";

  return legalUcis.includes(uci) ? `${uci}${promotion}` : undefined;
}

const squareSelector = (rank: string, file: string) =>
  `.board-wrapper button[rank="${rank}"][file="${file}"]`;

interface RoundStep {
  uci?: Uci;
  fen: FEN;
}

type Commands = {
  moveLeft: (
    isWhite: boolean,
    currentActiveSquare: HTMLButtonElement,
    borderSound: () => void,
  ) => void;
  moveRight: (
    isWhite: boolean,
    currentActiveSquare: HTMLButtonElement,
    borderSound: () => void,
  ) => void;
  moveDown: (
    isWhite: boolean,
    currentActiveSquare: HTMLButtonElement,
    borderSound: () => void,
  ) => void;
  moveUp: (
    isWhite: boolean,
    currentActiveSquare: HTMLButtonElement,
    borderSound: () => void,
  ) => void;
  announceLastMove: () => void;
  announceTime: () => void;
  announceSquare: (currentActiveSquare: HTMLButtonElement) => void;
  jumpToRank: (curentActiveSquare: HTMLButtonElement, rank: string) => void;
  jumpToFile: (curentActiveSquare: HTMLButtonElement, file: string) => void;
  tellPossibleMoves: (
    yourColor: Color,
    cg: CgApi,
    variant: VariantKey,
    steps: RoundStep[],
    currentActiveSquare: HTMLButtonElement
  ) => void
};

export const AdvancedBlindModeCommands: Commands = {
  moveLeft: (isWhite, currentActiveSquare, borderSound) => {
    console.log("Moving left");
    const key = keyFromAttrs(currentActiveSquare);
    if (!key) return;
    let file = key[0];
    let rank = Number(key[1]);
    file = String.fromCharCode(
      isWhite ? file.charCodeAt(0) - 1 : file.charCodeAt(0) + 1,
    );
    const newSqEl = document.querySelector<HTMLElement>(
      squareSelector(`${rank}`, file),
    );
    newSqEl ? newSqEl.focus() : borderSound();
  },

  moveRight: (isWhite, currentActiveSquare, borderSound) => {
    console.log("Moving Right");
    const key = keyFromAttrs(currentActiveSquare);
    if (!key) return;
    let file = key[0];
    let rank = Number(key[1]);
    file = String.fromCharCode(
      isWhite ? file.charCodeAt(0) + 1 : file.charCodeAt(0) - 1,
    );
    const newSqEl = document.querySelector<HTMLElement>(
      squareSelector(`${rank}`, file),
    );
    newSqEl ? newSqEl.focus() : borderSound();
  },

  moveDown: (isWhite, currentActiveSquare, borderSound) => {
    console.log("Moving Down");
    const key = keyFromAttrs(currentActiveSquare);
    if (!key) return;
    let file = key[0];
    let rank = Number(key[1]);

    rank = isWhite ? (rank -= 1) : (rank += 1);
    const newSqEl = document.querySelector<HTMLElement>(
      squareSelector(`${rank}`, file),
    );
    newSqEl ? newSqEl.focus() : borderSound();
  },

  moveUp: (isWhite, currentActiveSquare, borderSound) => {
    console.log("Moving Up");
    const key = keyFromAttrs(currentActiveSquare);
    if (!key) return;
    let file = key[0];
    let rank = Number(key[1]);
    rank = isWhite ? (rank += 1) : (rank -= 1);
    const newSqEl = document.querySelector<HTMLElement>(
      squareSelector(`${rank}`, file),
    );
    newSqEl ? newSqEl.focus() : borderSound();
  },
  
  announceLastMove: () => {
    const $boardLive = $(".boardstatus");
    $boardLive.text($("p.lastMove").text());
  },
  announceTime: () => {
    const $boardLive = $(".boardstatus");
    $boardLive.text(
      `${$(".nvui .botc").text()} - ${$(".nvui .topc").text()}`,
    );
  },
  announceSquare: (currentActiveSquare: HTMLButtonElement) => {
    const $boardLive = $(".boardstatus");
    $boardLive.text(keyText(currentActiveSquare));
  },
  
  jumpToRank: (curentActiveSquare: HTMLButtonElement, rank: string) => {
    const key = keyFromAttrs(curentActiveSquare as HTMLElement);
    if (!key) return;
    const file = key[0];
    const newSqEl = document.querySelector<HTMLElement>(
      squareSelector(rank, file),
    );
    newSqEl && newSqEl.focus() 
  },
  jumpToFile: (curentActiveSquare: HTMLButtonElement, file: string) => {
    const key = keyFromAttrs(curentActiveSquare as HTMLElement);
    if (!key) return;
    const rank = key[1];
    const newSqEl = document.querySelector<HTMLElement>(
      squareSelector(rank, file),
    );
    newSqEl && newSqEl.focus() 
  },
  tellPossibleMoves: (
    yourColor: Color,
    cg: CgApi,
    variant: VariantKey,
    steps: RoundStep[],
    currentActiveSquare: HTMLButtonElement
  ) => {
    const pos = keyFromAttrs(currentActiveSquare as HTMLElement);
    if (!pos) return;
    const $boardLive = $(".boardstatus");

    // possible inefficient to reparse fen; but seems to work when it is AND when it is not the users' turn. Also note that this FEN is incomplete as it only contains the piece information.
    // if it is your turn
    const playThroughToFinalDests = (): Dests => {
      {
        const fromSetup = setupPosition(
          lichessRules(variant),
          parseFen(steps[0].fen).unwrap(),
        ).unwrap();
        steps.forEach((s) => {
          if (s.uci) {
            const move = parseUci(s.uci);
            if (move) fromSetup.play(move);
          }
        });
        // important to override whose turn it is so only the users' own turns will show up
        fromSetup.turn = yourColor;
        return chessgroundDests(fromSetup);
      }
    };
    const rawMoves =
      cg.state.turnColor === yourColor
        ? cg.state.movable.dests
        : playThroughToFinalDests();
    const possibleMoves = rawMoves
      ?.get(pos)
      ?.map((i) => {
        const p = cg.state.pieces.get(i);
        // logic to prevent 'capture rook' on own piece in chess960
        return p && p.color !== yourColor ? `${i} captures ${p.role}` : i;
      })
      ?.filter((i) =>  i.includes("captures"));
    $boardLive.text(
      !possibleMoves
        ? "None"
        : !possibleMoves.length
          ? "No captures"
          : possibleMoves.join(", "),
    );
  }
};

export const AdvancedBlindModeCommandsHandler = {
  execute: <K extends keyof Commands>(
    commandID: K,
  ): Commands[K] | undefined => {
    console.log(Object.keys(AdvancedBlindModeCommands));
    console.log();
    if (Object.keys(AdvancedBlindModeCommands).includes(commandID)) {
      return AdvancedBlindModeCommands[commandID];
    }
    return undefined;
  },
};

export class RegexDFA {
  currentState: string;
  dfa: DFA;
  constructor(regex: string) {

    const parser = new RegParser(regex);
    const dfa = parser.parseToDFA();
    this.currentState = "0";
    this.dfa = dfa
  }

  reset(state: string = "0"): void {
    this.currentState = state;
  }

  step(state: string): number {
    if (state in this.dfa.transitions[this.currentState]) {
      this.currentState = this.dfa.transitions[this.currentState][state];
      if (this.isAccepting()) {
        return 1;
      } else {
        return 0;
      }
    } else {
      return -1;
    }
  }

  isAccepting(): boolean {
    return (this.dfa.acceptStates as Set<string>).has(this.currentState);
  }

  _sanitize_DFA_object(dfa: any): any {
    const obj: any = {};
    Object.entries(dfa).forEach((value) => {
      const k = value[0];
      const v = value[1] as any[];
      if (k === "acceptStates") {
        obj["acceptStates"] = new Set(v);
      } else if (k === "transitions") {
        const transitionsObj: any = v;
        const newTransitionsObj: any = {};
        obj["transitions"] = newTransitionsObj;
        Object.entries(transitionsObj).forEach((value) => {
          const state = String(value[0]);
          const transitions: any = value[1];
          const newtransitions: any = {};

          Object.entries(transitions).forEach((value) => {
            const k = value[1] as string;
            const v = String(value[0]);
            newtransitions[k] = v;
          });
          newTransitionsObj[state] = newtransitions;
        });
      } else {
        obj[k] = v;
      }
    });
    obj.initialState = String(obj.initialState);

    return obj;
  }
}

interface TokenType {
  name: string;
  regex?: string;
}
type LexerStepStates =
  | {
      status: "DEAD" | "INCOMPLETE";
    }
  | {
      status: "ACCEPT";
      token: TokenType;
    };

export class RegexLexer {
  tokens: (TokenType & {
    serial_no: number;
  })[];

  registered_names: Set<string> = new Set();

  lexer_dfa_states: {
    dfa: RegexDFA;
    dfa_state: "DEAD" | "ACCEPT" | "INCOMPLETE";
  }[];

  isCompiled = false;

  constructor() {
    this.tokens = [];
    this.lexer_dfa_states = [];
    this.isCompiled = false;
  }

  compile() : void {
    this.tokens.forEach((token) => {
      const dfa = new RegexDFA(token.regex!);
      console.log("Compiled DFA for token ", token.name, " is ", dfa);
      this.lexer_dfa_states.push({
        dfa,
        dfa_state: dfa.isAccepting() ? "ACCEPT" : "INCOMPLETE",
      });
    });
    
    this.isCompiled = true;
  }

  step(char: string): LexerStepStates {
    let anyActive = false;
    for (let i = 0; i < this.lexer_dfa_states.length; i++) {
      const lexer_dfa_state = this.lexer_dfa_states[i];
      if (lexer_dfa_state.dfa_state === "INCOMPLETE") {
        anyActive = true;
        const step_res = lexer_dfa_state.dfa.step(char);
        if (step_res === -1) {
          lexer_dfa_state.dfa_state = "DEAD";
        } else if (step_res === 1) {
          lexer_dfa_state.dfa_state = "ACCEPT";
          this.reset();
          const token = {
            name: this.tokens[i].name,
            regex: this.tokens[i].regex,
          };
          return {
            status: "ACCEPT",
            token: token,
          };
        }
      }
    }

    if (anyActive === false) {
      return {
        status: "DEAD",
      };
    } else {
      return {
        status: "INCOMPLETE",
      };
    }
  }

  reset() : void {
    this.lexer_dfa_states.forEach((lexer_dfa_state) => {
      lexer_dfa_state.dfa.reset();
      lexer_dfa_state.dfa_state = "INCOMPLETE";
    });
  }

  registerToken(token: { name: string; regex: string }) : void {
    if (this.isCompiled)
      throw new Error("Cannot register token after compilation");
    if (this.registered_names.has(token.name)) {
      throw new Error(`Token with name ${token.name} already exists`);
    }

    this.tokens.push({ ...token, serial_no: this.tokens.length + 1 });
    this.registered_names.add(token.name);
  }
}

interface RegexParserKeyboardActionsType {
  name: string;
  regex: string;
  action: (buffer: string) => void;
}
export class RegexParserKeyboardEventHandler {
  targetDOMElement: null | HTMLElement;
  lexer: RegexLexer;
  buffer: string;
  timeout: number = 500;
  timeoutObj: number | null = null;
  name_action_mapping: {
    [name: string]: (buffer: string) => void;
  } = {};
  
  //@ts-ignore
  handler = (e: KeyboardEvent): void => {};

  constructor(timeout = 500) {
    this.targetDOMElement = null;
    this.lexer = new RegexLexer();
    this.buffer = "";
    this.timeout = timeout;
  }

  registerInputPattern({
    name,
    regex,
    action,
  }: RegexParserKeyboardActionsType) : RegexParserKeyboardEventHandler {
    this.lexer.registerToken({
      name,
      regex,
    });

    this.name_action_mapping[name] = action;
    return this;
  }

  reset() : void {
    this.buffer = "";
    this.lexer.reset();
    if (this.timeoutObj) {
      clearTimeout(this.timeoutObj);
    }
    this.timeoutObj = null;
  }

  restartTimeout() : void {
    if (this.timeoutObj) {
      clearTimeout(this.timeoutObj);
    }
    this.timeoutObj = setTimeout(() => {
      this.reset();
    }, this.timeout);
  }

  bind(el: HTMLElement) : RegexParserKeyboardEventHandler {
    this.targetDOMElement = el;
    const handler = (e: KeyboardEvent): void => {
      const char = e.key;
      this.restartTimeout();
      if (![" ", "Shift", "Control", "Alt", "Meta"].includes(char)) {
        this.buffer += char;
        const res = this.lexer.step(char);
        if (res.status === "ACCEPT") {
          const action = this.name_action_mapping[res.token.name];
          console.log("Message from Lexer Handler: ", res.token.name, " Buffer : ", this.buffer);
          action(this.buffer);
          this.reset();
        } else if (res.status === "DEAD") {
          console.log(this.buffer, " This is an invalid input resetting");
          this.reset();
        } else {
          console.log("INCOMPLETE", " Buffer : ", this.buffer);
        }
      }
    };
    this.handler = handler;
    this.targetDOMElement.addEventListener("keydown", handler);
    this.reset()
    return this;
  }

  unbind() : RegexParserKeyboardEventHandler {
    if (this.targetDOMElement && this.handler) {
      this.targetDOMElement.removeEventListener("keydown", this.handler);
    }
    return this;
  }

  compile() : RegexParserKeyboardEventHandler {
    this.lexer.compile();
    return this;
  }

  test(str: string): string {
    for (let i = 0; i < str.length; i++) {
      const res = this.lexer.step(str[i]);
      if (res.status === "DEAD") {
        return "DEAD";
      } else if (res.status === "ACCEPT") {
        return "ACCEPT";
      }
    }
    return "DEAD";
  }
}
