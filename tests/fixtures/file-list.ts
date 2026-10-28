/** A `fileList` read back as text lines, each folder's contents indented two spaces deeper. */
export function outline(list: Element | null | undefined, depth = 0): string[] {
  const indent = "  ".repeat(depth);
  return [...(list?.children ?? [])].flatMap((li) => {
    const nested = [...li.children].find((child) => child.tagName === "UL");
    return nested
      ? [`${indent}${li.firstElementChild?.textContent}`, ...outline(nested, depth + 1)]
      : [`${indent}${li.textContent}`];
  });
}
