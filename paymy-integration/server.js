// PayMe Integration API Endpoints
// Используйте Express.js для создания веб-сервера

const express = require('express');
const crypto = require('crypto');
const app = express();

// Middleware для парсинга JSON
app.use(express.json());

// Конфигурация PayMe (получите от разработчиков)
const PAYMY_CONFIG = {
    MERCHANT_ID: 'your_merchant_id',
    SECRET_KEY: 'your_secret_key',
    CALLBACK_URL: 'https://yourdomain.com/api/paymy/callback',
    WEBHOOK_URL: 'https://yourdomain.com/api/paymy/webhook'
};

// Функция для генерации подписи
function generateSignature(data, secretKey) {
    const sortedKeys = Object.keys(data).sort();
    const signString = sortedKeys.map(key => `${key}=${data[key]}`).join('&');
    return crypto.createHmac('sha256', secretKey).update(signString).digest('hex');
}

// Функция для проверки подписи
function verifySignature(data, receivedSignature, secretKey) {
    const calculatedSignature = generateSignature(data, secretKey);
    return calculatedSignature === receivedSignature;
}

// 1. Endpoint для создания платежа
app.post('/api/paymy/create-payment', async (req, res) => {
    try {
        const { amount, orderId, description, customerPhone } = req.body;
        
        // Валидация входных данных
        if (!amount || !orderId || !customerPhone) {
            return res.status(400).json({
                success: false,
                message: 'Отсутствуют обязательные параметры'
            });
        }

        // Подготовка данных для PayMe
        const paymentData = {
            merchant_id: PAYMY_CONFIG.MERCHANT_ID,
            amount: amount * 100, // PayMe работает с копейками
            order_id: orderId,
            description: description || 'Оплата заказа',
            phone: customerPhone,
            callback_url: PAYMY_CONFIG.CALLBACK_URL,
            webhook_url: PAYMY_CONFIG.WEBHOOK_URL,
            timestamp: Date.now()
        };

        // Генерация подписи
        paymentData.signature = generateSignature(paymentData, PAYMY_CONFIG.SECRET_KEY);

        // Здесь должен быть запрос к API PayMe для создания платежа
        // const paymeResponse = await axios.post('https://api.paymy.uz/create-payment', paymentData);
        
        // Имитация ответа PayMe
        const mockResponse = {
            success: true,
            payment_id: `pm_${Date.now()}`,
            payment_url: `https://pay.paymy.uz/pay/${Date.now()}`,
            status: 'pending'
        };

        res.json({
            success: true,
            data: mockResponse
        });

    } catch (error) {
        console.error('Ошибка создания платежа:', error);
        res.status(500).json({
            success: false,
            message: 'Внутренняя ошибка сервера'
        });
    }
});

// 2. Webhook endpoint для уведомлений от PayMe
app.post('/api/paymy/webhook', async (req, res) => {
    try {
        const webhookData = req.body;
        console.log('Получен webhook от PayMe:', webhookData);

        // Проверка подписи
        const { signature, ...dataForSignature } = webhookData;
        if (!verifySignature(dataForSignature, signature, PAYMY_CONFIG.SECRET_KEY)) {
            console.error('Неверная подпись webhook');
            return res.status(400).json({ error: 'Неверная подпись' });
        }

        // Обработка различных статусов платежа
        switch (webhookData.status) {
            case 'paid':
                console.log(`Платеж ${webhookData.payment_id} успешно оплачен`);
                // Обновить статус заказа в базе данных
                await updateOrderStatus(webhookData.order_id, 'paid');
                // Отправить уведомление клиенту
                break;

            case 'failed':
                console.log(`Платеж ${webhookData.payment_id} не удался`);
                await updateOrderStatus(webhookData.order_id, 'failed');
                break;

            case 'cancelled':
                console.log(`Платеж ${webhookData.payment_id} отменен`);
                await updateOrderStatus(webhookData.order_id, 'cancelled');
                break;

            default:
                console.log(`Неизвестный статус платежа: ${webhookData.status}`);
        }

        // PayMe ожидает ответ "OK"
        res.status(200).json({ status: 'OK' });

    } catch (error) {
        console.error('Ошибка обработки webhook:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// 3. Callback endpoint для возврата пользователя после оплаты
app.get('/api/paymy/callback', (req, res) => {
    try {
        const { payment_id, status, order_id } = req.query;
        
        console.log('Пользователь вернулся после оплаты:', {
            payment_id,
            status,
            order_id
        });

        // Перенаправление в зависимости от статуса
        switch (status) {
            case 'success':
                res.redirect(`/payment-success?order_id=${order_id}`);
                break;
            case 'failed':
                res.redirect(`/payment-failed?order_id=${order_id}`);
                break;
            case 'cancelled':
                res.redirect(`/payment-cancelled?order_id=${order_id}`);
                break;
            default:
                res.redirect(`/payment-status?order_id=${order_id}&status=${status}`);
        }

    } catch (error) {
        console.error('Ошибка обработки callback:', error);
        res.redirect('/payment-error');
    }
});

// 4. Endpoint для проверки статуса платежа
app.get('/api/paymy/payment-status/:paymentId', async (req, res) => {
    try {
        const { paymentId } = req.params;
        
        // Здесь должен быть запрос к API PayMe для проверки статуса
        // const statusResponse = await axios.get(`https://api.paymy.uz/payment/${paymentId}/status`);
        
        // Имитация ответа
        const mockStatus = {
            payment_id: paymentId,
            status: 'paid',
            amount: 10000,
            order_id: 'ORD_123',
            created_at: new Date().toISOString()
        };

        res.json({
            success: true,
            data: mockStatus
        });

    } catch (error) {
        console.error('Ошибка проверки статуса:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка проверки статуса платежа'
        });
    }
});

// Функция обновления статуса заказа (заменить на вашу реализацию)
async function updateOrderStatus(orderId, status) {
    console.log(`Обновление статуса заказа ${orderId} на ${status}`);
    // Здесь должна быть логика обновления в вашей базе данных
    // await db.orders.update({ id: orderId }, { status: status });
}

// Middleware для обработки ошибок
app.use((error, req, res, next) => {
    console.error('Необработанная ошибка:', error);
    res.status(500).json({
        success: false,
        message: 'Внутренняя ошибка сервера'
    });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Webhook URL: http://localhost:${PORT}/api/paymy/webhook`);
    console.log(`Callback URL: http://localhost:${PORT}/api/paymy/callback`);
});

module.exports = app;