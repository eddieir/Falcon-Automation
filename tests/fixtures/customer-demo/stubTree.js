'use strict';
// A stand-in for a long-running demo process: listens on a loopback port and
// starts one child that listens on another, then reports both pids.
//   node stubTree.js <port> <childPort>
//   node stubTree.js leaf <port>
const http = require('node:http');
const { spawn } = require('node:child_process');

const [first, second] = process.argv.slice(2);
const listen = (port) => http.createServer((q, r) => r.end('ok')).listen(Number(port), '127.0.0.1');

if (first === 'leaf') {
  listen(second);
} else {
  listen(first);
  const leaf = spawn(process.execPath, [__filename, 'leaf', second], { stdio: 'ignore' });
  process.stdout.write(`${JSON.stringify({ pid: process.pid, leaf: leaf.pid })}\n`);
}
