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

    console.log(Сообщение от ${req.session.username}: ${userMessage.substring(0, 50)}...${image ? ' [с фото]' : ''});

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
  console.log(✅ Сервер запущен на порту ${port});
  console.log(🌐 Локальный доступ: http://localhost:${port});
  console.log(🔐 Режим: ${process.env.NODE_ENV || 'development'});
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