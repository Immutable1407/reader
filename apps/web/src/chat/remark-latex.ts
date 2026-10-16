import type { Plugin } from "unified";
import type { Extension, State, Tokenizer } from "micromark-util-types";
import type { Extension as MarkdownExtension } from "mdast-util-from-markdown";

declare module "unified" {
  interface Data {
    micromarkExtensions?: Extension[];
    fromMarkdownExtensions?: MarkdownExtension[];
  }
}

declare module "micromark-util-types" {
  interface TokenTypeMap {
    readerLatex: "readerLatex";
    readerLatexData: "readerLatexData";
  }
}

// Parse delimiters before Markdown consumes backslash escapes. Code spans,
// fences, link destinations and escaped backslashes retain their normal rules.
const tokenize: Tokenizer = function (effects, ok, nok) {
  let closing = 0;
  let inData = true;
  const start: State = (code) => {
    effects.enter("readerLatex");
    effects.enter("readerLatexData");
    effects.consume(code);
    return opening;
  };
  const opening: State = (code) => {
    if (code !== 40 && code !== 91) return nok(code);
    closing = code === 40 ? 41 : 93;
    effects.consume(code);
    return content;
  };
  const content: State = (code) => {
    if (code === null) return nok(code);
    if (code === -5 || code === -4 || code === -3) {
      if (inData) effects.exit("readerLatexData");
      inData = false;
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      return content;
    }
    if (!inData) {
      effects.enter("readerLatexData");
      inData = true;
    }
    effects.consume(code);
    return code === 92 ? close : content;
  };
  const close: State = (code) => {
    if (code === closing) {
      effects.consume(code);
      effects.exit("readerLatexData");
      effects.exit("readerLatex");
      return ok;
    }
    // A pair of backslashes belongs to the formula (e.g. a matrix row).
    if (code === 92) {
      effects.consume(code);
      return content;
    }
    return content(code);
  };
  return start;
};

const syntax: Extension = { text: { 92: { tokenize } } };
const markdown: MarkdownExtension = {
  enter: {
    readerLatex(token) {
      const raw = this.sliceSerialize(token);
      const value = raw.slice(2, -2).trim();
      this.enter(
        {
          type: "inlineMath",
          value,
          data: {
            hName: "code",
            hProperties: {
              className: [
                "language-math",
                raw[1] === "[" ? "math-display" : "math-inline",
              ],
            },
            hChildren: [{ type: "text", value }],
          },
        },
        token,
      );
      this.buffer();
    },
  },
  exit: {
    readerLatex(token) {
      this.resume();
      this.exit(token);
    },
  },
};

export const remarkLatex: Plugin = function () {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(syntax);
  (data.fromMarkdownExtensions ??= []).push(markdown);
};
