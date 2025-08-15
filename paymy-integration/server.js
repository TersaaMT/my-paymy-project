const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const LOGIN = "Paycom";
const PASSWORD = "95n%ceFHPhU8G3UdiO3dt1g3EbpV8KFS66y9"; 
const EXPECTED_AUTH = "Basic " + Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');

// Хранилище транзакций (в продакшене - база данных)
const transactions = new Map();

// Тестовые заказы для проверки
const testOrders = new Map([
  ['TEST_ORDER_001', { order_id: 'TEST_ORDER_001', amount: 50000, status: 'pending' }],
  ['TEST_ORDER_002', { order_id: 'TEST_ORDER_002', amount: 100000, status: 'pending' }],
  ['12345', { order_id: '12345', amount: 1000, status: 'pending' }]
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
        reason: null // Инициализируем reason
      };

      transactions.set(transactionId, newTransaction);
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
      cancelTx.reason = reason; // СОХРАНЯЕМ ПРИЧИНУ ОТМЕНЫ!
      
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
          reason: checkTx.reason // ВОЗВРАЩАЕМ СОХРАНЕННУЮ ПРИЧИНУ!
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
          reason: tx.reason // ВКЛЮЧАЕМ ПРИЧИНУ В ВЫПИСКУ!
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📋 Доступные тестовые заказы:`);
  testOrders.forEach(order => {
    console.log(`   - ${order.order_id}: ${order.amount} тийинов`);
  });
  console.log(`💡 Логика оплаты: ОДНОРАЗОВАЯ (защита от двойной оплаты)`);
  console.log(`🔒 Защита: -31099 при попытке создать вторую транзакцию для заказа`);
  console.log(`📝 Сохранение reason при отмене транзакций`);
});
