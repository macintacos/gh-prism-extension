/** Resizes happy-dom's window, firing its `resize`. */
export function setViewport(size: { width: number; height: number }): void {
  (
    window as unknown as {
      happyDOM: { setViewport: (size: { width: number; height: number }) => void };
    }
  ).happyDOM.setViewport(size);
}
