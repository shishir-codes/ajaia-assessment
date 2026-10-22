// sanitize-html is CommonJS and calls require('htmlparser2'), but htmlparser2 12 is an ES module only.
// Node 24 can require() an ES module, but Vercel's function runtime cannot (it fails with ERR_REQUIRE_ESM
// and every route that sanitizes HTML crashes). So htmlparser2 is loaded here as a normal ES module and
// placed in the CommonJS cache under the exact path sanitize-html resolves, before sanitize-html loads.
// sanitize.js imports this file first. Same module object either way, so behaviour does not change.
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import * as htmlparser2 from 'htmlparser2';

const require = createRequire(import.meta.url);
const parserPath = createRequire(require.resolve('sanitize-html')).resolve('htmlparser2');

if (!require.cache[parserPath]) {
  const entry = new Module(parserPath, null);
  entry.filename = parserPath;
  entry.paths = Module._nodeModulePaths(path.dirname(parserPath));
  entry.exports = htmlparser2;
  entry.loaded = true;
  require.cache[parserPath] = entry;
}
