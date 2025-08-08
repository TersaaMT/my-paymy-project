// PayMe (Payme.uz) Integration - Правильная реализация
// Основано на официальной документации PayMe

const express = require('express');
const crypto = require('crypto');
const app = express();

// Middleware для парсинга JSON
app.use(express.json());

// Конфигурация PayMe (получите от разработчиков)
const PAYCOM_CONFIG = {
    MERCHANT_ID: process.env.PAYCOM_MERCHANT_ID || 'your_merchant_id',
    SECRET_KEY: process.env.PAYCOM_SECRET_KEY || 'your_secret_key', // Это password из PayMe
    ENDPOINT: '/paycom' // Стандартный endpoint для PayMe
};

// Коды ошибок PayMe
const PAYCOM_ERRORS = {
    INVALID_AMOUNT: -31001,
    TRANSACTION_NOT_FOUND: -31003,
    INVALID_ACCOUNT: -31050,
    UNABLE_TO_PERFORM: -31008,
    TRANSACTION_CANCELLED: -31007
};

// Функция для проверки авторизации
function checkAuth(req) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
        return false;
    }
    
    const credentials = Buffer.from(auth.slice(6), 'base64').toString();
    const [username, password] = credentials.split(':');
    
    return username === 'Paycom' && password === PAYCOM_CONFIG.SECRET_KEY;
}

// Функция для создания JSON-RPC ответа
function createResponse(id, result = null, error = null) {
    const response = {
        jsonrpc: '2.0',
        id: id
    };
    
    if (error) {
        response.error = error;
    } else {
        response.result = result;
    }
    
    return response;
}

// Основной endpoint PayMe
app.post(PAYCOM_CONFIG.ENDPOINT, async (req, res) => {
    try {
        console.log('PayMe запрос:', JSON.stringify(req.body, null, 2));
        
        // Проверка авторизации
        if (!checkAuth(req)) {
            return res.status(401).json(createResponse(
                req.body.id,
                null,
                { code: -32504, message: 'Insufficient privileges' }
            ));
        }

        const { method, params, id } = req.body;

        // Обработка различных методов PayMe
        switch (method) {
            case 'CheckPerformTransaction':
                return res.json(await handleCheckPerformTransaction(params, id));
                
            case 'CreateTransaction':
                return res.json(await handleCreateTransaction(params, id));
                
            case 'PerformTransaction':
                return res.json(await handlePerformTransaction(params, id));
                
            case 'CancelTransaction':
                return res.json(await handleCancelTransaction(params, id));
                
            case 'CheckTransaction':
                return res.json(await handleCheckTransaction(params, id));
                
            case 'GetStatement':
                return res.json(await handleGetStatement(params, id));
                
            default:
                return res.json(createResponse(
                    id,
                    null,
                    { code: -32601, message: 'Method not found' }
                ));
        }

    } catch (error) {
        console.error('Ошибка обработки PayMe запроса:', error);
        return res.status(500).json(createResponse(
            req.body.id,
            null,
            { code: -32603, message: 'Internal error' }
        ));
    }
});

// 1. CheckPerformTransaction - проверка возможности выполнения транзакции
async function handleCheckPerformTransaction(params, id) {
    try {
        const { amount, account } = params;
        
        // Проверка суммы (минимум 1000 тийин = 10 сум)
        if (amount < 1000) {
            return createResponse(id, null, {
                code: PAYCOM_ERRORS.INVALID_AMOUNT,
                message: 'Неверная сумма'
            });
        }
        
        // Проверка существования заказа
        const orderId = account.order_id;
        if (!orderId) {
            return createResponse(id, null, {
                code: PAYCOM_ERRORS.INVALID_ACCOUNT,
                message: 'Неверный аккаунт'
            });
        }
        
        // Здесь должна быть проверка заказа в вашей БД
        // const order = await checkOrderExists(orderId);
        
        console.log(`Проверка транзакции для заказа ${orderId}, сумма: ${amount}`);
        
        return createResponse(id, { allow: true });
        
    } catch (error) {
        console.error('Ошибка CheckPerformTransaction:', error);
        return createResponse(id, null, {
            code: PAYCOM_ERRORS.UNABLE_TO_PERFORM,
            message: 'Невозможно выполнить операцию'
        });
    }
}

// 2. CreateTransaction - создание транзакции
async function handleCreateTransaction(params, id) {
    try {
        const { amount, account, time } = params;
        const transactionId = params.id;
        
        console.log(`Создание транзакции ${transactionId} для заказа ${account.order_id}`);
        
        // Здесь должно быть сохранение транзакции в БД
        // const transaction = await createTransactionInDB({
        //     paycom_transaction_id: transactionId,
        //     order_id: account.order_id,
        //     amount: amount,
        //     state: 1, // Создана
        //     create_time: time
        // });
        
        return createResponse(id, {
            create_time: time,
            transaction: transactionId,
            state: 1
        });
        
    } catch (error) {
        console.error('Ошибка CreateTransaction:', error);
        return createResponse(id, null, {
            code: PAYCOM_ERRORS.UNABLE_TO_PERFORM,
            message: 'Невозможно создать транзакцию'
        });
    }
}

