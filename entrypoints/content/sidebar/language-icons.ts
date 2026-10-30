/**
 * Languages the complete set draws as a plain file, drawn with gh-prism's own glyph from
 * section-tree.ts's ICON_SPRITE. An extension here outranks the set's own file names, so
 * ECOSYSTEM_ICONS pins each file the set draws by name under it, such as `bunfig.toml`, to the
 * set's glyph; recheck those names on a @pierre/trees upgrade. A glyph new to this map needs a
 * color rule in section-tree.css.
 */
export const LANGUAGE_ICONS = {
  java: "gh-prism-java",
  toml: "gh-prism-toml",
  pkl: "gh-prism-pkl",
  pcf: "gh-prism-pkl",
};
