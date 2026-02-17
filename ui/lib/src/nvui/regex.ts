export const files_regex : string = "(a|b|c|d|e|f|g|h)";

export const pieces_regex : string = "(n|p|r|q|N|P|R|Q)";

export const knight_regex : string = "(n|N)";
export const bishop_regex : string = "(p|P)";
export const rook_regex : string = "(r|R)";
export const queen_regex : string = "(q|Q)";
export const king_regex : string = "(t|T)";

export const ranks_regex : string = "(1|2|3|4|5|6|7|8)";

export const pawn_capture_and_moves_regex : string = `${files_regex}((x)${files_regex})?(2|3|4|5|6|7)`;
export const pawn_promotions_regex : string = `(${files_regex}(x${files_regex})?(1|8)(=)?})`;

export const knight_moves_regex : string = `${knight_regex}(${files_regex}|${ranks_regex})?(x)?${files_regex}${ranks_regex}`
export const bishop_moves_regex : string = `${bishop_regex}(${files_regex}|${ranks_regex})?(x)?${files_regex}${ranks_regex}`

export const queen_moves_regex : string = `${queen_regex}(${files_regex}|${ranks_regex})?(x)?${files_regex}${ranks_regex}`

export const rook_moves_regex : string = `${rook_regex}(${files_regex}|${ranks_regex})?(x)?${files_regex}${ranks_regex}`

export const king_moves_regex : string = `${king_regex}(x)?${files_regex}${ranks_regex}`;

export const castling_moves_regex : string = `(o|O)`

export const announce_last_move_regex: string = "0"
export const announce_current_square_regex: string = `;`
export const announce_current_time_regex: string = 'zt'
export const announce_possible_captures_regex: string = 'zs'

// export const all_moves : string = `(${pawn_moves})|(${piece_moves})|(${king_moves})`;
export const unite_regex = (...regexes: string[]) : string => {
  let res : string[] = [] 
  for (let regex of regexes) {
    res.push("(" + regex + ")")
  }
  return res.join("|");
}

export const concatenate_regex = (...regexes: string[]) : string => {
  let res : string[] = []
  for (let regex of regexes) {
    res.push("(" + regex + ")")
  }
  return res.join("");
}
  