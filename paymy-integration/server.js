const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.static('public')); // Для статических файлов HTML

const LOGIN = "Paycom";
const PASSWORD = process.env.PAYME_SECRET_KEY || "95n%ceFHPhU8G3UdiO3dt1g3EbpV8KFS66y9"; 
const MERCHANT_ID = process.env.PAYME_MERCHANT_ID || "***ВСТАВЬТЕ_ВАШ_MERCHANT_ID***";
const EXPECTED_AUTH = "Basic " + Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');

// Хранилище транзакций (в продакшене - база данных)
const transactions = new Map();

// Хранилище заказов для Mini App
const orders = new Map();

// Тестовые заказы для проверки
const testOrders = new Map([
  ['TEST_ORDER_001', { order_id: 'TEST_ORDER_001', amount: 50000, status: 'pending' }],
  ['TEST_ORDER_002', { order_id: 'TEST_ORDER_002', amount: 100000, status: 'pending' }],
  ['12345', { order_id: '12345', amount: 1000, status: 'pending' }]
]);

// ============== НОВЫЕ ЭНДПОИНТЫ ДЛЯ MINI APP ==============

// 1. Создание счёта для фронтенда
app.post('/api/pay/create', (req, res) => {
    try {
        const { amount = 50000, description = 'Premium доступ' } = req.body;
        
        // Генерируем уникальный ID заказа
        const orderId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        
        // Добавляем заказ в testOrders чтобы он был доступен для Payme API
        testOrders.set(orderId, { 
            order_id: orderId, 
            amount: amount, 
            status: 'pending' 
        });
        
        // Сохраняем заказ для фронтенда
        orders.set(orderId, {
            id: orderId,
            amount: amount,
            description: description,
            status: 'pending',
            created_at: new Date()
        });

        // Формируем URL для оплаты
        const payUrl = `https://checkout.paycom.uz/${Buffer.from(`m=${MERCHANT_ID};ac.order_id=${orderId};a=${amount};c=${encodeURIComponent(description)}`).toString('base64')}`;

        console.log(`✅ Создан заказ ${orderId} на сумму ${amount} тийинов`);

        res.json({
            success: true,
            order_id: orderId,
            pay_url: payUrl,
            amount: amount,
            description: description
        });

    } catch (error) {
        console.error('Ошибка создания счёта:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Внутренняя ошибка сервера' 
        });
    }
});

// 2. Проверка статуса платежа для фронтенда
app.get('/api/pay/status/:orderId', (req, res) => {
    try {
        const orderId = req.params.orderId;
        const order = orders.get(orderId);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Заказ не найден'
            });
        }

        // Проверяем есть ли успешная транзакция для этого заказа
        const successfulTransaction = Array.from(transactions.values())
            .find(tx => tx.account?.order_id === orderId && tx.state === 2);

        // Проверяем есть ли отмененная транзакция
        const cancelledTransaction = Array.from(transactions.values())
            .find(tx => tx.account?.order_id === orderId && (tx.state === -1 || tx.state === -2));

        // Обновляем статус заказа на основе транзакций
        if (successfulTransaction) {
            order.status = 'completed';
            order.completed_at = new Date(successfulTransaction.perform_time);
        } else if (cancelledTransaction) {
            order.status = 'cancelled';
            order.cancelled_at = new Date(cancelledTransaction.cancel_time);
        }
        
        res.json({
            success: true,
            order: {
                id: order.id,
                status: order.status,
                amount: order.amount,
                description: order.description,
                created_at: order.created_at,
                completed_at: order.completed_at || null,
                cancelled_at: order.cancelled_at || null
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения статуса:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера'
        });
    }
});

