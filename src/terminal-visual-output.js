// Detecta se um stream de terminal já produziu ao menos um glifo visível.
// Mantém apenas o estado do parser ANSI; nenhum conteúdo do terminal é retido.
export function createTerminalVisualOutputTracker() {
  let state = "text";
  let visible = false;

  const push = (value) => {
    if (visible) return true;
    const text = typeof value === "string" ? value : "";
    for (const character of text) {
      const code = character.codePointAt(0);

      if (state === "text") {
        if (code === 0x1b) state = "escape";
        else if (code === 0x9b) state = "csi";
        else if (code === 0x9d) state = "osc";
        else if ([0x90, 0x98, 0x9e, 0x9f].includes(code)) state = "string";
        else if ((code > 0x1f && code !== 0x7f) && !/\s/u.test(character)) visible = true;
      } else if (state === "escape") {
        if (character === "[") state = "csi";
        else if (character === "]") state = "osc";
        else if (["P", "X", "^", "_"].includes(character)) state = "string";
        else if (code >= 0x30 && code <= 0x7e) state = "text";
      } else if (state === "csi") {
        if (code === 0x1b) state = "escape";
        else if (code >= 0x40 && code <= 0x7e) state = "text";
      } else if (state === "osc") {
        if (code === 0x07) state = "text";
        else if (code === 0x1b) state = "osc-escape";
      } else if (state === "osc-escape") {
        state = character === "\\" ? "text" : "osc";
      } else if (state === "string") {
        if (code === 0x1b) state = "string-escape";
      } else if (state === "string-escape") {
        state = character === "\\" ? "text" : "string";
      }

      if (visible) break;
    }
    return visible;
  };

  return Object.freeze({
    push,
    get visible() { return visible; },
  });
}

export function hasTerminalVisualOutput(value) {
  return createTerminalVisualOutputTracker().push(value);
}
