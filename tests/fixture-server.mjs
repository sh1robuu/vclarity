import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('./fixtures/interface.html', import.meta.url));
createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); }).listen(4173, '127.0.0.1');
