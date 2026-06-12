import { useState, useEffect, useRef } from 'react';
import * as tmImage from '@teachablemachine/image';
import db from './database.json';
import './App.css';

function App() {
  const [modelUrl, setModelUrl] = useState('https://teachablemachine.withgoogle.com/models/MMzkgaxOA/');
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cart, setCart] = useState([]);
  const [prediction, setPrediction] = useState(null);
  
  // Roteamento e Estados de Conexão WebSocket
  const [currentRoute, setCurrentRoute] = useState(window.location.pathname + window.location.search);
  const [wsConnected, setWsConnected] = useState(false);
  const [isPaired, setIsPaired] = useState(false);

  // Estados de navegação interna do App Celular
  const [appTab, setAppTab] = useState('home'); // 'home', 'cart', 'checkout', 'profile'
  const [pairedCartId, setPairedCartId] = useState(null); // 'cart-001' | 'cart-042' | 'cart-099' | null
  const [deviceCartId, setDeviceCartId] = useState('cart-042'); // ID do carrinho que o totem representa
  const [pairingCameraSource, setPairingCameraSource] = useState(null); // 'app' | null
  const [lastScannedItems, setLastScannedItems] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState('credit_card'); // 'credit_card', 'pix', 'wallet'
  const [toastMessage, setToastMessage] = useState(null); // Mensagens de toast
  const [cameraFailed, setCameraFailed] = useState(false); // Falha de inicialização da câmera
  const [aiEngine, setAiEngine] = useState(() => localStorage.getItem('visioncart_ai_engine') || 'teachable');
  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem('visioncart_gemini_api_key') || '');
  const [isProcessingGemini, setIsProcessingGemini] = useState(false);
  const [geminiScanMode, setGeminiScanMode] = useState(() => localStorage.getItem('visioncart_gemini_scan_mode') || 'manual');
  const [isAiSettingsOpen, setIsAiSettingsOpen] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState('idle'); // 'idle' | 'scanning' | 'success' | 'error'

  const AVAILABLE_CARTS = [
    { id: 'cart-001', name: 'Carrinho #001', color: '#0ea5e9', emoji: '🔵' },
    { id: 'cart-042', name: 'Carrinho #042', color: '#a855f7', emoji: '🟣' },
    { id: 'cart-099', name: 'Carrinho #099', color: '#14b8a6', emoji: '🟢' }
  ];
  
  // Checkout Form States
  const [cardName, setCardName] = useState('Sarah J. Miller');
  const [cardNumber, setCardNumber] = useState('**** **** **** 4015');
  const [cardExpiry, setCardExpiry] = useState('11/26');
  const [cardCvv, setCardCvv] = useState('***');
  const [saveCardDetails, setSaveCardDetails] = useState(true);

  // Refs
  const videoRef = useRef(null);
  const modelRef = useRef(null);
  const requestRef = useRef(null);
  const cooldownsRef = useRef({});
  const isActiveRef = useRef(false);
  const accumulatorsRef = useRef({});
  const streamRef = useRef(null);
  const cameraSessionIdRef = useRef(0);
  const wsRef = useRef(null);

  // Refs para a câmera de pareamento por QR Code no Celular
  const pairingVideoRef = useRef(null);
  const pairingStreamRef = useRef(null);
  const pairingRequestRef = useRef(null);
  const pairingCanvasRef = useRef(null);
  const debugTextRef = useRef(null);
  const pairingSessionIdRef = useRef(0);
  const isPairingActiveRef = useRef(false);

  // Refs e sincs para o motor Gemini no loop do animframe
  const aiEngineRef = useRef(aiEngine);
  const geminiScanModeRef = useRef(geminiScanMode);
  const geminiApiKeyRef = useRef(geminiApiKey);
  const isProcessingGeminiRef = useRef(isProcessingGemini);
  const geminiLastScanTimeRef = useRef(0);

  useEffect(() => {
    aiEngineRef.current = aiEngine;
  }, [aiEngine]);

  useEffect(() => {
    geminiScanModeRef.current = geminiScanMode;
  }, [geminiScanMode]);

  useEffect(() => {
    geminiApiKeyRef.current = geminiApiKey;
  }, [geminiApiKey]);

  useEffect(() => {
    isProcessingGeminiRef.current = isProcessingGemini;
  }, [isProcessingGemini]);

  // Monitor de popstate para roteamento nativo
  useEffect(() => {
    const handlePopState = () => {
      setCurrentRoute(window.location.pathname + window.location.search);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Gerenciador de conexão WebSocket unificado
  useEffect(() => {
    const isApp = currentRoute.startsWith('/app') || currentRoute.startsWith('/mobile');
    let targetCartId = null;

    if (isApp) {
      const params = new URLSearchParams(window.location.search);
      targetCartId = params.get('cartId') || pairedCartId;
    } else {
      targetCartId = deviceCartId;
    }

    if (!targetCartId) {
      setWsConnected(false);
      setIsPaired(false);
      return;
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
    console.log(`[WebSocket] Conectando a ${wsUrl} para cartId: ${targetCartId}`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      if (isApp) {
        ws.send(JSON.stringify({ type: 'register_phone', cartId: targetCartId }));
      } else {
        ws.send(JSON.stringify({ type: 'register_cart', cartId: targetCartId }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[WebSocket] Mensagem recebida:', data);

        switch (data.type) {
          case 'cart_paired':
            setIsPaired(true);
            setPairedCartId(data.cartId);
            showToast(`🎉 Conectado ao carrinho ${AVAILABLE_CARTS.find(c => c.id === data.cartId)?.name || data.cartId}!`);
            break;
          case 'user_connected':
            setIsPaired(true);
            setPairedCartId(targetCartId);
            showToast('📱 Cliente conectado com sucesso ao totem!');
            break;
          case 'user_disconnected':
            setIsPaired(false);
            setPairedCartId(null);
            clearCart();
            if (isApp) {
              window.history.pushState({}, '', '/app');
              setCurrentRoute('/app');
              setAppTab('home');
            } else {
              window.history.pushState({}, '', '/');
              setCurrentRoute('/');
            }
            showToast('🔌 Cliente desconectou do carrinho.');
            break;
          case 'cart_disconnected':
            setIsPaired(false);
            setPairedCartId(null);
            clearCart();
            if (isApp) {
              window.history.pushState({}, '', '/app');
              setCurrentRoute('/app');
              setAppTab('home');
            } else {
              window.history.pushState({}, '', '/');
              setCurrentRoute('/');
            }
            showToast('🔌 O totem do carrinho foi desconectado.');
            break;
          case 'product_scanned':
            if (isApp) {
              addToCart(data.item);
              setLastScannedItems(prev => {
                if (prev.some(x => x.className === data.item.className)) return prev;
                return [...prev, data.item];
              });
              setTimeout(() => {
                setLastScannedItems(prev => prev.filter(x => x.className !== data.item.className));
              }, 4000);
              showToast(`🛒 ${data.item.name} adicionado ao carrinho!`);
            }
            break;
        }
      } catch (err) {
        console.error('[WebSocket] Erro ao analisar mensagem:', err);
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
      setIsPaired(false);
      console.log('[WebSocket] Conexão fechada.');
    };

    ws.onerror = (err) => {
      console.error('[WebSocket] Erro na conexão:', err);
    };

    return () => {
      ws.close();
    };
  }, [currentRoute, deviceCartId, pairedCartId]);

  // Carregar Modelo Teachable Machine
  useEffect(() => {
    if (modelUrl) {
      loadModel();
    }
  }, [modelUrl]);

  const showToast = (message) => {
    setToastMessage(message);
    if (window.toastTimeout) clearTimeout(window.toastTimeout);
    window.toastTimeout = setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  const stopAllCameras = () => {
    cameraSessionIdRef.current += 1;
    isActiveRef.current = false;
    cancelAnimationFrame(requestRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject = null;
    }
    setPrediction(null);

    pairingSessionIdRef.current += 1;
    isPairingActiveRef.current = false;
    cancelAnimationFrame(pairingRequestRef.current);
    if (pairingStreamRef.current) {
      pairingStreamRef.current.getTracks().forEach(track => track.stop());
      pairingStreamRef.current = null;
    }
    if (pairingVideoRef.current && pairingVideoRef.current.srcObject) {
      pairingVideoRef.current.srcObject = null;
    }
  };

  // Desativa câmeras ao desmontar o componente
  useEffect(() => {
    return () => {
      stopAllCameras();
    };
  }, []);

  const startTeachableCamera = async (sessionId) => {
    setCameraFailed(false);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.error("API de mídia não suportada pelo navegador.");
      setCameraFailed(true);
      return;
    }

    try {
      isActiveRef.current = true;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }
      });

      if (cameraSessionIdRef.current !== sessionId || !isActiveRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraActive(true);
        await videoRef.current.play().catch(e => console.log("Video play interrupted:", e));
        
        if (cameraSessionIdRef.current !== sessionId || !isActiveRef.current) {
          stream.getTracks().forEach(track => track.stop());
          streamRef.current = null;
          videoRef.current.srcObject = null;
          return;
        }

        cancelAnimationFrame(requestRef.current);
        requestRef.current = requestAnimationFrame(loop);
      } else {
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        isActiveRef.current = false;
        setIsCameraActive(false);
      }
    } catch (err) {
      console.error("Erro ao iniciar Teachable Camera:", err);
      if (cameraSessionIdRef.current === sessionId) {
        isActiveRef.current = false;
        setIsCameraActive(false);
        setCameraFailed(true);
      }
    }
  };

  const startPairingCamera = async (sessionId) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.error("API de mídia não suportada para pareamento.");
      return;
    }

    const targetVideo = pairingVideoRef.current;
    if (!targetVideo) {
      console.warn("Elemento de vídeo não pronto para pareamento");
      return;
    }

    try {
      isPairingActiveRef.current = true;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } }
      });

      if (pairingSessionIdRef.current !== sessionId || !isPairingActiveRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      pairingStreamRef.current = stream;
      targetVideo.srcObject = stream;
      targetVideo.setAttribute("playsinline", true);
      await targetVideo.play().catch(e => console.log("Pairing play interrupted:", e));

      if (pairingSessionIdRef.current !== sessionId || !isPairingActiveRef.current) {
        stream.getTracks().forEach(track => track.stop());
        pairingStreamRef.current = null;
        targetVideo.srcObject = null;
        return;
      }

      cancelAnimationFrame(pairingRequestRef.current);
      pairingRequestRef.current = requestAnimationFrame(() => pairingLoop(targetVideo));
    } catch (err) {
      console.error("Erro ao iniciar câmera de pareamento:", err);
      if (pairingSessionIdRef.current === sessionId) {
        isPairingActiveRef.current = false;
        if (debugTextRef.current) {
          debugTextRef.current.innerText = `Erro de Câmera: ${err.name || err.message}`;
        }
      }
    }
  };

  // Gerencia ativação e desligamento de câmeras baseado na conexão real-time
  useEffect(() => {
    stopAllCameras();
    const isApp = currentRoute.startsWith('/app') || currentRoute.startsWith('/mobile');

    if (!isApp) {
      if (isPaired && pairedCartId === deviceCartId) {
        cameraSessionIdRef.current += 1;
        const sessionId = cameraSessionIdRef.current;
        const timer = setTimeout(() => {
          if (!cameraFailed) {
            startTeachableCamera(sessionId);
          }
        }, 50);
        return () => clearTimeout(timer);
      }
    } else {
      if (appTab === 'home' && !isPaired && pairingCameraSource === 'app') {
        pairingSessionIdRef.current += 1;
        const sessionId = pairingSessionIdRef.current;
        const timer = setTimeout(() => {
          startPairingCamera(sessionId);
        }, 50);
        return () => clearTimeout(timer);
      }
    }
  }, [currentRoute, isPaired, pairedCartId, deviceCartId, appTab, pairingCameraSource, cameraFailed]);

  const handleRetryCamera = () => {
    setCameraFailed(false);
    cameraSessionIdRef.current += 1;
    startTeachableCamera(cameraSessionIdRef.current);
  };

  const loadModel = async () => {
    if (!modelUrl) return;
    try {
      const URL = modelUrl.endsWith('/') ? modelUrl : modelUrl + '/';
      const modelURL = URL + 'model.json';
      const metadataURL = URL + 'metadata.json';

      modelRef.current = await tmImage.load(modelURL, metadataURL);
      setIsModelLoaded(true);
    } catch (error) {
      console.error(error);
      if (aiEngineRef.current === 'teachable') {
        showToast("❌ Erro ao carregar o modelo Teachable Machine. Verifique o link.");
      }
    }
  };

  const handlePairSuccess = (detectedCartId) => {
    const path = `/app?cartId=${detectedCartId}`;
    window.history.pushState({}, '', path);
    setCurrentRoute(path);
    setPairedCartId(detectedCartId);
    setIsPaired(true);
    showToast(`🎉 Conectado com sucesso ao ${AVAILABLE_CARTS.find(c => c.id === detectedCartId)?.name || detectedCartId}!`);
  };

  const pairingLoop = (video) => {
    if (!isPairingActiveRef.current || !video || video.paused || video.ended || !pairingStreamRef.current || !video.srcObject) {
      return;
    }

    try {
      if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
        if (!pairingCanvasRef.current) {
          pairingCanvasRef.current = document.createElement('canvas');
        }
        const canvas = pairingCanvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          
          if (!window.scanFrameCount) window.scanFrameCount = 0;
          window.scanFrameCount++;

          if (debugTextRef.current) {
            debugTextRef.current.innerText = `Library: ${window.jsQR ? "✓ jsQR" : "❌ Carregando..."} | Frames: ${window.scanFrameCount}`;
          }

          if (window.jsQR) {
            const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: "attemptBoth",
            });

            if (code && code.data) {
              console.log("QR Code detectado:", code.data);
              const foundCart = AVAILABLE_CARTS.find(c => code.data.includes(c.id));
              if (foundCart) {
                handlePairSuccess(foundCart.id);
                return;
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("Erro ao processar frame do QR code:", err);
    }

    pairingRequestRef.current = requestAnimationFrame(() => pairingLoop(video));
  };

  const toggleAppPairingScanner = () => {
    setPairingCameraSource(prev => prev === 'app' ? null : 'app');
  };

  const handleQrFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (window.jsQR) {
          const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "attemptBoth",
          });
          if (code && code.data) {
            console.log("QR Code detectado via upload:", code.data);
            const foundCart = AVAILABLE_CARTS.find(c => code.data.includes(c.id));
            if (foundCart) {
              handlePairSuccess(foundCart.id);
            } else {
              showToast("⚠️ Código QR detectado, mas não corresponde a nenhum carrinho ativo.");
            }
          } else {
            showToast("⚠️ Não foi possível encontrar nenhum QR Code na imagem.");
          }
        } else {
          showToast("⏳ Biblioteca de leitura de QR Code ainda não carregada. Tente novamente.");
        }
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const scanWithGemini = async () => {
    const apiKey = geminiApiKeyRef.current;
    if (!videoRef.current || isProcessingGeminiRef.current) return;
    
    if (!apiKey) {
      showToast("⚠️ Configure sua Chave de API do Gemini nas configurações!");
      setIsAiSettingsOpen(true);
      return;
    }

    setIsProcessingGemini(true);
    isProcessingGeminiRef.current = true;
    setGeminiStatus('scanning');
    geminiLastScanTimeRef.current = Date.now();

    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Não foi possível criar contexto do canvas");

      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const base64Data = dataUrl.split(',')[1];

      const promptText = `Você é a câmera de um carrinho de supermercado inteligente (VisionCart). Analise a imagem e identifique quais dos seguintes produtos estão presentes na imagem e estão sendo mostrados pelo cliente para compra (você pode identificar múltiplos produtos ao mesmo tempo).

Produtos disponíveis (use exatamente o className indicado):
- Nescau (className: Nescau)
- Pringles (className: Pringles)
- Pão de Forma (className: Pão de Forma)
- Leite Condensado (className: Leite Condensado)
- Cappuccino (className: Cappuccino)
- Enxaguante Bucal (className: Enxaguante Bucal)
- Óleo de Soja (className: Óleo de Soja)
- Sabonete (className: Sabonete)
- Feijão (className: Feijão)
- Açúcar (className: Açúcar)

Retorne APENAS um array JSON de strings com os classNames dos produtos detectados que estão sendo apresentados para escaneamento. Se nenhum produto estiver claramente na imagem ou se for apenas o fundo/mão/carrinho vazio, retorne um array vazio [].
Não adicione explicações, blocos de código markdown ou texto extra. Retorne apenas a lista de strings formatada como um array JSON válido.
Exemplo de resposta esperada: ["Nescau", "Pringles"]`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: promptText },
                {
                  inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Data
                  }
                }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: 'application/json'
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Erro na API: ${response.status} - ${errText}`);
      }

      const resData = await response.json();
      const responseText = resData.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (responseText) {
        const detectedClassNames = JSON.parse(responseText.trim());
        if (Array.isArray(detectedClassNames)) {
          let scannedAny = false;
          const itemsToScan = [];

          detectedClassNames.forEach(className => {
            const dbItem = db.find(item => item.className.toLowerCase() === className.trim().toLowerCase());
            if (dbItem) {
              itemsToScan.push(dbItem);
              scannedAny = true;
            }
          });

          if (scannedAny) {
            itemsToScan.forEach(item => {
              triggerProductScanned(item);
            });
            setGeminiStatus('success');
            showToast(`✨ Gemini detectou: ${itemsToScan.map(i => i.name).join(', ')}`);
          } else {
            setGeminiStatus('idle');
          }
        }
      }
    } catch (error) {
      console.error("Erro no escaneamento Gemini:", error);
      setGeminiStatus('error');
      showToast(`❌ Erro no Gemini: ${error.message}`);
    } finally {
      setIsProcessingGemini(false);
      isProcessingGeminiRef.current = false;
      setTimeout(() => {
        setGeminiStatus('idle');
      }, 1500);
    }
  };

  const loop = async () => {
    try {
      if (!isActiveRef.current) return;
      
      const currentEngine = aiEngineRef.current;
      if (currentEngine === 'teachable') {
        if (videoRef.current && modelRef.current && videoRef.current.readyState >= 2) {
          await predict();
        }
      } else if (currentEngine === 'gemini') {
        const currentMode = geminiScanModeRef.current;
        const processing = isProcessingGeminiRef.current;
        if (currentMode === 'auto' && !processing) {
          const now = Date.now();
          if (now - geminiLastScanTimeRef.current >= 4000) {
            if (videoRef.current && videoRef.current.readyState >= 2) {
              await scanWithGemini();
            }
          }
        }
      }
    } catch (error) {
      console.error("Erro no loop:", error);
    }
    if (isActiveRef.current) {
      requestRef.current = requestAnimationFrame(loop);
    }
  };

  // Atalho de teclado para escaneamento manual (Espaço)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === ' ' || e.code === 'Space') {
        // Apenas se o totem estiver visível, com Gemini no modo manual e sem modais abertos
        const isApp = window.location.pathname.startsWith('/app') || window.location.pathname.startsWith('/mobile');
        if (!isApp && aiEngineRef.current === 'gemini' && geminiScanModeRef.current === 'manual' && !isAiSettingsOpen && isCameraActive && !isProcessingGeminiRef.current) {
          e.preventDefault();
          scanWithGemini();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAiSettingsOpen, isCameraActive]);

  const predict = async () => {
    if (!modelRef.current || !videoRef.current) return;
    const predictions = await modelRef.current.predict(videoRef.current);
    const bestPrediction = predictions.reduce((prev, current) => {
      return (prev.probability > current.probability) ? prev : current;
    });
    setPrediction(bestPrediction);

    const isBackgroundBest = bestPrediction.className.trim().toLowerCase() === 'fundo' && bestPrediction.probability > 0.65;

    predictions.forEach(pred => {
      const className = pred.className.trim();
      const probability = pred.probability;
      const dbItem = db.find(item => item.className.toLowerCase() === className.toLowerCase());

      if (dbItem) {
        const inCooldown = cooldownsRef.current[dbItem.className];
        if (probability > 0.20 && !inCooldown) {
          accumulatorsRef.current[dbItem.className] = (accumulatorsRef.current[dbItem.className] || 0) + 1;
          if (accumulatorsRef.current[dbItem.className] >= 3) {
            triggerProductScanned(dbItem);
          }
        } else if (probability < 0.10) {
          accumulatorsRef.current[dbItem.className] = Math.max(0, (accumulatorsRef.current[dbItem.className] || 0) - 0.5);
        }
      }
    });

    if (isBackgroundBest) {
      Object.keys(accumulatorsRef.current).forEach(key => {
        accumulatorsRef.current[key] = Math.max(0, accumulatorsRef.current[key] - 1);
      });
    }
  };

  const triggerProductScanned = (item) => {
    // Se estiver conectado a um socket, envia o produto em tempo real para o celular
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'product_scanned', item }));
    }

    // Exibe notificação local no visor do totem
    setLastScannedItems(prev => {
      if (prev.some(x => x.className === item.className)) return prev;
      return [...prev, item];
    });
    
    cooldownsRef.current[item.className] = true;
    accumulatorsRef.current[item.className] = 0;
    
    setTimeout(() => {
      setLastScannedItems(prev => prev.filter(x => x.className !== item.className));
    }, 4000);

    setTimeout(() => {
      cooldownsRef.current[item.className] = false;
    }, 3000);
  };

  const addToCart = (item) => {
    setCart(prevCart => {
      const existing = prevCart.find(cartItem => cartItem.className === item.className);
      if (existing) {
        return prevCart.map(cartItem => 
          cartItem.className === item.className ? { ...cartItem, qty: cartItem.qty + 1 } : cartItem
        );
      }
      return [...prevCart, { ...item, qty: 1 }];
    });
  };

  const updateQty = (className, amount) => {
    setCart(prevCart => {
      return prevCart.map(item => {
        if (item.className === className) {
          const newQty = item.qty + amount;
          return newQty > 0 ? { ...item, qty: newQty } : null;
        }
        return item;
      }).filter(Boolean);
    });
  };

  const removeFromCart = (className) => {
    setCart(prevCart => prevCart.filter(item => item.className !== className));
  };

  const clearCart = () => {
    setCart([]);
    setLastScannedItems([]);
  };

  // Cálculo de totais
  const subtotal = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);
  const tax = subtotal * 0.06;
  const total = subtotal + tax;
  const totalItemsCount = cart.reduce((acc, item) => acc + item.qty, 0);

  const handleCheckoutSubmit = (e) => {
    e.preventDefault();
    showToast(`🎉 Pagamento de R$ ${total.toFixed(2).replace('.', ',')} realizado com sucesso! Compra Sem Filas!`);
    clearCart();
    
    // Desconecta o celular do totem
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'disconnect_request' }));
    }

    // Retorna para a home desconectado
    window.history.pushState({}, '', '/app');
    setCurrentRoute('/app');
    setPairedCartId(null);
    setIsPaired(false);
    setAppTab('home');
  };

  const handleDisconnect = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'disconnect_request' }));
    }
    const isMobile = currentRoute.startsWith('/app') || currentRoute.startsWith('/mobile');
    if (isMobile) {
      window.history.pushState({}, '', '/app');
      setCurrentRoute('/app');
      setAppTab('home');
    } else {
      window.history.pushState({}, '', '/');
      setCurrentRoute('/');
    }
    setPairedCartId(null);
    setIsPaired(false);
    clearCart();
    showToast("🔌 Carrinho despareado com sucesso.");
  };

  const isApp = currentRoute.startsWith('/app') || currentRoute.startsWith('/mobile');

  return (
    <div className="app-container">
      {toastMessage && (
        <div className="custom-toast glass-panel">
          <span className="toast-text">{toastMessage}</span>
        </div>
      )}

      {/* RENDER MODO 1: MOBILE APP CELULAR */}
      {isApp ? (
        <div className="app-view-container slide-in">
          <div className="app-mobile-shell">
            {/* Header Mobile */}
            <header className="app-header glass-panel mobile-header">
              <div className="header-logo" onClick={() => { window.history.pushState({}, '', '/app'); setCurrentRoute('/app'); }}>
                <span className="logo-emoji">📱</span>
                <span className="logo-text">VisionCart Mobile</span>
              </div>
              {isPaired && (
                <div className="header-status">
                  <span className="sync-badge" style={{ borderColor: AVAILABLE_CARTS.find(c => c.id === pairedCartId)?.color + '40', color: AVAILABLE_CARTS.find(c => c.id === pairedCartId)?.color, backgroundColor: AVAILABLE_CARTS.find(c => c.id === pairedCartId)?.color + '15', margin: 0 }}>
                    <span className="sync-indicator pulse-dot" style={{ backgroundColor: AVAILABLE_CARTS.find(c => c.id === pairedCartId)?.color }}></span>
                    {AVAILABLE_CARTS.find(c => c.id === pairedCartId)?.name}
                  </span>
                </div>
              )}
            </header>

            {/* Menu de Abas Mobile */}
            <div className="app-mobile-navbar glass-panel">
              <button 
                className={`app-nav-item ${appTab === 'home' ? 'active' : ''}`}
                onClick={() => setAppTab('home')}
              >
                🏠 Início
              </button>
              <button 
                className={`app-nav-item ${appTab === 'cart' ? 'active' : ''}`}
                onClick={() => setAppTab('cart')}
              >
                🛒 Carrinho
                {isPaired && cart.length > 0 && <span className="app-badge-count">{totalItemsCount}</span>}
              </button>
              <button 
                className={`app-nav-item ${appTab === 'checkout' ? 'active' : ''}`}
                onClick={() => setAppTab('checkout')}
              >
                💳 Pagamento
              </button>
              <button 
                className={`app-nav-item ${appTab === 'profile' ? 'active' : ''}`}
                onClick={() => setAppTab('profile')}
              >
                👤 Perfil
              </button>
            </div>

            {/* Conteúdo Mobile */}
            <div className="app-mobile-content">
              {appTab === 'home' && (
                <div className="app-home-tab slide-in">
                  {!isPaired ? (
                    <div className="pairing-container glass-panel">
                      {pairingCameraSource === 'app' ? (
                        <div className="app-pairing-camera-view">
                          <div className="pairing-header">
                            <span className="pairing-device-icon">📸</span>
                            <h2>Escanear QR do Carrinho</h2>
                            <p>Aponte a câmera do seu celular para o QR Code exibido no monitor do Carrinho Inteligente.</p>
                          </div>

                          <div className="app-camera-viewport">
                            <video 
                              ref={pairingVideoRef} 
                              autoPlay 
                              playsInline 
                              muted 
                              className="app-camera-feed active"
                            />
                            <div className="qr-scanner-overlay">
                              <div className="scanner-laser-line"></div>
                              <div className="scanner-target-corners"></div>
                              <div ref={debugTextRef} className="scanner-debug-info">Aguardando câmera...</div>
                            </div>
                          </div>

                          <div className="camera-upload-backup" style={{ marginTop: '1rem', width: '100%' }}>
                            <input 
                              type="file" 
                              accept="image/*" 
                              id="app-qr-upload" 
                              style={{ display: 'none' }} 
                              onChange={handleQrFileUpload} 
                            />
                            <label htmlFor="app-qr-upload" className="btn-action-secondary upload-backup-btn" style={{ width: '100%', display: 'block', textAlign: 'center' }}>
                              📁 Enviar Foto do QR Code (Bypass)
                            </label>
                          </div>

                          <button 
                            className="btn-action-secondary"
                            onClick={() => setPairingCameraSource(null)}
                            style={{marginTop: '1.5rem', width: '100%', borderRadius: '12px'}}
                          >
                            Voltar para os Meus QR Codes
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="pairing-header">
                            <span className="pairing-device-icon">📟</span>
                            <h2>Sincronizar com um Carrinho</h2>
                            <p>Selecione um dos carrinhos disponíveis abaixo para se conectar ou abra a câmera do celular para ler o QR Code da tela.</p>
                          </div>

                          <div className="pairing-instructions-box">
                            <h4>Opção 1: Conectar Instantaneamente</h4>
                            <p>Clique em conectar em um dos carrinhos de simulação abaixo:</p>
                          </div>

                          <div className="multi-qrcode-container">
                            {AVAILABLE_CARTS.map(c => (
                              <div key={c.id} className="qrcode-card glass-panel" style={{ borderTop: `3px solid ${c.color}` }}>
                                <div className="qrcode-card-header">
                                  <span className="qrcode-card-emoji">{c.emoji}</span>
                                  <span className="qrcode-card-title">{c.name}</span>
                                </div>
                                <div className="pairing-cart-code" style={{ fontSize: '0.85rem', padding: '2px 8px', marginTop: '6px', color: c.color, backgroundColor: c.color + '15' }}>{c.id}</div>
                                
                                <button
                                  className="btn-action-primary btn-pair-device-small"
                                  style={{ backgroundColor: c.color, color: '#060913', fontSize: '0.85rem', padding: '6px 12px', marginTop: '10px' }}
                                  onClick={() => {
                                    const path = `/app?cartId=${c.id}`;
                                    window.history.pushState({}, '', path);
                                    setCurrentRoute(path);
                                    setPairedCartId(c.id);
                                  }}
                                >
                                  Conectar
                                </button>
                              </div>
                            ))}
                          </div>

                          <div className="pairing-instructions-box" style={{marginTop: '1.5rem'}}>
                            <h4>Opção 2: Usar Câmera do Celular</h4>
                            <p>Aponte a câmera para o QR Code exibido no monitor do carrinho inteligente.</p>
                          </div>

                          <button 
                            className="btn-action-primary btn-pair-device"
                            onClick={toggleAppPairingScanner}
                          >
                            📷 Escanear QR Code do Totem
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="app-welcome-banner glass-panel" style={{ borderLeft: `6px solid ${AVAILABLE_CARTS.find(c => c.id === pairedCartId)?.color || '#10b981'}` }}>
                        <div className="welcome-info">
                          <h1>Olá! 👋</h1>
                          <p>Seu celular está pareado com o <strong>{AVAILABLE_CARTS.find(c => c.id === pairedCartId)?.name}</strong>.</p>
                          <div className="sync-badge" style={{ borderColor: AVAILABLE_CARTS.find(c => c.id === pairedCartId)?.color + '40', color: AVAILABLE_CARTS.find(c => c.id === pairedCartId)?.color, backgroundColor: AVAILABLE_CARTS.find(c => c.id === pairedCartId)?.color + '15' }}>
                            <span className="sync-indicator pulse-dot" style={{ backgroundColor: AVAILABLE_CARTS.find(c => c.id === pairedCartId)?.color }}></span>
                            Sincronizado e Pronto para Scanner
                          </div>
                        </div>
                        <button 
                          className="btn-disconnect-cart"
                          onClick={handleDisconnect}
                        >
                          Desconectar Carrinho
                        </button>
                      </div>

                      <div className="app-instruction-grid">
                        <div className="instruction-card glass-panel">
                          <span className="inst-icon">📟</span>
                          <h3>Coloque itens no Carrinho</h3>
                          <p>Aponte os produtos para a câmera do monitor do totem. Eles serão identificados por IA.</p>
                        </div>
                        <div className="instruction-card glass-panel">
                          <span className="inst-icon">🛒</span>
                          <h3>Acompanhe no Celular</h3>
                          <p>Os itens aparecem e somam em tempo real na aba <strong>Carrinho</strong> do seu celular.</p>
                        </div>
                      </div>

                      <div className="app-promo-box glass-panel">
                        <h3>Descontos Exclusivos 🏷️</h3>
                        <div className="promo-list">
                          <div className="promo-item">
                            <span>🥤 Coca-Cola Lata</span>
                            <strong>Leve 3 por R$14,00</strong>
                          </div>
                          <div className="promo-item">
                            <span>☕ Café Melitta</span>
                            <strong>10% OFF direto</strong>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {appTab === 'cart' && (
                <div className="app-cart-tab slide-in">
                  {!isPaired ? (
                    <div className="glass-panel empty-cart-view">
                      <span className="empty-cart-icon">🔒</span>
                      <h3>Carrinho Bloqueado</h3>
                      <p>Por favor, pareie seu aplicativo com um carrinho inteligente na aba <strong>Início</strong> antes de ver seus itens.</p>
                      <button className="btn-pill-blue" style={{marginTop: '1.5rem', width: 'auto', padding: '0.6rem 1.5rem'}} onClick={() => setAppTab('home')}>
                        Ir para o Pareamento
                      </button>
                    </div>
                  ) : (
                    <div className="cart-grid">
                      <div className="cart-items-section glass-panel">
                        <h2>Itens no Carrinho</h2>
                        
                        <div className="cart-items-list">
                          {cart.length === 0 ? (
                            <div className="empty-cart-view">
                              <span className="empty-cart-icon">🛒</span>
                              <h3>Nenhum produto escaneado</h3>
                              <p>Coloque algum produto em frente à câmera do totem do carrinho para registrá-lo.</p>
                            </div>
                          ) : (
                            cart.map(item => (
                              <div key={item.className} className="cart-item-card">
                                <div className="cart-item-emoji">{item.image}</div>
                                <div className="cart-item-details">
                                  <div className="cart-item-title">{item.name}</div>
                                  <div className="cart-item-subtitle">R$ {item.price.toFixed(2).replace('.', ',')} / {item.weight || "un"}</div>
                                </div>
                                <div className="cart-item-actions">
                                  <button className="qty-btn" onClick={() => updateQty(item.className, -1)}>-</button>
                                  <span className="qty-val">{item.qty}</span>
                                  <button className="qty-btn" onClick={() => updateQty(item.className, 1)}>+</button>
                                </div>
                                <div className="cart-item-total">
                                  R$ {(item.price * item.qty).toFixed(2).replace('.', ',')}
                                </div>
                                <button className="delete-item-btn" onClick={() => removeFromCart(item.className)} title="Remover item">
                                  🗑️
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {cart.length > 0 && (
                        <div className="cart-summary-section glass-panel">
                          <h3>Resumo do Pedido</h3>
                          <div className="summary-details">
                            <div className="summary-row">
                              <span>Subtotal</span>
                              <span>R$ {subtotal.toFixed(2).replace('.', ',')}</span>
                            </div>
                            <div className="summary-row">
                              <span>Imposto (6%)</span>
                              <span>R$ {tax.toFixed(2).replace('.', ',')}</span>
                            </div>
                            <div className="summary-row grand-total">
                              <span>Total</span>
                              <span>R$ {total.toFixed(2).replace('.', ',')}</span>
                            </div>
                          </div>

                          <button 
                            className="btn-action-primary btn-checkout-teal"
                            onClick={() => setAppTab('checkout')}
                          >
                            Pagar R$ {total.toFixed(2).replace('.', ',')} ›
                          </button>
                          <button className="btn-cart-clear-large" onClick={clearCart}>
                            Esvaziar Carrinho
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {appTab === 'checkout' && (
                <div className="app-checkout-tab slide-in">
                  {!isPaired ? (
                    <div className="glass-panel empty-cart-view">
                      <span className="empty-cart-icon">🔒</span>
                      <h3>Pagamento Bloqueado</h3>
                      <p>Por favor, pareie seu aplicativo com um carrinho inteligente na aba <strong>Início</strong> para realizar o pagamento.</p>
                      <button className="btn-pill-blue" style={{marginTop: '1.5rem', width: 'auto', padding: '0.6rem 1.5rem'}} onClick={() => setAppTab('home')}>
                        Ir para o Pareamento
                      </button>
                    </div>
                  ) : cart.length === 0 ? (
                    <div className="glass-panel empty-checkout-box" style={{padding: '3rem', textAlign: 'center'}}>
                      <span style={{fontSize: '3rem', display: 'block', marginBottom: '1rem'}}>💳</span>
                      <h3>Seu carrinho está vazio</h3>
                      <p>Adicione produtos antes de ir para o pagamento.</p>
                    </div>
                  ) : (
                    <div className="checkout-grid">
                      <div className="checkout-payment-section glass-panel">
                        <h2>Forma de Pagamento</h2>
                        
                        <div className="payment-methods-grid">
                          <div 
                            className={`payment-method-card ${paymentMethod === 'credit_card' ? 'active' : ''}`}
                            onClick={() => setPaymentMethod('credit_card')}
                          >
                            <span className="payment-method-icon">💳</span>
                            <span>Cartão de Crédito</span>
                          </div>
                          <div 
                            className={`payment-method-card ${paymentMethod === 'pix' ? 'active' : ''}`}
                            onClick={() => setPaymentMethod('pix')}
                          >
                            <span className="payment-method-icon">📱</span>
                            <span>Pix Copia/Cola</span>
                          </div>
                          <div 
                            className={`payment-method-card ${paymentMethod === 'wallet' ? 'active' : ''}`}
                            onClick={() => setPaymentMethod('wallet')}
                          >
                            <span className="payment-method-icon">🌐</span>
                            <span>Apple / Google Pay</span>
                          </div>
                        </div>

                        {paymentMethod === 'credit_card' && (
                          <form onSubmit={handleCheckoutSubmit} className="checkout-form">
                            <div className="form-group">
                              <label htmlFor="cardName">Titular do Cartão</label>
                              <input 
                                id="cardName"
                                type="text" 
                                className="form-input" 
                                value={cardName}
                                onChange={(e) => setCardName(e.target.value)}
                                required
                              />
                            </div>

                            <div className="form-group">
                              <label htmlFor="cardNumber">Número do Cartão</label>
                              <input 
                                id="cardNumber"
                                type="text" 
                                className="form-input" 
                                value={cardNumber}
                                onChange={(e) => setCardNumber(e.target.value)}
                                required
                              />
                            </div>

                            <div className="form-row">
                              <div className="form-group">
                                <label htmlFor="cardExpiry">Validade</label>
                                <input 
                                  id="cardExpiry"
                                  type="text" 
                                  className="form-input" 
                                  value={cardExpiry}
                                  onChange={(e) => setCardExpiry(e.target.value)}
                                  placeholder="MM/AA"
                                  required
                                />
                              </div>
                              <div className="form-group">
                                <label htmlFor="cardCvv">CVV</label>
                                <input 
                                  id="cardCvv"
                                  type="password" 
                                  className="form-input" 
                                  value={cardCvv}
                                  onChange={(e) => setCardCvv(e.target.value)}
                                  maxLength="3"
                                  required
                                />
                              </div>
                            </div>

                            <div className="form-toggle-row">
                              <span>Salvar dados para futuras compras</span>
                              <label className="toggle-switch">
                                <input 
                                  type="checkbox" 
                                  checked={saveCardDetails}
                                  onChange={(e) => setSaveCardDetails(e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                              </label>
                            </div>

                            <button 
                              type="submit" 
                              className="btn-action-primary btn-secure-pay"
                            >
                              🔒 Confirmar Pagamento (R$ {total.toFixed(2).replace('.', ',')})
                            </button>
                          </form>
                        )}

                        {paymentMethod === 'pix' && (
                          <div className="pix-checkout-view">
                            <div style={{fontSize: '3rem'}}>📱</div>
                            <h3>Código Pix Gerado</h3>
                            <p>Copie o código abaixo e pague no app do seu banco:</p>
                            <div className="pix-code-box">
                              00020101021226850014br.gov.bcb.pix2563pix-qr.mercadopago.com/emv/v2/53594821a8-77ea-4878-a5b0-01b57821b70f5204000053039865406{total.toFixed(2)}5802BR5909VisionCart6009SaoPaulo62070503***6304D1B2
                            </div>
                            <button 
                              className="btn-action-primary btn-secure-pay"
                              onClick={() => {
                                showToast("📋 Código Pix copiado! Processando confirmação...");
                                setTimeout(() => {
                                  showToast("✅ Pagamento confirmado via Pix!");
                                  clearCart();
                                  
                                  // Desconecta o totem do carrinho
                                  if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                                    wsRef.current.send(JSON.stringify({ type: 'disconnect_request' }));
                                  }
                                  
                                  window.history.pushState({}, '', '/app');
                                  setCurrentRoute('/app');
                                  setPairedCartId(null);
                                  setIsPaired(false);
                                  setAppTab('home');
                                }, 1500);
                              }}
                            >
                              Copiar Pix e Confirmar
                            </button>
                          </div>
                        )}

                        {paymentMethod === 'wallet' && (
                          <div className="wallet-checkout-view">
                            <div style={{fontSize: '3.5rem'}}>🌐</div>
                            <h3>Pague com sua Carteira Digital</h3>
                            <p>Rápido e seguro usando Apple Pay ou Google Pay.</p>
                            <button 
                              className="btn-action-primary btn-secure-pay"
                              style={{background: 'white', color: 'black', marginTop: '1.5rem'}}
                              onClick={() => {
                                showToast("🔒 Autenticando com sua carteira digital...");
                                setTimeout(() => {
                                  showToast("✅ Pagamento confirmado com sucesso!");
                                  clearCart();
                                  
                                  // Desconecta o totem do carrinho
                                  if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                                    wsRef.current.send(JSON.stringify({ type: 'disconnect_request' }));
                                  }

                                  window.history.pushState({}, '', '/app');
                                  setCurrentRoute('/app');
                                  setPairedCartId(null);
                                  setIsPaired(false);
                                  setAppTab('home');
                                }, 1500);
                              }}
                            >
                              Pagar com Carteira Digital
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="checkout-summary-section glass-panel">
                        <h3>Resumo do Pedido</h3>
                        
                        <div className="checkout-amount-box">
                          <div className="checkout-amount-title">Total a Pagar</div>
                          <div className="checkout-amount-val">R$ {total.toFixed(2).replace('.', ',')}</div>
                          <div className="checkout-amount-sub">
                            {totalItemsCount} produtos no carrinho
                          </div>
                        </div>

                        <div className="checkout-summary-items-list">
                          {cart.map(item => (
                            <div key={item.className} className="checkout-summary-item">
                              <span>{item.image} {item.name} (x{item.qty})</span>
                              <span>R$ {(item.price * item.qty).toFixed(2).replace('.', ',')}</span>
                            </div>
                          ))}
                        </div>

                        <div className="security-notice">
                          <span className="security-icon">🔒</span>
                          <p>Suas informações de pagamento são encriptadas de ponta a ponta.</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {appTab === 'profile' && (
                <div className="app-profile-tab slide-in">
                  <div className="profile-grid">
                    <div className="profile-card glass-panel">
                      <div className="profile-avatar">👤</div>
                      <h2 className="profile-name">Arthur S Portaluppi</h2>
                      <div className="profile-email">arthur.portaluppi@exemplo.com</div>
                    </div>

                    <div className="profile-details-section">
                      <div className="glass-panel profile-settings-box">
                        <h3>Configurações do App</h3>
                        <div className="profile-settings-item">
                          <span>Histórico de Compras</span>
                          <span>›</span>
                        </div>
                        <div className="profile-settings-item">
                          <span>Métodos de Pagamento Salvos</span>
                          <span>›</span>
                        </div>
                        <div className="profile-settings-item">
                          <span>Preferências de Notificação</span>
                          <span>›</span>
                        </div>
                      </div>

                      <div className="glass-panel profile-about-box">
                        <h3>Sobre o VisionCart</h3>
                        <p>Este sistema simula o checkout autônomo. O dispositivo acoplado ao carrinho escaneia produtos com IA e envia as informações automaticamente para o celular do cliente.</p>
                        <p className="tech-stack-desc">Desenvolvido com React + Vite + TensorFlow.js.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* RENDER MODO 2: TOTEM DO CARRINHO (KIOSK/MONITOR SCREEN) */
        <div className="device-view-container slide-in">
          {/* Header do Totem */}
          <header className="app-header glass-panel" style={{ width: '100%', maxWidth: '860px', marginBottom: '1.5rem', borderRadius: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem' }}>
            <div className="header-logo">
              <span className="logo-emoji">🛒</span>
              <span className="logo-text">VisionCart Monitor</span>
            </div>
            <div className="header-status" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              {/* Seletor de IA */}
              <div className="ai-engine-selector-container">
                <select 
                  value={aiEngine} 
                  onChange={(e) => {
                    const val = e.target.value;
                    setAiEngine(val);
                    localStorage.setItem('visioncart_ai_engine', val);
                    showToast(`🤖 Motor de IA alterado para: ${val === 'gemini' ? 'Gemini 1.5 Flash' : 'Teachable Machine'}`);
                  }}
                  className="ai-engine-select"
                >
                  <option value="teachable">Teachable Machine (Local)</option>
                  <option value="gemini">Gemini 1.5 Flash (Nuvem)</option>
                </select>
              </div>

              {/* Botão de Configurações */}
              <button 
                onClick={() => setIsAiSettingsOpen(true)}
                className="btn-ai-settings"
                title="Configurações de IA"
              >
                ⚙️
              </button>

              <span className="monitor-status">
                <span className={`pulse-dot ${isPaired ? 'green' : 'red'}`} style={{ backgroundColor: isPaired ? 'var(--success)' : 'var(--danger)' }}></span>
                {isPaired ? 'CONECTADO' : 'AGUARDANDO APP'}
              </span>
            </div>
          </header>

          <div className="device-monitor glass-panel" style={{ borderTop: `4px solid ${AVAILABLE_CARTS.find(c => c.id === deviceCartId)?.color}` }}>
            
            {/* ESTADO 2A: NÃO CONECTADO (MOSTRA O QR CODE DE PAREAMENTO) */}
            {!isPaired ? (
              <div className="device-monitor-disconnected-layout">
                {/* Seletor de Simulador de Carrinho Físico */}
                <div className="physical-cart-selector" style={{ marginBottom: '1rem' }}>
                  <span className="selector-title">Selecionar Carrinho Físico:</span>
                  <div className="selector-options">
                    {AVAILABLE_CARTS.map(c => (
                      <button
                        key={c.id}
                        className={`selector-option-btn ${deviceCartId === c.id ? 'active' : ''}`}
                        onClick={() => setDeviceCartId(c.id)}
                        style={{ borderBottom: deviceCartId === c.id ? `3px solid ${c.color}` : '3px solid transparent' }}
                      >
                        <span className="dot" style={{ backgroundColor: c.color }}></span>
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="device-monitor-header" style={{ border: 'none', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' }}>
                  <h2>Conecte seu celular para começar</h2>
                  <p style={{ color: 'var(--text-secondary)', maxWidth: '500px', fontSize: '0.95rem' }}>
                    Escaneie o código QR abaixo com a câmera do seu smartphone. Isso abrirá o aplicativo de checkout e conectará seu carrinho.
                  </p>
                </div>

                <div className="device-pairing-qrcode-section" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '1rem' }}>
                  <div className="qrcode-mock-wrapper large" style={{ background: 'white', padding: '16px', borderRadius: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }}>
                    <img 
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${window.location.protocol}//${window.location.host}/app?cartId=${deviceCartId}`} 
                      alt={`QR Code para conectar ao ${deviceCartId}`}
                      style={{ width: '220px', height: '220px', display: 'block' }}
                    />
                  </div>
                  <div className="pairing-cart-code" style={{ backgroundColor: AVAILABLE_CARTS.find(c => c.id === deviceCartId)?.color + '20', color: AVAILABLE_CARTS.find(c => c.id === deviceCartId)?.color, marginTop: '1.25rem', padding: '6px 16px', borderRadius: '20px', fontWeight: 'bold' }}>
                    {AVAILABLE_CARTS.find(c => c.id === deviceCartId)?.name}
                  </div>
                </div>
              </div>
            ) : (
              /* ESTADO 2B: CONECTADO (MOSTRA A CÂMERA DE RASTREAMENTO IA E PRODUTOS DETECTADOS) */
              <div className="device-monitor-connected-layout">
                <div className="device-monitor-header">
                  <div className="monitor-status">
                    <span className="pulse-dot" style={{ 
                      backgroundColor: isCameraActive 
                        ? (aiEngine === 'gemini' 
                          ? (geminiApiKey ? 'var(--success)' : '#f59e0b') 
                          : (isModelLoaded ? 'var(--success)' : '#f59e0b')) 
                        : 'var(--danger)' 
                    }}></span>
                    {isCameraActive 
                      ? (aiEngine === 'gemini' 
                        ? (geminiApiKey ? "CÂMERA ATIVA & GEMINI VISION AI" : "⚠️ SEM CHAVE DE API DO GEMINI") 
                        : (isModelLoaded ? "CÂMERA ATIVA & MODELO IA CARREGADO" : "🤖 CARREGANDO MODELO IA...")) 
                      : "INICIANDO CÂMERA..."}
                  </div>
                  <div className="monitor-cart-id" style={{ backgroundColor: AVAILABLE_CARTS.find(c => c.id === deviceCartId)?.color + '20', color: AVAILABLE_CARTS.find(c => c.id === deviceCartId)?.color }}>
                    {AVAILABLE_CARTS.find(c => c.id === deviceCartId)?.name.toUpperCase()}
                  </div>
                </div>

                <div className="device-camera-viewport" style={{ marginTop: '1rem' }}>
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    muted 
                    className={`device-camera-feed ${isCameraActive ? "active" : ""}`}
                  />
                  
                  {isCameraActive && aiEngine === 'gemini' && (
                    <div className={`gemini-scanner-overlay ${geminiStatus}`}>
                      <div className="gemini-scanner-line"></div>
                      <div className="gemini-scanner-indicator">
                        {geminiStatus === 'scanning' && <span className="gemini-pulse-text">🤖 Analisando com Gemini...</span>}
                        {geminiStatus === 'success' && <span className="gemini-pulse-text success">✓ Detectado!</span>}
                        {geminiStatus === 'error' && <span className="gemini-pulse-text error">❌ Erro no scanner</span>}
                        {geminiStatus === 'idle' && <span className="gemini-pulse-text idle">Gemini Vision AI Ativo</span>}
                      </div>
                    </div>
                  )}
                  {isCameraActive && aiEngine === 'teachable' && <div className="device-scanner-overlay"></div>}
                  
                  {!isCameraActive && (
                    <div className="camera-placeholder">
                      <span className="camera-placeholder-icon">📸</span>
                      <h3>Iniciando Câmera do Totem...</h3>
                      <p>Por favor, conceda permissão de webcam para o scanner funcionar.</p>
                      <button className="btn-pill-blue" style={{width: 'auto', padding: '0.65rem 1.5rem', marginTop: '1rem'}} onClick={handleRetryCamera}>
                        Tentar Novamente
                      </button>
                    </div>
                  )}

                  {isCameraActive && aiEngine === 'teachable' && prediction && prediction.probability > 0.5 && db.some(item => item.className.toLowerCase() === prediction.className.toLowerCase().trim()) && (
                    <div className="device-prediction-overlay">
                      Identificado: {prediction.className} ({(prediction.probability * 100).toFixed(0)}%)
                    </div>
                  )}
                </div>

                {isCameraActive && aiEngine === 'gemini' && (
                  <div className="gemini-control-panel" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {geminiScanMode === 'manual' ? (
                      <button 
                        className={`btn-action-primary gemini-scan-btn ${isProcessingGemini ? 'loading' : ''}`}
                        onClick={scanWithGemini}
                        disabled={isProcessingGemini}
                        style={{ width: '100%', padding: '12px', fontSize: '1rem', borderRadius: '14px', backgroundColor: 'var(--accent)', color: '#060913', fontWeight: 'bold' }}
                      >
                        {isProcessingGemini ? '🔍 Analisando Imagem...' : '📷 Escanear Agora (Ou Pressione Espaço)'}
                      </button>
                    ) : (
                      <div className="gemini-auto-indicator" style={{ width: '100%', padding: '12px', textAlign: 'center', borderRadius: '14px', backgroundColor: 'rgba(14, 165, 233, 0.1)', border: '1px dashed rgba(14, 165, 233, 0.3)', color: 'var(--accent)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        <span className="sync-indicator pulse-dot" style={{ backgroundColor: 'var(--accent)', position: 'relative', transform: 'none', top: 'auto', left: 'auto', display: 'inline-block' }}></span>
                        🔄 Escaneando automaticamente a cada 4 segundos...
                      </div>
                    )}
                  </div>
                )}

                <div className="device-monitor-footer" style={{ marginTop: '1rem' }}>
                  {lastScannedItems.length === 0 ? (
                    <div className="device-instruction-text">
                      Posicione a embalagem do produto em frente a esta câmera para registrá-lo. Ele aparecerá no seu celular automaticamente.
                    </div>
                  ) : (
                    <div className="device-products-scanned-container" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
                      {lastScannedItems.map(item => (
                        <div key={item.className} className="device-product-detected-card">
                          <div className="detected-item-details">
                            <span className="detected-item-emoji">{item.image}</span>
                            <div className="detected-item-text">
                              <div className="detected-name">{item.name}</div>
                              <div className="detected-price">R$ {item.price.toFixed(2).replace('.', ',')}</div>
                            </div>
                          </div>
                          <div className="detected-status-success">
                            ✓ Enviado ao Celular!
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Botão de Bypass para depuração no totem */}
                <button 
                  className="btn-disconnect-cart" 
                  onClick={handleDisconnect}
                  style={{ width: '100%', marginTop: '1.5rem', opacity: '0.6' }}
                >
                  Desconectar Celular (Simulação)
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL DE CONFIGURAÇÕES DE IA */}
      {isAiSettingsOpen && (
        <div className="modal-overlay" onClick={() => setIsAiSettingsOpen(false)}>
          <div className="modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>⚙️ Configurações da IA de Visão</h2>
              <button className="modal-close-btn" onClick={() => setIsAiSettingsOpen(false)}>×</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Motor de IA Ativo</label>
                <div className="ai-engine-tabs" style={{ display: 'flex', gap: '10px' }}>
                  <button 
                    className={`ai-engine-tab ${aiEngine === 'teachable' ? 'active' : ''}`}
                    onClick={() => {
                      setAiEngine('teachable');
                      localStorage.setItem('visioncart_ai_engine', 'teachable');
                      showToast("🤖 Motor de IA: Teachable Machine (Local)");
                    }}
                    style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '1px solid var(--border-color)', background: aiEngine === 'teachable' ? 'var(--accent)' : 'transparent', color: aiEngine === 'teachable' ? '#060913' : 'var(--text-primary)', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    Teachable Machine (Local)
                  </button>
                  <button 
                    className={`ai-engine-tab ${aiEngine === 'gemini' ? 'active' : ''}`}
                    onClick={() => {
                      setAiEngine('gemini');
                      localStorage.setItem('visioncart_ai_engine', 'gemini');
                      showToast("✨ Motor de IA: Gemini 1.5 Flash (Nuvem)");
                    }}
                    style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '1px solid var(--border-color)', background: aiEngine === 'gemini' ? 'var(--accent)' : 'transparent', color: aiEngine === 'gemini' ? '#060913' : 'var(--text-primary)', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    Gemini 1.5 Flash (Nuvem)
                  </button>
                </div>
              </div>

              {aiEngine === 'gemini' ? (
                <div className="gemini-settings-form slide-in">
                  <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                    <label htmlFor="gemini-key" style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Chave de API do Gemini (Google AI Studio)</label>
                    <input 
                      id="gemini-key"
                      type="password" 
                      className="form-input" 
                      placeholder="Insira sua API Key do Gemini"
                      value={geminiApiKey}
                      onChange={(e) => {
                        const val = e.target.value;
                        setGeminiApiKey(val);
                        localStorage.setItem('visioncart_gemini_api_key', val);
                      }}
                      style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.05)', color: 'white' }}
                    />
                    <small className="help-text" style={{ display: 'block', marginTop: '6px', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      Obtenha uma chave gratuita no <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Google AI Studio</a>. Salva localmente de forma segura.
                    </small>
                  </div>

                  <div className="form-group" style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Modo de Escaneamento</label>
                    <div className="ai-engine-tabs" style={{ display: 'flex', gap: '10px' }}>
                      <button 
                        className={`ai-engine-tab ${geminiScanMode === 'manual' ? 'active' : ''}`}
                        onClick={() => {
                          setGeminiScanMode('manual');
                          localStorage.setItem('visioncart_gemini_scan_mode', 'manual');
                          showToast("Modo: Escaneamento Manual (Botão ou Espaço)");
                        }}
                        style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '1px solid var(--border-color)', background: geminiScanMode === 'manual' ? 'var(--accent)' : 'transparent', color: geminiScanMode === 'manual' ? '#060913' : 'var(--text-primary)', fontWeight: 'bold', cursor: 'pointer' }}
                      >
                        Manual (Clique / Espaço)
                      </button>
                      <button 
                        className={`ai-engine-tab ${geminiScanMode === 'auto' ? 'active' : ''}`}
                        onClick={() => {
                          setGeminiScanMode('auto');
                          localStorage.setItem('visioncart_gemini_scan_mode', 'auto');
                          showToast("Modo: Autoscanner a cada 4s");
                        }}
                        style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '1px solid var(--border-color)', background: geminiScanMode === 'auto' ? 'var(--accent)' : 'transparent', color: geminiScanMode === 'auto' ? '#060913' : 'var(--text-primary)', fontWeight: 'bold', cursor: 'pointer' }}
                      >
                        Autoscanner (A cada 4s)
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="teachable-settings-info slide-in" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <p>O Teachable Machine roda localmente usando a sua webcam e o modelo treinado.</p>
                  <p><strong>Limitação:</strong> Identifica apenas um objeto por vez no enquadramento principal.</p>
                  <div className="form-group">
                    <label htmlFor="tm-url" style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: 'var(--text-primary)' }}>URL do Modelo Teachable Machine</label>
                    <input 
                      id="tm-url"
                      type="text" 
                      className="form-input" 
                      value={modelUrl}
                      onChange={(e) => setModelUrl(e.target.value)}
                      style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.05)', color: 'white' }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn-action-primary" onClick={() => setIsAiSettingsOpen(false)} style={{ padding: '10px 24px', borderRadius: '10px' }}>
                Salvar e Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
