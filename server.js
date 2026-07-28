// Minimal backend for the in-app chatbot.
//
// This is the ONLY place your Anthropic API key should ever live.
// The app itself calls this server, never api.anthropic.com directly.
//
// Run locally:
//   cd backend
//   npm install
//   ANTHROPIC_API_KEY=sk-ant-... npm start
//
// Then point src/utils/chatApi.ts's BACKEND_URL at wherever this is
// running (http://localhost:3001/api/chat for local dev, or your
// deployed URL once you host it — e.g. Render, Railway, a small VPS).

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.ANTHROPIC_API_KEY;

// Very small per-process daily request counter, since this is a
// non-commercial app and you likely want a hard ceiling on API spend
// rather than per-user accounts. Resets when the server restarts;
// swap for a real store (Redis, a file, a DB row) if you deploy long-term.
let requestCountToday = 0;
let countResetAt = Date.now() + 24 * 60 * 60 * 1000;
const DAILY_REQUEST_LIMIT = Number(process.env.DAILY_REQUEST_LIMIT || 200);

app.post('/api/chat', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY is not set on the server. Set it as an environment variable.',
    });
  }

  if (Date.now() > countResetAt) {
    requestCountToday = 0;
    countResetAt = Date.now() + 24 * 60 * 60 * 1000;
  }
  if (requestCountToday >= DAILY_REQUEST_LIMIT) {
    return res.status(429).json({ error: 'Daily question limit reached. Try again tomorrow.' });
  }

  const { question, contextTerms } = req.body;
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Missing "question" in request body.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // cheap/fast — good fit for definition-style Q&A
        max_tokens: 500,
        system:
          'You explain Indian stock market concepts simply and accurately for a beginner-to-intermediate learner. ' +
          `Ground your answers in these glossary terms where relevant: ${Array.isArray(contextTerms) ? contextTerms.join(', ') : ''}. ` +
          'Keep answers under 150 words unless the question genuinely needs more depth. This is an educational, non-commercial app — never give buy/sell recommendations on specific stocks.',
        messages: [{ role: 'user', content: question }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'Upstream API error.' });
    }

    const data = await response.json();
    const answer = data.content?.[0]?.text ?? 'Sorry, I could not generate an answer.';
    requestCountToday += 1;
    res.json({ answer });
  } catch (err) {
    console.error('Chat backend error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

app.listen(PORT, () => {
  console.log(`Chat backend listening on http://localhost:${PORT}`);
});
