import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { Server } from 'socket.io';
import { attachGameEngine } from './socket/game-engine.js';

const server = createServer(app);
const io = new Server(server, {
  cors: { origin: env.CLIENT_ORIGIN, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e6,
});
attachGameEngine(io);
server.listen(env.PORT, env.HOST, () => console.log(`QuizBlitz API and Socket.IO listening on ${env.HOST}:${env.PORT}`));
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; shutting down gracefully.`);
  io.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
