import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { WebSocketServer } from 'ws'

const clients = new Map(); // cartId -> { cartSocket, phoneSocket }

function viteWebSocketPlugin() {
  return {
    name: 'vite-websocket-plugin',
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });

      server.httpServer.on('upgrade', (request, socket, head) => {
        const url = new URL(request.url, `http://${request.headers.host}`);
        if (url.pathname === '/ws') {
          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
          });
        }
      });

      wss.on('connection', (ws) => {
        let clientRole = null;
        let clientCartId = null;

        ws.on('message', (message) => {
          try {
            const data = JSON.parse(message.toString());
            console.log('[WS] Received:', data);

            switch (data.type) {
              case 'register_cart': {
                clientRole = 'cart';
                clientCartId = data.cartId;
                
                if (!clients.has(clientCartId)) {
                  clients.set(clientCartId, { cartSocket: null, phoneSocket: null });
                }
                const pair = clients.get(clientCartId);
                pair.cartSocket = ws;
                console.log(`[WS] Cart registered: ${clientCartId}`);
                
                // Se o telefone já estiver conectado para este carrinho
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
                console.log(`[WS] Phone registered: ${clientCartId}`);
                
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
                    console.log(`[WS] Forwarded scanned product ${data.item.name} to phone ${clientCartId}`);
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
                  console.log(`[WS] Disconnected & cleaned up cart: ${clientCartId}`);
                }
                break;
              }
            }
          } catch (e) {
            console.error('[WS] Error handling message:', e);
          }
        });

        ws.on('close', () => {
          if (clientCartId && clients.has(clientCartId)) {
            const pair = clients.get(clientCartId);
            if (clientRole === 'cart') {
              console.log(`[WS] Cart socket closed: ${clientCartId}`);
              pair.cartSocket = null;
              if (pair.phoneSocket) {
                pair.phoneSocket.send(JSON.stringify({ type: 'cart_disconnected' }));
              }
            } else if (clientRole === 'phone') {
              console.log(`[WS] Phone socket closed: ${clientCartId}`);
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
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), viteWebSocketPlugin()],
  server: {
    allowedHosts: true
  }
})
