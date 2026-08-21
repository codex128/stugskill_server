console.log("hello from server javascript!");

const rateLimit = require('express-rate-limit');
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 100                   // maximum 100 requests
}));

const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Hello from JavaScript!' }));
});

server.listen(3000, () => {
  console.log('Server running at http://localhost:3000/');
});
