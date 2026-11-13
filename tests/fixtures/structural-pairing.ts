/**
 * The old and new texts of `app/records.py` in the sandbox's structural-pairing pull request,
 * https://github.com/macintacos/gh-prism-sandbox/pull/11, built as `records_py` in
 * `scripts/create-sandbox.sh` writes them; keep the two in sync.
 */

const getters = (prefix: string, first: number, last: number) =>
  Array.from({ length: last - first + 1 }, (_, i) => {
    const name = `${prefix}${String(first + i).padStart(2, "0")}`;
    return `def ${name}(record):\n    return record.get("${name}")\n\n`;
  }).join("");

const serialize = (body: string) =>
  `def serialize(obj, d):\n    """Serialize a record."""\n    rows = []\n${body}        rows.append("pk")\n    return rows\n\n`;

const total = (body: string) => `def total(items, rate):\n${body}    return total\n`;

const HEADER = '"""Record helpers."""\n\n';

/** Old line 120 is `data = {}` and 121 `if "pk" in d:`; 126 and 127 open `total`. */
export const PAIRING_OLD_TEXT =
  HEADER +
  getters("field_", 1, 38) +
  serialize('    data = {}\n    if "pk" in d:\n') +
  total('    total = compute(items, rate)\n    log.info("done")\n');

/** New line 138 is `if "pk" in obj:`; 143 and 144 open `total`. */
export const PAIRING_NEW_TEXT =
  HEADER +
  getters("field_", 1, 5) +
  getters("extra_", 1, 3) +
  getters("field_", 6, 25) +
  getters("extra_", 4, 6) +
  getters("field_", 26, 38) +
  serialize('    if "pk" in obj:\n') +
  total("    started = time.monotonic()\n    total = compute(items, rate) * 100\n");
