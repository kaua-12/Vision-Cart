import { useState, useEffect, useRef } from 'react';
import * as tmImage from '@teachablemachine/image';
import db from './database.json';
import './App.css';

function App() {
  const [modelUrl, setModelUrl] = useState('https://teachablemachine.withgoogle.com/models/7ISYm8EbG/');
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cart, setCart] = useState([]);
  const [prediction, setPrediction] = useState(null);
  
  // Navigation & Checkout States
  const [activeTab, setActiveTab] = useState('scan'); // 'scan', 'cart', 'checkout', 'deals', 'profile'
  const [lastScannedItem, setLastScannedItem] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('credit_card'); // 'credit_card', 'pix', 'wallet'
  
  // Checkout Form States
  const [cardName, setCardName] = useState('Sarah J. Miller');
  const [cardNumber, setCardNumber] = useState('**** **** **** 4015');
  const [cardExpiry, setCardExpiry] = useState('11/26');
  const [cardCvv, setCardCvv] = useState('***');
  const [saveCardDetails, setSaveCardDetails] = useState(true);

  const videoRef = useRef(null);
  const modelRef = useRef(null);
  const requestRef = useRef(null);
  const cooldownRef = useRef(false);
  const isActiveRef = useRef(false);
  const accumulatorsRef = useRef({});
  const notificationTimeoutRef = useRef(null);
  const streamRef = useRef(null);
  const cameraSessionIdRef = useRef(0);

  useEffect(() => {
    if (modelUrl) {
      loadModel();
    }
  }, [modelUrl]);

  // Gerencia ativação/desativação automática da câmera ao mudar de aba
  useEffect(() => {
    if (activeTab === 'scan' && isModelLoaded) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [activeTab, isModelLoaded]);

  // Load the Teachable Machine model
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
      alert("Erro ao carregar o modelo. Verifique se o link está correto.");
    }
  };

  // Start the webcam
  const startCamera = async () => {
    if (isActiveRef.current) return;
    
    cameraSessionIdRef.current += 1;
    const thisSessionId = cameraSessionIdRef.current;
    
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        isActiveRef.current = true;
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        
        // Se a sessão mudou ou a câmera foi desativada durante a requisição, limpa e aborta
        if (cameraSessionIdRef.current !== thisSessionId || !isActiveRef.current) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        streamRef.current = stream;
        
        // Wait a brief tick to ensure the DOM has rendered the video element
        setTimeout(() => {
          if (cameraSessionIdRef.current !== thisSessionId || !isActiveRef.current) {
            stream.getTracks().forEach(track => track.stop());
            if (streamRef.current === stream) {
              streamRef.current = null;
            }
            return;
          }

          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            setIsCameraActive(true);
            videoRef.current.play().catch(e => console.error("Error playing video:", e));
            // Start predicting loop
            cancelAnimationFrame(requestRef.current);
            requestRef.current = requestAnimationFrame(loop);
          } else {
            // If component was unmounted during permission prompt
            stream.getTracks().forEach(track => track.stop());
            if (streamRef.current === stream) {
              streamRef.current = null;
            }
            isActiveRef.current = false;
            setIsCameraActive(false);
          }
        }, 100);
      } catch (err) {
        console.error("Erro ao acessar a câmera: ", err);
        if (cameraSessionIdRef.current === thisSessionId) {
          isActiveRef.current = false;
          setIsCameraActive(false);
        }
      }
    }
  };

  const stopCamera = () => {
    cameraSessionIdRef.current += 1; // Invalida qualquer requisição de câmera em andamento
    isActiveRef.current = false;
    setIsCameraActive(false);
    cancelAnimationFrame(requestRef.current);
    
    // Parar todos os tracks usando streamRef (independente de videoRef já ser nulo)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Garantir limpeza no elemento de vídeo se ele ainda estiver montado
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setPrediction(null);
  };

  const loop = async () => {
    try {
      if (!isActiveRef.current) return;
      
      if (videoRef.current && modelRef.current && videoRef.current.readyState >= 2) {
        await predict();
      }
    } catch (error) {
      console.error("Erro no loop:", error);
    }
    if (isActiveRef.current) {
      requestRef.current = requestAnimationFrame(loop);
    }
  };

  const predict = async () => {
    if (!modelRef.current || !videoRef.current) return;
    
    // Make prediction
    const predictions = await modelRef.current.predict(videoRef.current);
    
    // Find the highest probability prediction
    const bestPrediction = predictions.reduce((prev, current) => {
      return (prev.probability > current.probability) ? prev : current;
    });

    setPrediction(bestPrediction);

    // If confidence is high (> 75%) and not in cooldown
    if (bestPrediction.probability > 0.75 && !cooldownRef.current) {
      const className = bestPrediction.className.trim();
      
      if (className.toLowerCase() === 'fundo') {
        // Reduzir acumuladores se estivermos vendo apenas o fundo
        Object.keys(accumulatorsRef.current).forEach(key => {
          accumulatorsRef.current[key] = Math.max(0, accumulatorsRef.current[key] - 1);
        });
      } else {
        // Incrementa acumulador da classe detectada
        accumulatorsRef.current[className] = (accumulatorsRef.current[className] || 0) + 1;
        
        // Reduz acumuladores das outras classes para evitar falsos positivos
        Object.keys(accumulatorsRef.current).forEach(key => {
          if (key !== className) {
            accumulatorsRef.current[key] = Math.max(0, accumulatorsRef.current[key] - 1);
          }
        });

        // Requer 5 frames detectados para confirmar
        if (accumulatorsRef.current[className] >= 5) {
          const dbItem = db.find(item => item.className.toLowerCase() === className.toLowerCase());
          if (dbItem) {
            triggerProductScanned(dbItem);
          }
        }
      }
    } else {
      // Se a probabilidade cair muito ou estiver em cooldown, reduz lentamente
      if (bestPrediction.probability <= 0.5) {
        Object.keys(accumulatorsRef.current).forEach(key => {
          accumulatorsRef.current[key] = Math.max(0, accumulatorsRef.current[key] - 1);
        });
      }
    }
  };

  // Helper to handle product scan addition (from both Camera and Simulator)
  const triggerProductScanned = (item) => {
    addToCart(item);
    setLastScannedItem(item);
    
    // Set cooldown
    cooldownRef.current = true;
    accumulatorsRef.current = {}; // Limpa os acumuladores após registrar a compra
    
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }
    
    // Keep bottom sheet notification open for 4 seconds, or until next scan
    notificationTimeoutRef.current = setTimeout(() => {
      setLastScannedItem(null);
    }, 4000);

    setTimeout(() => {
      cooldownRef.current = false;
    }, 3000); // 3 seconds cooldown
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
    setLastScannedItem(null);
  };

  // Simulated scan button click
  const simulateScan = (className) => {
    const dbItem = db.find(item => item.className === className);
    if (dbItem) {
      triggerProductScanned(dbItem);
      // Automatically switch to Scan tab so the user can see the scan overlay card
      setActiveTab('scan');
    }
  };

  // Calculate totals
  const subtotal = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);
  const tax = subtotal * 0.06; // 6% simulated tax
  const total = subtotal + tax;
  const totalItemsCount = cart.reduce((acc, item) => acc + item.qty, 0);

  const handleCheckoutSubmit = (e) => {
    e.preventDefault();
    alert(`Pagamento de R$ ${total.toFixed(2).replace('.', ',')} realizado com sucesso!\nObrigado por comprar no VisionCart. Compra Sem Filas!`);
    clearCart();
    setActiveTab('scan');
  };

  return (
    <div className="app-layout">
      {/* SIMULATOR PANEL (Left Side, for development & easy testing) */}
      <div className="simulator-panel glass-panel">
        <h3>Simulador de Compras</h3>
        <p className="simulator-desc">
          Use esta área lateral para simular o escaneamento de produtos caso sua webcam não esteja ativa ou você não tenha os itens físicos por perto.
        </p>

        <div className="sim-control-box">
          <span className="sim-control-title">Simular Câmera</span>
          <div className="sim-btn-group">
            {!isCameraActive ? (
              <button className="btn-sim-option scan" onClick={startCamera}>Ligar Câmera</button>
            ) : (
              <button className="btn-sim-option clear" onClick={stopCamera}>Desligar Câmera</button>
            )}
          </div>
        </div>

        <div className="simulator-actions-grid">
          {db.map(item => (
            <div key={item.className} className="btn-simulator-item">
              <div className="simulator-item-left">
                <span>{item.image}</span>
                <div>
                  <div style={{fontWeight: 700}}>{item.name}</div>
                  <div style={{fontSize: '0.7rem', color: 'var(--text-secondary)'}}>R$ {item.price.toFixed(2)}</div>
                </div>
              </div>
              <button 
                className="btn-sim-action"
                onClick={() => simulateScan(item.className)}
              >
                Escanear
              </button>
            </div>
          ))}
        </div>

        <button 
          className="btn-cart-clear" 
          onClick={clearCart}
          style={{marginTop: '1rem', width: '100%', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: '10px'}}
        >
          Esvaziar Carrinho
        </button>
      </div>

      {/* SMARTPHONE FRAME CONTAINER */}
      <div className="phone-frame">
        <div className="phone-notch">
          <div className="phone-notch-camera"></div>
        </div>
        
        <div className="phone-screen">
          
          {/* Status Bar */}
          <div className="phone-status-bar">
            <span>10:09 AM</span>
            <div className="status-icons">
              <span>📶</span>
              <span>🛜</span>
              <div className="status-battery"></div>
            </div>
          </div>

          {/* Header */}
          <header className="phone-header">
            {activeTab !== 'scan' ? (
              <span className="phone-header-icon" onClick={() => setActiveTab('scan')}>‹</span>
            ) : (
              <span className="phone-header-icon">⚙️</span>
            )}
            <h1 className="phone-header-title">
              <span>🛒</span> VisionCart
            </h1>
            <span className="phone-header-icon" onClick={() => setActiveTab('cart')}>
              🛒{cart.length > 0 && <span style={{fontSize: '0.7rem', verticalAlign: 'super', background: 'var(--danger)', color: 'white', padding: '1px 5px', borderRadius: '50%'}}>{totalItemsCount}</span>}
            </span>
          </header>

          {/* Main Content Area */}
          <main className="phone-content">
            
            {/* 1. SCAN TAB */}
            {activeTab === 'scan' && (
              <div className="scan-tab">
                <div className="scan-title-section">
                  <h3>
                    <span className="pulse-dot"></span>
                    {isCameraActive ? "Câmera de Reconhecimento Ativa" : "Reconhecimento de Produtos"}
                  </h3>
                </div>

                <div className="camera-viewport">
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    muted 
                    className={`camera-feed ${isCameraActive ? "active" : ""}`}
                  />
                  
                  {isCameraActive && <div className="scanner-overlay"></div>}
                  
                  {!isCameraActive && (
                    <div className="camera-placeholder">
                      <span className="camera-placeholder-icon">📸</span>
                      <p style={{fontSize: '0.85rem'}}>Aponte os produtos cadastrados para a câmera para adicioná-los automaticamente.</p>
                      <button className="btn-pill-blue" style={{width: 'auto', padding: '0.5rem 1.25rem'}} onClick={startCamera}>
                        Ativar Câmera
                      </button>
                    </div>
                  )}

                  {/* Realtime detection badge */}
                  {isCameraActive && prediction && prediction.probability > 0.5 && db.some(item => item.className.toLowerCase() === prediction.className.toLowerCase().trim()) && (
                    <div className="prediction-overlay" style={{bottom: '10px', fontSize: '0.75rem', padding: '4px 10px'}}>
                      Buscando: {prediction.className} ({(prediction.probability * 100).toFixed(0)}%)
                    </div>
                  )}
                </div>

                {cooldownRef.current && !lastScannedItem && (
                  <div className="cooldown-badge">⏳ Aguarde o próximo produto...</div>
                )}

                {/* Bottom sheet detailing the scanned product */}
                {lastScannedItem && (
                  <div className="product-detected-card">
                    <div className="detected-item-header">
                      <span className="detected-item-emoji">{lastScannedItem.image}</span>
                      <div className="detected-item-info">
                        <div className="detected-item-name">{lastScannedItem.name}</div>
                        <div className="detected-item-meta">
                          <span>{lastScannedItem.weight}</span>
                          <span>•</span>
                          <span className="detected-item-price">R$ {lastScannedItem.price.toFixed(2).replace('.', ',')}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="detected-action-row">
                      <button className="btn-pill-gray" onClick={() => setLastScannedItem(null)}>Fechar</button>
                      <button className="btn-pill-blue" style={{background: 'var(--success)'}}>
                        ✓ Adicionado! (x{cart.find(i => i.className === lastScannedItem.className)?.qty || 1})
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 2. CART TAB */}
            {activeTab === 'cart' && (
              <div style={{display: 'flex', flexDirection: 'column', height: '100%', gap: '1rem'}}>
                <div className="cart-header-row">
                  <h3>Meu Carrinho ({totalItemsCount} itens)</h3>
                  <button className="btn-add-items" onClick={() => setActiveTab('scan')}>+ Escanear</button>
                </div>

                <div className="cart-items-list">
                  {cart.length === 0 ? (
                    <div style={{textAlign: 'center', color: 'var(--text-secondary)', padding: '3rem 1rem', fontSize: '0.85rem', lineHeight: '1.6'}}>
                      <span style={{fontSize: '2.5rem', display: 'block', marginBottom: '0.5rem'}}>🛒</span>
                      Seu carrinho está vazio.<br/>Aponte um produto para a câmera ou utilize o simulador lateral.
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
                      </div>
                    ))
                  )}
                </div>

                {cart.length > 0 && (
                  <div className="cart-summary-section">
                    <div className="summary-row">
                      <span>Subtotal</span>
                      <span>R$ {subtotal.toFixed(2).replace('.', ',')}</span>
                    </div>
                    <div className="summary-row">
                      <span>Imposto (6%)</span>
                      <span>R$ {tax.toFixed(2).replace('.', ',')}</span>
                    </div>
                    <div className="summary-row grand-total">
                      <span>Total Geral</span>
                      <span>R$ {total.toFixed(2).replace('.', ',')}</span>
                    </div>

                    <button 
                      className="btn-action-primary btn-checkout-teal"
                      onClick={() => setActiveTab('checkout')}
                    >
                      Ir para o Pagamento (R$ {total.toFixed(2).replace('.', ',')}) ›
                    </button>
                    <button className="btn-cart-clear" onClick={clearCart}>Esvaziar Carrinho</button>
                  </div>
                )}
              </div>
            )}

            {/* 3. CHECKOUT TAB */}
            {activeTab === 'checkout' && (
              <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                <div className="checkout-amount-box">
                  <div className="checkout-amount-title">Total a Pagar</div>
                  <div className="checkout-amount-val">R$ {total.toFixed(2).replace('.', ',')}</div>
                  <div className="checkout-amount-sub">
                    {totalItemsCount} produtos no carrinho (inclui imposto de R$ {tax.toFixed(2).replace('.', ',')})
                  </div>
                </div>

                <div className="checkout-section-title">Método de Pagamento</div>
                <div className="payment-methods-grid">
                  <div 
                    className={`payment-method-card ${paymentMethod === 'credit_card' ? 'active' : ''}`}
                    onClick={() => setPaymentMethod('credit_card')}
                  >
                    <span className="payment-method-icon">💳</span>
                    <span>Cartão</span>
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
                    <span>Apple Pay</span>
                  </div>
                </div>

                {paymentMethod === 'credit_card' && (
                  <form onSubmit={handleCheckoutSubmit} className="checkout-form">
                    <div className="checkout-section-title">Dados do Cartão</div>
                    
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
                      disabled={cart.length === 0}
                    >
                      🔒 Pagar R$ {total.toFixed(2).replace('.', ',')}
                    </button>
                  </form>
                )}

                {paymentMethod === 'pix' && (
                  <div style={{display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'center', padding: '1rem'}}>
                    <div style={{fontSize: '3rem'}}>📱</div>
                    <div style={{fontSize: '0.85rem', fontWeight: 600}}>Pix Copia e Cola Gerado</div>
                    <div style={{
                      background: 'rgba(255,255,255,0.03)', 
                      border: '1px solid var(--glass-border)', 
                      padding: '0.75rem', 
                      borderRadius: '10px',
                      fontSize: '0.7rem',
                      fontFamily: 'monospace',
                      wordBreak: 'break-all',
                      color: 'var(--text-secondary)'
                    }}>
                      00020101021226850014br.gov.bcb.pix2563pix-qr.mercadopago.com/emv/v2/53594821a8-77ea-4878-a5b0-01b57821b70f5204000053039865406{total.toFixed(2)}5802BR5909VisionCart6009SaoPaulo62070503***6304D1B2
                    </div>
                    <button 
                      className="btn-action-primary btn-secure-pay"
                      onClick={() => {
                        alert("Código Pix copiado! Simulando confirmação de pagamento...");
                        alert("Pagamento confirmado via Pix!");
                        clearCart();
                        setActiveTab('scan');
                      }}
                    >
                      Copiar Pix e Confirmar
                    </button>
                  </div>
                )}

                {paymentMethod === 'wallet' && (
                  <div style={{display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'center', padding: '1.5rem'}}>
                    <div style={{fontSize: '3rem'}}>🌐</div>
                    <div style={{fontSize: '0.85rem', fontWeight: 600}}>Pagar com Apple Pay ou Google Pay</div>
                    <button 
                      className="btn-action-primary btn-secure-pay"
                      style={{background: 'white', color: 'black'}}
                      onClick={() => {
                        alert("Simulando Apple Pay / Google Pay Auth...");
                        alert("Pagamento confirmado com sucesso!");
                        clearCart();
                        setActiveTab('scan');
                      }}
                    >
                      Pagar com Carteira Digital
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 4. DEALS TAB */}
            {activeTab === 'deals' && (
              <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                <div className="deals-banner">
                  <h4>Ofertas da Semana! 🏷️</h4>
                  <p>Aproveite os descontos especiais para os produtos no seu carrinho.</p>
                </div>

                <div className="deal-card">
                  <span className="deal-emoji">🥤</span>
                  <div className="deal-info">
                    <div className="deal-title">Leve 3 Coca-Colas por R$ 14,00</div>
                    <div className="deal-desc">Economize R$ 2,50 na compra combinada.</div>
                  </div>
                  <span className="deal-badge">-15%</span>
                </div>

                <div className="deal-card">
                  <span className="deal-emoji">☕</span>
                  <div className="deal-info">
                    <div className="deal-title">Café Melitta em Oferta</div>
                    <div className="deal-desc">Leve o Café Melitta tradicional com 10% de desconto direto.</div>
                  </div>
                  <span className="deal-badge">-10%</span>
                </div>

                <div className="deal-card">
                  <span className="deal-emoji">🥑</span>
                  <div className="deal-info">
                    <div className="deal-title">Abacate Orgânico Promocional</div>
                    <div className="deal-desc">Adicione saúde ao seu carrinho por apenas R$ 5,90.</div>
                  </div>
                  <span className="deal-badge">R$ 5,90</span>
                </div>

                <div className="deal-card">
                  <span className="deal-emoji">🍓</span>
                  <div className="deal-info">
                    <div className="deal-title">Morangos Doces e Frescos</div>
                    <div className="deal-desc">Compre 2 bandejas de morango e ganhe 20% de desconto no segundo.</div>
                  </div>
                  <span className="deal-badge">-20%</span>
                </div>
              </div>
            )}

            {/* 5. PROFILE TAB */}
            {activeTab === 'profile' && (
              <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                <div className="profile-card">
                  <div className="profile-avatar">👤</div>
                  <div className="profile-name">Arthur S Portaluppi</div>
                  <div className="profile-email">arthur.portaluppi@exemplo.com</div>
                </div>

                <div className="glass-panel" style={{padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem'}}>
                  <div style={{fontWeight: 700, borderBottom: '1px solid var(--glass-border)', paddingBottom: '6px'}}>Minha Conta</div>
                  <div style={{display: 'flex', justifyContent: 'space-between'}}>
                    <span>Histórico de Compras</span>
                    <span>›</span>
                  </div>
                  <div style={{display: 'flex', justifyContent: 'space-between'}}>
                    <span>Métodos de Pagamento Salvos</span>
                    <span>›</span>
                  </div>
                  <div style={{display: 'flex', justifyContent: 'space-between'}}>
                    <span>Configurações do App</span>
                    <span>›</span>
                  </div>
                </div>

                <div className="glass-panel" style={{padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4'}}>
                  <div style={{fontWeight: 700, color: 'var(--text-primary)'}}>Sobre o VisionCart MVP</div>
                  <p>Este protótipo demonstra o reconhecimento de produtos por inteligência artificial em tempo real (Teachable Machine) integrado a um carrinho auto-serviço.</p>
                  <p style={{fontSize: '0.7rem'}}>Desenvolvido com React + Vite + TensorFlow.js</p>
                </div>
              </div>
            )}

          </main>

          {/* Bottom Navigation Navbar */}
          <nav className="phone-navbar">
            <button 
              className={`nav-item ${activeTab === 'scan' ? 'active' : ''}`}
              onClick={() => setActiveTab('scan')}
            >
              <span className="nav-icon">📸</span>
              <span>Scanner</span>
            </button>
            <button 
              className={`nav-item ${activeTab === 'cart' ? 'active' : ''}`}
              onClick={() => setActiveTab('cart')}
            >
              <span className="nav-icon">
                🛒
                {cart.length > 0 && <span style={{fontSize: '0.6rem', verticalAlign: 'super', background: 'var(--danger)', color: 'white', padding: '1px 4px', borderRadius: '50%'}}>{totalItemsCount}</span>}
              </span>
              <span>Carrinho</span>
            </button>
            <button 
              className={`nav-item ${activeTab === 'deals' ? 'active' : ''}`}
              onClick={() => setActiveTab('deals')}
            >
              <span className="nav-icon">🏷️</span>
              <span>Ofertas</span>
            </button>
            <button 
              className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`}
              onClick={() => setActiveTab('profile')}
            >
              <span className="nav-icon">👤</span>
              <span>Perfil</span>
            </button>
          </nav>

          {/* Home Indicator */}
          <div className="phone-home-indicator"></div>

        </div>
      </div>
    </div>
  );
}

export default App;
