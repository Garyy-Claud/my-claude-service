require('dotenv').config();
const express = require('express');
const session = require('express-session');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Проверка наличия обязательных переменных окружения
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌ Ошибка: ANTHROPIC_API_KEY не указан в .env файле');
  process.exit(1);
}

if (!process.env.SESSION_SECRET) {
  console.error('❌ Ошибка: SESSION_SECRET не указан в .env файле');
  process.exit(1);
}

if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
  console.warn('⚠️ Предупреждение: ADMIN_USERNAME или ADMIN_PASSWORD не указаны');
}

// Инициализация Anthropic с проверкой
let anthropic;
try {
  anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
} catch (error) {
  console.error('❌ Ошибка инициализации Anthropic:', error.message);
  process.exit(1);
}

// Увеличенный лимит размера тела запроса — нужен для передачи фото в формате base64
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Сервер работает за прокси Render — нужно для корректной работы secure-cookie
app.set('trust proxy', 1);

// Настройка сессий с безопасными параметрами
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 часа
    httpOnly: true, // Защита от XSS
    secure: process.env.NODE_ENV === 'production', // HTTPS в продакшене
    sameSite: 'lax' // Защита от CSRF
  }
}));

// Middleware для проверки аутентификации
function checkAuth(req, res, next) {
  if (req.session.loggedIn) {
    next();
  } else {
    // Для AJAX запросов возвращаем 401, для обычных - редирект
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      res.status(401).json({ error: 'Не авторизован' });
    } else {
      res.redirect('/login.html');
    }
  }
}

// Middleware для логирования запросов
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ============ РОУТЫ ============

// Эндпоинт для входа
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Валидация входных данных
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Логин и пароль обязательны'
      });
    }

    // Проверка учетных данных
    const isValid = username === process.env.ADMIN_USERNAME &&
                   password === process.env.ADMIN_PASSWORD;

    if (isValid) {
      req.session.loggedIn = true;
      req.session.username = username;
      req.session.loginTime = Date.now();

      // Обновляем время жизни сессии
      req.session.cookie.maxAge = 24 * 60 * 60 * 1000;

      res.json({
        success: true,
        message: 'Вход выполнен успешно',
        redirect: '/'
      });
    } else {
      // Задержка для защиты от брутфорса
      await new Promise(resolve => setTimeout(resolve, 1000));
      res.status(401).json({
        success: false,
        message: 'Неверный логин или пароль'
      });
    }
  } catch (error) {
    console.error('Ошибка при входе:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера при входе'
    });
  }
});

// Эндпоинт для выхода
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Ошибка при выходе:', err);
      return res.status(500).json({ error: 'Ошибка при выходе' });
    }
    res.json({ success: true, message: 'Выход выполнен' });
  });
});

// Проверка статуса сессии
app.get('/api/check-auth', (req, res) => {
  res.json({
    loggedIn: !!req.session.loggedIn,
    username: req.session.username || null
  });
});

// ============ СТАТИЧЕСКИЕ ФАЙЛЫ ============

// Отдача HTML страниц
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', checkAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Отдача статики (должна быть после всех роутов, кроме 404)
app.use(express.static('public'));

// ============ API ЧАТА ============

app.post('/api/chat', checkAuth, async (req, res) => {
  try {
    const userMessage = req.body.message || '';
    const image = req.body.image;
    const imageMediaType = req.body.imageMediaType;

    // Валидация: должен быть либо текст, либо фото
    if (!userMessage.trim() && !image) {
      return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }

    // Ограничение длины текста
    if (userMessage.length > 10000) {
      return res.status(400).json({ error: 'Сообщение слишком длинное' });
    }

    console.log(`Сообщение от ${req.session.username}: ${userMessage.substring(0, 50)}...${image ? ' [с фото]' : ''}`);

    // Формируем содержимое сообщения — с картинкой или без
    let content;
    if (image) {
      content = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: imageMediaType || 'image/jpeg',
            data: image,
          },
        },
      ];
      if (userMessage.trim()) {
        content.push({ type: 'text', text: userMessage });
      }
    } else {
      content = userMessage;
    }

    // Отправка запроса к Anthropic
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: content
      }],
      temperature: 0.7,
      system: "Вы полезный ассистент, который отвечает на русском языке."
    });

    // Извлечение ответа
    const reply = response.content && response.content[0] && response.content[0].text
      ? response.content[0].text
      : 'Извините, не удалось получить ответ';

    res.json({ reply });

  } catch (error) {
    console.error('Ошибка при обращении к Anthropic:', error);

    // Обработка специфических ошибок Anthropic
    if (error.status === 401) {
      return res.status(401).json({ error: 'Недействительный API ключ' });
    } else if (error.status === 429) {
      return res.status(429).json({ error: 'Превышен лимит запросов. Попробуйте позже' });
    } else if (error.type === 'rate_limit_error') {
      return res.status(429).json({ error: 'Слишком много запросов. Подождите немного' });
    }

    res.status(500).json({
      error: 'Что-то пошло не так. Попробуйте позже'
    });
  }
});

// ============ ОБРАБОТКА 404 ============

app.use((req, res) => {
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    res.status(404).json({ error: 'Ресурс не найден' });
  } else {
    res.status(404).send('<h1>404 — Страница не найдена</h1><a href="/">На главную</a>');
  }
});

// Middleware для обработки ошибок (должен быть последним)
app.use((err, req, res, next) => {
  console.error('❌ Ошибка сервера:', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// ============ ЗАПУСК СЕРВЕРА ============

app.listen(port, '0.0.0.0', () => {
  console.log(`✅ Сервер запущен на порту ${port}`);
  console.log(`🌐 Локальный доступ: http://localhost:${port}`);
  console.log(`🔐 Режим: ${process.env.NODE_ENV || 'development'}`);
});

// Обработка завершения процесса
process.on('SIGTERM', () => {
  console.log('🛑 Получен SIGTERM. Завершаем работу...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Получен SIGINT. Завершаем работу...');
  process.exit(0);
});