// 3. Страница успешной оплаты
app.get('/payment-success', (req, res) => {
    const orderId = req.query.order_id;
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Оплата завершена</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                .success { color: green; font-size: 24px; margin-bottom: 20px; }
                .order-id { color: #666; margin-bottom: 30px; }
                .btn { background: #0088cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; }
            </style>
        </head>
        <body>
            <div class="success">✅ Оплата успешно завершена!</div>
            <div class="order-id">Номер заказа: ${orderId}</div>
            <a href="#" onclick="window.close()" class="btn">Вернуться в приложение</a>
            
            <script>
                setTimeout(() => window.close(), 3000);
                if (window.opener) {
                    window.opener.postMessage({
                        type: 'PAYMENT_SUCCESS',
                        orderId: '${orderId}'
                    }, '*');
                }
            </script>
        </body>
        </html>
    `);
});

// ============== СУЩЕСТВУЮЩИЙ PAYME API ==============

// Middleware для авторизации (только для /paycom)
app.use('/paycom', (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== EXPECTED_AUTH) {
    return res.status(200).json({
      jsonrpc: "2.0",
      id: req.body?.id || null,
      error: {
        code: -32504,
        message: "Insufficient privileges"
      }
    });
  }
  next();
});

app.post('/paycom', (req, res) => {
  const { method, id, params } = req.body;
  console.log("📩 Запрос:", method, params);

  switch (method) {
    case 'CheckPerformTransaction':
      const orderId = params.account?.order_id;
      const amount = params.amount;
      
      if (!orderId) {
        return res.json({
          jsonrpc: "2.0",
          error: { code: -31050, message: "Order ID not provided" },
          id
        });
      }

      const order = testOrders.get(orderId);
      if (!order) {
        console.log(`❌ Заказ ${orderId} не найден`);
        return res.json({
          jsonrpc: "2.0",
          error: { code: -31050, message: "Order not found" },
          id
        });
      }

      if (order.amount !== amount) {
        console.log(`❌ Неверная сумма для заказа ${orderId}. Ожидается: ${order.amount}, получено: ${amount}`);
        return res.json({
          jsonrpc: "2.0",
          error: { code: -31001, message: "Incorrect amount" },
          id
        });
      }

      // Проверяем, нет ли уже активной транзакции для этого заказа
      const existingActiveTransaction = Array.from(transactions.values())
        .find(tx => tx.account.order_id === orderId && (tx.state === 1 || tx.state === 2));

      if (existingActiveTransaction) {
        console.log(`❌ Заказ ${orderId} уже имеет активную транзакцию ${existingActiveTransaction.id}`);
        return res.json({
          jsonrpc: "2.0",
          error: { code: -31099, message: "Order already has active transaction" },
          id
        });
      }

      console.log(`✅ Заказ ${orderId} найден, сумма корректна, активных транзакций нет`);
      res.json({ jsonrpc: "2.0", result: { allow: true }, id });
      break;

    case 'CreateTransaction':
      const transactionId = params.id;
      const createOrderId = params.account?.order_id;
      const createAmount = params.amount;
      const createTime = params.time;
      
      // Проверяем заказ
      const createOrder = testOrders.get(createOrderId);
      if (!createOrder) {
        return res.json({
          jsonrpc: "2.0",
          error: { code: -31050, message: "Order not found" },
          id
        });
      }

      // ИДЕМПОТЕНТНОСТЬ: Если транзакция уже существует - возвращаем тот же результат
      if (transactions.has(transactionId)) {
        const existingTx = transactions.get(transactionId);
        console.log(`🔄 Повторный вызов CreateTransaction для ${transactionId}`);
        return res.json({
          jsonrpc: "2.0",
          result: {
            create_time: existingTx.create_time,
            transaction: existingTx.id,
            state: existingTx.state
          },
          id
        });
      }

      // ЗАЩИТА ОТ ДВОЙНОЙ ОПЛАТЫ: Проверяем, нет ли уже другой активной транзакции для этого заказа
      const existingTransaction = Array.from(transactions.values())
        .find(tx => tx.account.order_id === createOrderId && (tx.state === 1 || tx.state === 2));

      if (existingTransaction) {
        console.log(`❌ Заказ ${createOrderId} уже имеет активную транзакцию ${existingTransaction.id}. Блокируем создание новой транзакции ${transactionId}`);
        return res.json({
          jsonrpc: "2.0",
          error: { 
            code: -31099, 
            message: "Order already has active transaction. Cannot create multiple transactions for single-payment order." 
          },
          id
        });
      }

      // Создаем новую транзакцию
      const newTransaction = {
        id: transactionId,
        amount: createAmount,
        account: params.account,
        state: 1,
        create_time: createTime,
        perform_time: null,
        cancel_time: null,
        reason: null
      };

      transactions.set(transactionId, newTransaction);
      
      // Обновляем статус заказа для фронтенда
      if (orders.has(createOrderId)) {
        const order = orders.get(createOrderId);
        order.status = 'processing';
        orders.set(createOrderId, order);
      }
      
      console.log(`✅ Транзакция ${transactionId} создана для заказа ${createOrderId}`);
      
      res.json({
        jsonrpc: "2.0",
        result: {
          create_time: newTransaction.create_time,
          transaction: newTransaction.id,
          state: 1
        },
        id
      });
      break;

    case 'PerformTransaction':
      const performTxId = params.id;
      
      if (!transactions.has(performTxId)) {
        console.log(`❌ Транзакция ${performTxId} не найдена`);
        return res.json({
          jsonrpc: "2.0",
          error: { code: -31050, message: "Transaction not found" },
          id
        });
      }

      const tx = transactions.get(performTxId);
      
      // ИДЕМПОТЕНТНОСТЬ: Если уже выполнена - возвращаем тот же результат
      if (tx.state === 2) {
        console.log(`🔄 Повторный вызов PerformTransaction для ${performTxId}`);
        return res.json({
          jsonrpc: "2.0",
          result: {
            perform_time: tx.perform_time,
            transaction: tx.id,
            state: 2
          },
          id
        });
      }

      // Выполняем транзакцию
      tx.state = 2;
      tx.perform_time = Date.now();
      
      // Обновляем статус заказа для фронтенда
      const performOrderId = tx.account?.order_id;
      if (orders.has(performOrderId)) {
        const order = orders.get(performOrderId);
        order.status = 'completed';
        order.completed_at = new Date(tx.perform_time);
        orders.set(performOrderId, order);
      }
      
      console.log(`✅ Транзакция ${performTxId} выполнена`);
      res.json({
        jsonrpc: "2.0",
        result: {
          perform_time: tx.perform_time,
          transaction: tx.id,
          state: 2
        },
        id
      });
      break;

    case 'CancelTransaction':
      const cancelTxId = params.id;
      const reason = params.reason;
      
      if (!transactions.has(cancelTxId)) {
        console.log(`❌ Транзакция ${cancelTxId} не найдена`);
        return res.json({
          jsonrpc: "2.0",
          error: { code: -31050, message: "Transaction not found" },
          id
        });
      }

      const cancelTx = transactions.get(cancelTxId);
      
      // ИДЕМПОТЕНТНОСТЬ: Если уже отменена - возвращаем тот же результат
      if (cancelTx.state === -1 || cancelTx.state === -2) {
        console.log(`🔄 Повторный вызов CancelTransaction для ${cancelTxId}`);
        return res.json({
          jsonrpc: "2.0",
          result: {
            cancel_time: cancelTx.cancel_time,
            transaction: cancelTx.id,
            state: cancelTx.state
          },
          id
        });
      }

      // Отменяем транзакцию
      cancelTx.state = reason === 1 ? -1 : -2;
      cancelTx.cancel_time = Date.now();
      cancelTx.reason = reason;
      
      // Обновляем статус заказа для фронтенда
      const cancelOrderId = cancelTx.account?.order_id;
      if (orders.has(cancelOrderId)) {
        const order = orders.get(cancelOrderId);
        order.status = 'cancelled';
        order.cancelled_at = new Date(cancelTx.cancel_time);
        orders.set(cancelOrderId, order);
      }
      
      console.log(`✅ Транзакция ${cancelTxId} отменена с причиной ${reason}`);
      res.json({
        jsonrpc: "2.0",
        result: {
          cancel_time: cancelTx.cancel_time,
          transaction: cancelTx.id,
          state: cancelTx.state
        },
        id
      });
      break;

    case 'CheckTransaction':
      const checkTxId = params.id;
      
      if (!transactions.has(checkTxId)) {
        console.log(`❌ Транзакция ${checkTxId} не найдена`);
        return res.json({
          jsonrpc: "2.0",
          error: { code: -31050, message: "Transaction not found" },
          id
        });
      }

      const checkTx = transactions.get(checkTxId);
      console.log(`✅ Информация о транзакции ${checkTxId}, reason: ${checkTx.reason}`);
      
      res.json({
        jsonrpc: "2.0",
        result: {
          create_time: checkTx.create_time,
          perform_time: checkTx.perform_time || 0,
          cancel_time: checkTx.cancel_time || 0,
          transaction: checkTx.id,
          state: checkTx.state,
          reason: checkTx.reason
        },
        id
      });
      break;

    case 'GetStatement':
      const from = params.from || 0;
      const to = params.to || Date.now();
      const transactionsList = Array.from(transactions.values())
        .filter(tx => tx.create_time >= from && tx.create_time <= to)
        .map(tx => ({
          id: tx.id,
          time: tx.create_time,
          amount: tx.amount,
          account: tx.account,
          create_time: tx.create_time,
          perform_time: tx.perform_time || 0,
          cancel_time: tx.cancel_time || 0,
          transaction: tx.id,
          state: tx.state,
          reason: tx.reason
        }));
      
      console.log(`✅ Выгрузка транзакций с ${from} по ${to}, найдено: ${transactionsList.length}`);
      res.json({
        jsonrpc: "2.0",
        result: {
          transactions: transactionsList
        },
        id
      });
      break;

    default:
      console.log(`❌ Неизвестный метод: ${method}`);
      res.json({
        jsonrpc: "2.0",
        error: { code: -32601, message: "Method not found" },
        id
      });
  }
});

// ============== СУЩЕСТВУЮЩИЕ ЭНДПОИНТЫ ==============

// Добавляем endpoint для просмотра тестовых заказов
app.get('/test-orders', (req, res) => {
  res.json({
    orders: Array.from(testOrders.values()),
    info: "Эти заказы доступны для тестирования Paycom API"
  });
});

// Endpoint для просмотра транзакций (для отладки)
app.get('/transactions', (req, res) => {
  res.json({
    transactions: Array.from(transactions.values()),
    count: transactions.size
  });
});

// Новый endpoint для просмотра заказов Mini App
app.get('/orders', (req, res) => {
  res.json({
    orders: Array.from(orders.values()),
    count: orders.size,
    info: "Заказы созданные через Mini App"
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`💳 Payme Merchant ID: ${MERCHANT_ID}`);
  console.log(`🔐 Secret Key установлен: ${PASSWORD ? 'Да' : 'Нет'}`);
  console.log(`\n📋 Доступные эндпоинты:`);
  console.log(`  🆕 POST /api/pay/create - Создание счёта для Mini App`);
  console.log(`  🆕 GET /api/pay/status/:orderId - Статус заказа для Mini App`);
  console.log(`  🆕 GET /payment-success - Страница успешной оплаты`);
  console.log(`  🆕 GET /orders - Просмотр заказов Mini App`);
  console.log(`  📡 POST /paycom - Callback от Payme`);
  console.log(`  🔧 GET /test-orders - Просмотр тестовых заказов`);
  console.log(`  🔧 GET /transactions - Просмотр транзакций`);
  console.log(`\n📋 Доступные тестовые заказы:`);
  testOrders.forEach(order => {
    console.log(`   - ${order.order_id}: ${order.amount} тийинов`);
  });
  console.log(`💡 Логика оплаты: ОДНОРАЗОВАЯ (защита от двойной оплаты)`);
  console.log(`🔒 Защита: -31099 при попытке создать вторую транзакцию для заказа`);
  console.log(`📝 Сохранение reason при отмене транзакций`);
  console.log(`🎯 Mini App интеграция: ГОТОВА`);
});
