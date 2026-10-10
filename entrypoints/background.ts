import { PR_DATA_PORT, servePrDataPort } from "../utils/pr-port";
import { createPrDataSource } from "../utils/pr-source";

export default defineBackground(() => {
  const source = createPrDataSource((input, init) => fetch(input, init));
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === PR_DATA_PORT) servePrDataPort(port, source);
  });
});
