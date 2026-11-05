'use strict';
// Local development server. On Vercel the same handler runs from api/index.js.
const http = require('http');
const handler = require('./lib/app');

const PORT = Number(process.env.PORT) || 3001;
http.createServer(handler).listen(PORT, () => console.log(`Skill Shelf on http://localhost:${PORT}`));
