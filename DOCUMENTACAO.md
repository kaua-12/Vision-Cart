# VisionCart - Sistema de Checkout Autônomo com Visão Computacional
Este documento contém a especificação técnica e funcional detalhada do projeto **VisionCart**, desenvolvida com foco em facilidade de importação para o Google Docs.

---

## 1. Visão Geral do Projeto
O **VisionCart** é um protótipo funcional de carrinho de compras inteligente projetado para eliminar as filas tradicionais de supermercados. Através de um sistema integrado em tempo real, o projeto une visão computacional baseada em Inteligência Artificial no monitor do carrinho e gerenciamento do carrinho com pagamento integrado no dispositivo móvel do usuário.

### 1.1. O Problema
O processo tradicional de checkout em supermercados gera atrito, perda de tempo em filas e custos operacionais elevados com atendentes físicos.

### 1.2. A Solução
O VisionCart descentraliza a leitura de código de barras e o pagamento. Um totem/tablet instalado fisicamente no próprio carrinho de compras atua como um scanner inteligente guiado por câmera e IA (reconhecendo produtos visualmente). Esse monitor transmite instantaneamente os itens detectados via conexões bidirecionais (WebSockets) para o aplicativo web executado no celular pessoal do cliente. O cliente realiza o gerenciamento das quantidades e o pagamento (via Pix, cartão de crédito ou carteiras digitais) diretamente na tela de seu smartphone, saindo da loja sem enfrentar filas de caixa.

---

## 2. Arquitetura do Sistema
O sistema utiliza uma arquitetura unificada de página única (SPA) com React para simplificar o deploy e garantir sincronismo instantâneo de estados.

```
+-------------------------------------------------------------+
|                       SERVIDOR NODE.JS                      |
|           Serviço Estático & WebSocket Hub (ws)             |
+------------------------------+------------------------------+
                               |
            Sincronização Bidirecional em Tempo Real
                               |
       +-----------------------+-----------------------+
       |                                               |
+------v----------------------+                 +------v----------------------+
|     VISIONCART MONITOR      |                 |      VISIONCART APP         |
|  (Totem do Carrinho - Rota  |                 | (Celular do Cliente - Rota  |
|       Principal `/`)        |                 |      `/app` ou `/mobile`)   |
|                             |                 |                             |
|  - Câmera do Totem          |                 |  - Scanner de QR Code       |
|  - Reconhecimento de        |                 |  - Visualização de Itens    |
|    Imagem Local (TensorFlow)|                 |  - Ajuste de Quantidade     |
|  - Vision AI Multimodal     |                 |  - Checkout & Pagamento     |
|    (API Gemini Cloud)       |                 |    (Simulado Pix/Cartão)    |
|  - Exibição de QR Code      |                 |  - Gestão de Perfil         |
+-----------------------------+                 +-----------------------------+
```

### 2.1. Frontend (React + Vite)
O aplicativo web é responsivo e divide-se em dois modos principais baseados em rotas:
1. **Visualização do Monitor/Totem (Rota `/`):** Exibe a câmera de monitoramento do carrinho inteligente, os seletores de motor de inteligência artificial, as configurações de credenciais de nuvem e o QR Code dinâmico para pareamento inicial.
2. **Visualização do Aplicativo do Cliente (Rotas `/app` ou `/mobile`):** Funciona como uma interface mobile nativa com navegação em abas (Início, Carrinho, Pagamento e Perfil), leitor de QR Code para pareamento físico e interface de finalização de compra.

### 2.2. Backend (Node.js + Express + WS)
O servidor backend atua em duas frentes:
1. **Distribuição de Arquivos:** Serve o build estático otimizado gerado pelo Vite.
2. **WebSocket Server:** Estabelece conexões persistentes entre o totem e o celular do cliente. Ele mantém um banco de dados em memória (`Map`) que vincula o ID do carrinho (`cartId`) a um par de conexões: `{ cartSocket, phoneSocket }`. Qualquer evento gerado por um lado (como a detecção de um produto pelo totem) é imediatamente encaminhado para o seu correspondente móvel.

---

## 3. Fluxo de Pareamento e Funcionamento
O fluxo operacional garante uma experiência fluida para o cliente:

```
[Cliente inicia] --> [Escaneia QR Code do Totem] --> [WebSocket conecta Celular e Totem]
                         |
                         v
[Coloca produto no Totem] --> [IA detecta o produto] --> [Envia via WS para o Celular]
                         |
                         v
[Finaliza no Celular] --> [Realiza Pagamento] --> [Totem despareia para o próximo uso]
```

1. **Geração do QR Code:** Ao iniciar, o totem exibe um QR Code que encapsula o seu respectivo identificador exclusivo (ex: `cart-042`) e a URL de conexão do aplicativo móvel (ex: `https://meusite.com/app?cartId=cart-042`).
2. **Escaneamento de Sincronismo:** O cliente aponta a câmera do smartphone na tela do totem. O leitor integrado de QR Code do aplicativo móvel (`jsQR` carregado dinamicamente) extrai o ID do carrinho.
3. **Mapeamento de Sockets:** O celular conecta-se no WebSocket do servidor e registra-se como `register_phone` para aquele `cartId`. O totem, que já estava registrado como `register_cart`, recebe um evento informando que o cliente conectou. O pareamento está estabelecido.
4. **Reconhecimento Visual de Produtos:** O cliente deposita um item no carrinho físico. A câmera acoplada no totem captura o frame, analisa-o com Inteligência Artificial e identifica o produto.
5. **Transmissão em Tempo Real:** O totem envia a mensagem `product_scanned` com o payload do item detectado (nome, preço, peso e emoji) para o servidor, que o repassa ao celular correspondente. O celular emite um toast e atualiza o estado de contagem e cálculo financeiro do carrinho virtual.
6. **Pagamento Autônomo:** Na aba de checkout, o cliente seleciona a forma de pagamento (Cartão, Pix ou Carteiras Digitais) e confirma a operação.
7. **Limpeza e Desconexão:** Após a aprovação do pagamento, o aplicativo envia um pedido de encerramento (`disconnect_request`). O servidor limpa as referências de conexão daquele `cartId`, remove o estado do carrinho no celular e redefine o totem, que volta a exibir o QR Code inicial de pareamento.

