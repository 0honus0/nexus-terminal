const path = require('node:path');
const { createRequire } = require('node:module');

const requireFromBackend = createRequire(path.resolve(__dirname, '../../../packages/backend/package.json'));
const { WebSocket } = requireFromBackend('ws');
const targetOrigin = 'http://127.0.0.1:3001';

const createSocket = (ticket, cookie) =>
  new WebSocket(`ws://127.0.0.1:3001/ws/remote-desktop?ticket=${encodeURIComponent(ticket)}`, 'guacamole', {
    headers: {
      Cookie: cookie,
      Origin: targetOrigin,
    },
  });

const openRemoteDesktopWebSocket = (ticket, cookie) =>
  new Promise((resolve, reject) => {
    const socket = createSocket(ticket, cookie);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Timed out waiting for Guacamole data from backend.'));
    }, 10_000);
    socket.on('message', (message) => {
      const text = message.toString();
      if (!/(?:size|sync|name)/.test(text)) return;
      clearTimeout(timer);
      resolve({ firstMessage: text, close: () => socket.close() });
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

const reuseRemoteDesktopTicket = (ticket, cookie) =>
  new Promise((resolve, reject) => {
    const socket = createSocket(ticket, cookie);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Timed out waiting for reused ticket rejection.'));
    }, 5_000);
    socket.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
    socket.once('error', () => {});
  });

module.exports = { openRemoteDesktopWebSocket, reuseRemoteDesktopTicket };
