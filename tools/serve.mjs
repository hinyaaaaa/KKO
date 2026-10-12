// tools/serve.mjs — 手動確認用: node tools/serve.mjs [port]
// three.js はCDN(index.html/dev.htmlのimportmap)から読むので、ネット接続が必要。
import { startStaticServer } from './static-server.mjs';
const port = Number(process.argv[2] || 8080);
const { port: p } = await startStaticServer({ port });
console.log(`http://127.0.0.1:${p}/dev.html`);
console.log('終了: Ctrl+C');
