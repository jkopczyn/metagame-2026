/** The text as a LIKE operand matching itself literally. */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");

/** A LIKE pattern matching anywhere the text appears. */
export const likeContains = (text: string) => `%${escapeLike(text)}%`;
