// Engine-script side: imports web-tree-sitter, so only entrypoints/structural-engine.ts may import this module.
import { Language, Parser } from "web-tree-sitter";
import { type LoadedGrammar, structuralChanges } from "./engine";
import type { GrammarId } from "./grammar";
import { GRAMMAR_WASM, RUNTIME_WASM } from "./packaged";
import type { PlainText } from "./plain-text";
import type { EngineRun } from "./request";
import { retriedOnFailure } from "./retried";

/** What the runner needs from the script it runs in. */
export interface RunnerDeps {
  /** The URL of a packaged file, by its name in `packaged.ts`. WebAssembly is compiled from nowhere else. */
  readonly urlOf: (file: string) => string;
  /** A millisecond clock, as `EngineInput.now`. */
  readonly now: () => number;
  /** A macrotask, not a resolved promise, as `EngineInput.pause`. */
  readonly pause: () => Promise<void>;
}

/** An `EngineRun` that loads web-tree-sitter's runtime and each grammar on first use. */
export function engineRunner(deps: RunnerDeps): EngineRun {
  const initRuntime = retriedOnFailure(() =>
    Parser.init({ locateFile: () => deps.urlOf(RUNTIME_WASM) }),
  );
  const parserLoaders = new Map<GrammarId, () => Promise<Parser>>();
  const parserFor = (id: GrammarId) => {
    let loadParser = parserLoaders.get(id);
    if (!loadParser) {
      loadParser = retriedOnFailure(async () => {
        await initRuntime();
        const parser = new Parser();
        parser.setLanguage(await Language.load(deps.urlOf(GRAMMAR_WASM[id])));
        return parser;
      });
      parserLoaders.set(id, loadParser);
    }
    return loadParser();
  };

  return async ({ oldText, newText, grammar, regions, limits }, signal) => {
    signal.throwIfAborted();

    let language: LoadedGrammar | PlainText | undefined;
    if (typeof grammar !== "object") language = grammar;
    else {
      try {
        language = { grammar, parser: await parserFor(grammar.id) };
      } catch (error) {
        console.warn(`gh-prism: couldn't load the ${grammar.id} grammar`, error);
        return { ok: false, reason: "failed" };
      }
    }

    return structuralChanges({
      oldText,
      newText,
      regions,
      limits,
      language,
      signal,
      now: deps.now,
      pause: deps.pause,
    });
  };
}