---

## 4. Motores de Inteligência Artificial
O VisionCart oferece flexibilidade técnica ao disponibilizar dois motores de IA para o processamento de imagem em tempo real:

### 4.1. Teachable Machine (Classificação Local)
* **Tecnologia:** Baseado no framework TensorFlow.js e no serviço Teachable Machine da Google.
* **Processamento:** 100% no cliente (client-side), sem dependência de rede externa para envio de imagens.
* **Mecanismo de Confiança:** Utiliza um acumulador de probabilidade. Um produto precisa aparecer por pelo menos 3 frames consecutivos com probabilidade superior a 20% para ser registrado no celular. Um cooldown de 3 segundos impede duplicidade acidental imediata de leitura. Se o "Fundo" (carrinho vazio ou fundo) for o elemento mais provável (> 65%), os acumuladores dos produtos são resetados.

### 4.2. Gemini 1.5 Flash (Classificação e Multimodalidade na Nuvem)
* **Tecnologia:** Integração direta com a API da Google Generative AI (Modelos Multimodais).
* **Configurações de Execução:** Oferece dois modos configuráveis:
  * **Manual (Básico):** O usuário aciona um botão físico ou pressiona a barra de espaço para capturar o frame da câmera e disparar a análise do Gemini.
  * **Automático (Autônomo):** O sistema captura o frame e chama a API a cada 4 segundos automaticamente.
* **Engenharia de Prompt e Resposta:** O sistema tira um instantâneo da webcam em formato JPEG base64 e envia junto a um prompt estrito de sistema. A chamada configura o parâmetro `responseMimeType: 'application/json'` da API (especificação REST v1beta) para obrigar o Gemini a retornar estritamente um array JSON contendo as chaves de classe dos itens identificados na imagem.

---

## 5. Especificações Técnicas de Banco de Dados
Os dados dos produtos são estruturados no arquivo `src/database.json`. Cada produto cadastrado possui a seguinte assinatura JSON:

```json
{
  "className": "Pringles",
  "name": "Batata Pringles Original",
  "price": 14.50,
  "image": "🥔",
  "weight": "114g",
  "desc": "Batata frita crocante original"
}
```

* **`className`:** Identificador usado pelos classificadores de imagem do Teachable Machine e Gemini.
* **`name`:** Nome comercial exibido ao cliente no aplicativo celular.
* **`price`:** Preço unitário numérico para cálculo de subtotal.
* **`image`:** Emoji representativo do produto para design responsivo minimalista.
* **`weight`:** Peso líquido do item para exibição de detalhes.
* **`desc`:** Breve detalhamento do produto.

---

## 6. Procedimentos de Instalação e Execução

### 6.1. Requisitos Prévios
* **Node.js** instalado (versão 18 ou superior).
* **NPM** instalado.

### 6.2. Preparação do Ambiente
1. Extraia o código-fonte do projeto.
2. Instale as dependências executando o comando no terminal do diretório raiz do projeto:
   ```bash
   npm install
   ```
3. Crie um arquivo `.env.local` na raiz do projeto (para desenvolvimento) ou configure variáveis de ambiente no servidor de deploy (produção):
   ```env
   VITE_GEMINI_API_KEY=sua_chave_api_do_google_gemini_aqui
   ```

### 6.3. Execução em Ambiente de Desenvolvimento
Roda o servidor Vite local com suporte a recarregamento dinâmico (HMR) na porta padrão `5173`:
```bash
npm run dev
```

### 6.4. Execução em Ambiente de Produção
Para compilar e subir o servidor otimizado que serve os arquivos estáticos e controla a porta WebSocket na mesma rota HTTP:
1. Compile os arquivos estáticos:
   ```bash
   npm run build
   ```
2. Inicialize o servidor backend:
   ```bash
   npm start
   ```
   *O servidor iniciará na porta padrão `5173` ou na porta designada pela variável de ambiente `PORT`.*

---

## 7. Práticas Recomendadas para Importação no Google Docs
Para que este documento de especificação técnica fique visualmente perfeito ao ser colado no **Google Docs**, siga uma destas duas alternativas:

1. **Importação Direta por Extensão:** Use uma extensão do Google Docs como *Markdown to Docs* para converter este arquivo `.md` diretamente em formatação rich text.
2. **Cópia via Conversor Web:** Cole o conteúdo deste markdown em um conversor visual de Markdown para HTML (como o *Dillinger.io* ou abrindo a versão HTML gerada pelo sistema no navegador), copie a visualização formatada diretamente no navegador e cole no Google Docs. O Google Docs herdará toda a formatação de tabelas, cabeçalhos (`H1`, `H2`, `H3`), listas e blocos de código com fontes monoespaçadas.
