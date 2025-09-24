import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const dist = path.join(__dirname, 'dist');

const server = http.createServer((req, res) => {
  let pathname = req.url.split('?')[0];
  if (pathname === '/') pathname = '/index.html';
  let filePath = path.join(dist, pathname);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Fallback to index.html for SPA routes
      fs.readFile(path.join(dist, 'index.html'), (err2, data2) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(data2);
        }
      });
    } else {
      const ext = path.extname(filePath);
      const map = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css' };
      res.writeHead(200, { 'Content-Type': map[ext] || 'text/plain' });
      res.end(data);
    }
  });
});

const PORT = process.env.PORT || 5173;
server.listen(PORT, '0.0.0.0', ()=> console.log('Frontend listening on', PORT));

