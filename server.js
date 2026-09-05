require('dotenv').config();
const express = require('express');
const session = require('express-session');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

function checkAuth(req, res, next) {
  if (req.session.loggedIn) {
    next();
  } else {
    res.redirect('/login.html');
  }
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', checkAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.use(express.static('public'));

app.post('/api/chat', checkAuth, async (req, res) => {
  try {
    const userMessage = req.body.message;
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: userMessage }],
    });
    res.json({ reply: response.content[0].text });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Что-то пошло не так' });
  }
});

app.listen(port, () => {
  console.log(Сервер запущен на порту ${port});
});