const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const LOGIN = "Paycom";
const PASSWORD = "95n%ceFHPhU8G3UdiO3dt1g3EbpV8KFS66y9"; 
const EXPECTED_AUTH = "Basic " + Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');

const transactions = new Map();

// Тестовые заказы для проверки
const testOrders = new Map([
  ['TEST_ORDER_001', { order_id: 'TEST_ORDER_001', amount: 50000, status: 'pending' }],
  ['TEST_ORDER_002', { order_id: 'TEST_ORDER_002', amount: 100000, status: 'pending' }],
  ['12345', { order_id: '12345', amount: 1000, status: 'pending' }] // для старых тестов
]);

// Middleware для авторизации
app.use((req, res, next) => {
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

      console.log(`✅ Заказ ${orderId} найден, сумма корректна`);
      res.json({ jsonrpc: "2.0", result: { allow: true }, id });
      break;

    case 'CreateTransaction':
      const transactionId = params.id || Date.now().toString();
      
      // Дополнительная проверка при создании транзакции
      const createOrderId = params.account?.order_id;
      const createOrder = testOrders.get(createOrderId);
      
      if (!createOrder) {
        return res.json({
          jsonrpc: "2.0",
          error: { code: -31050, message: "Order not found" },
          id
        });
      }

      transactions.set(transactionId, {
        id: transactionId,
        amount: params.amount,
        account: params.account,
        state: 1,
        create_time: Date.now(),
      });
      
      console.log(`✅ Транзакция ${transactionId} создана для заказа ${createOrderId}`);
      res.json({
        jsonrpc: "2.0",
        result: {
          create_time: Date.now(),
          transaction: transactionId,
          state: 1
        },
        id
      });
      break;

    case 'PerformTransaction':
      if (transactions.has(params.id)) {
        const tx = transactions.get(params.id);
        tx.state = 2;
        tx.perform_time = Date.now();
        console.log(`✅ Транзакция ${params.id} выполнена`);
        res.json({
          jsonrpc: "2.0",
          result: {
            perform_time: tx.perform_time,
            transaction: tx.id,
            state: 2
          },
          id
        });
      } else {
        console.log(`❌ Транзакция ${params.id} не найдена`);
        res.json({
          jsonrpc: "2.0",
          error: { code: -31050, message: "Transaction not found" },
          id
        });
      }
      break;

    case 'CancelTransaction':
      if (transactions.has(params.id)) {
        const tx = transactions.get(params.id);
        tx.state = -1;
        tx.cancel_time = Date.now();
        console.log(`✅ Транзакция ${params.id} отменена`);
        res.json({
          jsonrpc: "2.0",
          result: {
            cancel_time: tx.cancel_time,
            transaction: tx.id,
            state: -1
          },
          id
        });
      } else {
        console.log(`❌ Транзакция ${params.id} не найдена`);
        res.json({
          jsonrpc: "2.0",
          error: { code: -31050, message: "Transaction not found" },
          id
        });
      }
      break;

    case 'CheckTransaction':
      if (transactions.has(params.id)) {
        const tx = transactions.get(params.id);
        console.log(`✅ Информация о транзакции ${params.id}`);
        res.json({
          jsonrpc: "2.0",
          result: {
            create_time: tx.create_time,
            perform_time: tx.perform_time || 0,
            cancel_time: tx.cancel_time || 0,
            transaction: tx.id,
            state: tx.state,
            reason: null
          },
          id
        });
      } else {
        console.log(`❌ Транзакция ${params.id} не найдена`);
        res.json({
          jsonrpc: "2.0",
          error: { code: -31050, message: "Transaction not found" },
          id
        });
      }
      break;

    case 'GetStatement':
      const from = params.from || 0;
      const to = params.to || Date.now();
      const transactionsList = Array.from(transactions.values())
        .filter(tx => tx.create_time >= from && tx.create_time <= to);
      
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

// Добавляем endpoint для просмотра тестовых заказов
app.get('/test-orders', (req, res) => {
  res.json({
    orders: Array.from(testOrders.values()),
    info: "Эти заказы доступны для тестирования Paycom API"
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📋 Доступные тестовые заказы:`);
  testOrders.forEach(order => {
    console.log(`   - ${order.order_id}: ${order.amount} тийинов`);
  });
});
