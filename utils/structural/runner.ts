import { Language, Parser } from "web-tree-sitter";
import { type LoadedGrammar, structuralChanges } from "./engine";
import type { Grammar, GrammarId } from "./grammar";
import { GRAMMAR_WASM, RUNTIME_WASM } from "./packaged";
import type { EngineRun } from "./request";

export interface RunnerDeps {
  /** The URL of a packaged file, by its name in `packaged.ts`. WebAssembly is compiled from nowhere else. */
  readonly urlOf: (file: string) => string;
  readonly now: () => number;
  readonly pause: () => Promise<void>;
}

/** Memoises `load`'s promise, forgetting it on rejection so the next call retries. */
function retriedOnFailure<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}

/** An `EngineRun` that loads web-tree-sitter's runtime and each grammar on first use. */
export function engineRunner(deps: RunnerDeps): EngineRun {
  const init = retriedOnFailure(() => Parser.init({ locateFile: () => deps.urlOf(RUNTIME_WASM) }));
  const parsers = new Map<GrammarId, () => Promise<Parser>>();
  const parserFor = (id: GrammarId) => {
    let load = parsers.get(id);
    if (!load) {
      load = retriedOnFailure(async () => {
        await init();
        const parser = new Parser();
        parser.setLanguage(await Language.load(deps.urlOf(GRAMMAR_WASM[id])));
        return parser;
      });
      parsers.set(id, load);
    }
    return load();
  };
  /** `null` when the runtime or the grammar failed to load. */
  const languageOf = async (grammar: Grammar): Promise<LoadedGrammar | null> => {
    try {
      return { grammar, parser: await parserFor(grammar.id) };
    } catch {
      return null;
    }
  };

  return async ({ oldText, newText, grammar, regions, limits }, signal) => {
    if (signal.aborted) throw signal.reason;

    const language = grammar && (await languageOf(grammar));
    if (language === null) return { ok: false, reason: "failed" };

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
