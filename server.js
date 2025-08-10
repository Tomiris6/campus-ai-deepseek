// server.js

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { queryKnowledgeBase, countTokens } = require('./query_knowledge_base');
const { Pool } = require('pg');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Logging Helpers ----------
function divider(label) {
  const line = '─'.repeat(30);
  return label ? `${line} ${label} ${line}` : line.repeat(2);
}

function logHeader(msg) {
  console.log('\n' + divider(msg));
}

function logInfo(...args) {
  console.log('ℹ️ ', ...args);
}

function logSuccess(...args) {
  console.log('✅', ...args);
}

function logWarn(...args) {
  console.warn('⚠️ ', ...args);
}

function logError(msg, err) {
  console.error('❌', msg, err ? `\n   → ${err.stack || err}` : '');
}

function hrtimeMs(start) {
  const diff = process.hrtime(start);
  return Math.round((diff[0] * 1e9 + diff[1]) / 1e6);
}

// ---------- Middleware ----------
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ---------- Database Connection ----------
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT, 10),
});

pool.connect((err, client, release) => {
  if (err) {
    return logError('Error acquiring client for database connection test', err);
  }
  client.query('SELECT NOW()', (err, result) => {
    release();
    if (err) {
      return logError('Error executing test query on database', err);
    }
    logSuccess(`Database connected successfully at: ${result.rows[0].now}`);
  });
});

// ---------- OpenAI Setup ----------
const openai = new OpenAI({
  apiKey: process.env.API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  timeout: 60000,
});

// ---------- Routes ----------
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.post('/api/chat', async (req, res) => {
  logHeader('New /api/chat request');
  console.time('Total Chat Request Processing');

  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      logWarn('No messages provided in request body');
      return res.status(400).json({ error: 'No messages provided.' });
    }

    const userMessage = messages[messages.length - 1].content;
    logInfo(`User message: "${userMessage.slice(0, 80)}${userMessage.length > 80 ? '…' : ''}"`);

    // Context Retrieval
    const tContext = process.hrtime();
    const retrievedContextString = await queryKnowledgeBase(userMessage);
    logInfo(`Context retrieval took ${hrtimeMs(tContext)} ms`);

    // Build system prompt
    let systemContent = `
You are a warm, helpful AI assistant guiding website visitors. 
Your responses will be read aloud by a digital avatar, so speak naturally and conversationally.

**Speech Output Guidelines:**
- Sound like you're chatting in real time: clear, friendly, and engaging.
- Use gentle interjections like "Of course" or "That's a great question".
- Keep sentences short and easy to follow.
- Avoid mentioning text, visuals, or formatting.
- Don't use emojis or symbols — describe expressions instead.
- Avoid jargon unless required.
- Only share accurate info from provided website content.

**Audience & Tone:**
- Match tone and terminology to the website's domain.
- Respectful, clear language.

**Content Rules:**
- Use only "Relevant Information from Knowledge Base".
- Do not speculate or invent answers.
- Include source URLs directly after relevant answers.

If you do NOT know the answer, reply EXACTLY:
"I apologize, but I don't have enough information to answer that question.
Please contact the organization directly for more details or check their official website.  
Let me know if you have any other questions."

---`;

    if (retrievedContextString?.trim()) {
      systemContent += `\n---\nRelevant Information from Knowledge Base:\n${retrievedContextString}\n`;
    }

    const systemMessage = { role: 'system', content: systemContent };
    const fullMessages = [systemMessage, ...messages];

    logInfo(`Sending ${fullMessages.length} messages to LLM.`);
    const promptTokenCount = countTokens(systemContent);
    logInfo(`Approximate prompt tokens: ${promptTokenCount}`);

    // Call LLM
    const tLLM = process.hrtime();
    const response = await openai.chat.completions.create({
      model: 'deepseek/deepseek-r1-distill-llama-70b:free',
      messages: fullMessages,
      temperature: 0.3,
      max_tokens: 1000,
    });
    logInfo(`LLM response generation took ${hrtimeMs(tLLM)} ms`);

    const assistantResponse = response.choices[0].message.content;
    logSuccess('Chat processed successfully');
    res.json({ response: assistantResponse });

  } catch (error) {
    logError('Critical failure during chat processing', error);
    res.status(500).json({ error: 'An internal error occurred. Please try again later.' });
  } finally {
    console.timeEnd('Total Chat Request Processing');
  }
});

// ---------- Start Server ----------
app.listen(PORT, () => {
  logHeader(`Server running on http://localhost:${PORT}`);
});