// 3. PerformTransaction - выполнение транзакции (подтверждение оплаты)
async function handlePerformTransaction(params, id) {
    try {
        const transactionId = params.id;
        
        console.log(`Выполнение транзакции ${transactionId}`);
        
        // Здесь должно быть обновление статуса в БД и выполнение бизнес-логики
        // await updateTransactionState(transactionId, 2); // Выполнена
        // await processOrder(transaction.order_id); // Обработка заказа
        
        return createResponse(id, {
            perform_time: Date.now(),
            transaction: transactionId,
            state: 2
        });
        
    } catch (error) {
        console.error('Ошибка PerformTransaction:', error);
        return createResponse(id, null, {
            code: PAYCOM_ERRORS.UNABLE_TO_PERFORM,
            message: 'Невозможно выполнить транзакцию'
        });
    }
}

// 4. CancelTransaction - отмена транзакции
async function handleCancelTransaction(params, id) {
    try {
        const transactionId = params.id;
        const reason = params.reason;
        
        console.log(`Отмена транзакции ${transactionId}, причина: ${reason}`);
        
        // Здесь должна быть логика отмены
        // await cancelTransactionInDB(transactionId, reason);
        
        return createResponse(id, {
            cancel_time: Date.now(),
            transaction: transactionId,
            state: reason === 1 ? -1 : -2
        });
        
    } catch (error) {
        console.error('Ошибка CancelTransaction:', error);
        return createResponse(id, null, {
            code: PAYCOM_ERRORS.UNABLE_TO_PERFORM,
            message: 'Невозможно отменить транзакцию'
        });
    }
}

// 5. CheckTransaction - проверка статуса транзакции
async function handleCheckTransaction(params, id) {
    try {
        const transactionId = params.id;
        
        console.log(`Проверка статуса транзакции ${transactionId}`);
        
        // Здесь должен быть поиск транзакции в БД
        // const transaction = await findTransactionById(transactionId);
        
        // Имитация ответа
        return createResponse(id, {
            create_time: Date.now() - 300000, // 5 минут назад
            perform_time: Date.now() - 60000, // 1 минуту назад
            cancel_time: 0,
            transaction: transactionId,
            state: 2,
            reason: null
        });
        
    } catch (error) {
        console.error('Ошибка CheckTransaction:', error);
        return createResponse(id, null, {
            code: PAYCOM_ERRORS.TRANSACTION_NOT_FOUND,
            message: 'Транзакция не найдена'
        });
    }
}

// 6. GetStatement - получение выписки
async function handleGetStatement(params, id) {
    try {
        const { from, to } = params;
        
        console.log(`Получение выписки с ${from} по ${to}`);
        
        // Здесь должен быть поиск транзакций за период
        // const transactions = await getTransactionsByPeriod(from, to);
        
        return createResponse(id, {
            transactions: []
        });
        
    } catch (error) {
        console.error('Ошибка GetStatement:', error);
        return createResponse(id, null, {
            code: PAYCOM_ERRORS.UNABLE_TO_PERFORM,
            message: 'Невозможно получить выписку'
        });
    }
}

// Дополнительные endpoint'ы для вашего приложения

// Создание ссылки на оплату для фронтенда
app.post('/api/create-payment', async (req, res) => {
    try {
        const { amount, orderId, description } = req.body;
        
        // Генерация ссылки для оплаты через PayMe
        const paymentUrl = `https://checkout.paycom.uz/${btoa(JSON.stringify({
            merchant: PAYCOM_CONFIG.MERCHANT_ID,
            amount: amount * 100, // В тийинах
            account: {
                order_id: orderId
            },
            description: description || 'Оплата заказа',
            lang: 'ru'
        }))}`;
        
        res.json({
            success: true,
            payment_url: paymentUrl,
            order_id: orderId
        });
        
    } catch (error) {
        console.error('Ошибка создания ссылки оплаты:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка создания ссылки оплаты'
        });
    }
});

// Проверка статуса заказа для фронтенда
app.get('/api/order-status/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        
        // Здесь должна быть проверка статуса заказа в БД
        // const orderStatus = await getOrderStatus(orderId);
        
        res.json({
            order_id: orderId,
            status: 'pending', // paid, failed, cancelled
            message: 'Ожидание оплаты'
        });
        
    } catch (error) {
        console.error('Ошибка проверки статуса:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка проверки статуса'
        });
    }
});

// Middleware для обработки ошибок
app.use((error, req, res, next) => {
    console.error('Необработанная ошибка:', error);
    res.status(500).json({
        jsonrpc: '2.0',
        id: req.body?.id || null,
        error: {
            code: -32603,
            message: 'Internal error'
        }
    });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`PayMe сервер запущен на порту ${PORT}`);
    console.log(`PayMe endpoint: http://localhost:${PORT}${PAYCOM_CONFIG.ENDPOINT}`);
    console.log(`Merchant ID: ${PAYCOM_CONFIG.MERCHANT_ID}`);
});

module.exports = app;
