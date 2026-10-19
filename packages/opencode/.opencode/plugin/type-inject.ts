import { server } from "../lib/v1.ts";
import { setup } from "../lib/v2.ts";

/**
 * Single default export understood by both opencode plugin loaders:
 * v1 (>=1.3.4) calls `server`, v2 calls `setup`.
 */
export default {
	id: "@nick-vi/opencode-type-inject",
	server,
	setup,
};
