export const isDatabaseSafeText = (value: string): boolean => {
  if (value.includes("\0")) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && codePoint >= 0xd800 && codePoint <= 0xdfff) return false;
  }
  return true;
};
