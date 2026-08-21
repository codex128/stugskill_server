console.log("hello from server javascript!");

const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Hello from JavaScript!' }));
});

server.listen(3000, () => {
  console.log('Server running at http://localhost:3000/');
});
