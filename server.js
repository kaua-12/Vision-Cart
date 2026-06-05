import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = process.env.PORT || 5173;

// Banco de dados em memória para conexões pareadas
const clients = new Map(); // cartId -> { cartSocket, phoneSocket }

// Servir arquivos estáticos do build de produção
app.use(express.static(path.join(__dirname, 'dist')));

// Upgrade HTTP para WebSocket na rota /ws
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  let clientRole = null;
  let clientCartId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('[PROD WS] Received:', data);

      switch (data.type) {
        case 'register_cart': {
          clientRole = 'cart';
          clientCartId = data.cartId;
          
          if (!clients.has(clientCartId)) {
            clients.set(clientCartId, { cartSocket: null, phoneSocket: null });
          }
          const pair = clients.get(clientCartId);
          pair.cartSocket = ws;
          console.log(`[PROD WS] Cart registered: ${clientCartId}`);
          
          if (pair.phoneSocket) {
            ws.send(JSON.stringify({ type: 'user_connected' }));
            pair.phoneSocket.send(JSON.stringify({ type: 'cart_paired', cartId: clientCartId }));
          }
          break;
        }
        case 'register_phone': {
          clientRole = 'phone';
          clientCartId = data.cartId;
          
          if (!clients.has(clientCartId)) {
            clients.set(clientCartId, { cartSocket: null, phoneSocket: null });
          }
          const pair = clients.get(clientCartId);
          pair.phoneSocket = ws;
          console.log(`[PROD WS] Phone registered: ${clientCartId}`);
          
          if (pair.cartSocket) {
            pair.cartSocket.send(JSON.stringify({ type: 'user_connected' }));
            ws.send(JSON.stringify({ type: 'cart_paired', cartId: clientCartId }));
          }
          break;
        }
        case 'product_scanned': {
          if (clientRole === 'cart' && clientCartId) {
            const pair = clients.get(clientCartId);
            if (pair && pair.phoneSocket) {
              pair.phoneSocket.send(JSON.stringify({ type: 'product_scanned', item: data.item }));
              console.log(`[PROD WS] Forwarded scanned product ${data.item.name} to phone ${clientCartId}`);
            }
          }
          break;
        }
        case 'disconnect_request': {
          if (clientCartId && clients.has(clientCartId)) {
            const pair = clients.get(clientCartId);
            if (pair.cartSocket) {
              pair.cartSocket.send(JSON.stringify({ type: 'user_disconnected' }));
            }
            if (pair.phoneSocket) {
              pair.phoneSocket.send(JSON.stringify({ type: 'cart_disconnected' }));
            }
            clients.delete(clientCartId);
            console.log(`[PROD WS] Disconnected & cleaned up cart: ${clientCartId}`);
          }
          break;
        }
      }
    } catch (e) {
      console.error('[PROD WS] Error handling message:', e);
    }
  });

  ws.on('close', () => {
    if (clientCartId && clients.has(clientCartId)) {
      const pair = clients.get(clientCartId);
      if (clientRole === 'cart') {
        console.log(`[PROD WS] Cart socket closed: ${clientCartId}`);
        pair.cartSocket = null;
        if (pair.phoneSocket) {
          pair.phoneSocket.send(JSON.stringify({ type: 'cart_disconnected' }));
        }
      } else if (clientRole === 'phone') {
        console.log(`[PROD WS] Phone socket closed: ${clientCartId}`);
        pair.phoneSocket = null;
        if (pair.cartSocket) {
          pair.cartSocket.send(JSON.stringify({ type: 'user_disconnected' }));
        }
      }
      if (!pair.cartSocket && !pair.phoneSocket) {
        clients.delete(clientCartId);
      }
    }
  });
});

// Fallback para qualquer outra rota (SPA Routing)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`🚀 Production server running at http://localhost:${PORT}`);
});
