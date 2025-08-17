// server.js

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { queryKnowledgeBase, cache, normalizeQuery, now, pruneSize, markUsed } = require('./query_knowledge_base'); // <-- MODIFIED: Removed countTokens
const { Pool } = require('pg');
const OpenAI = require('openai');
const { encoding_for_model } = require('@dqbd/tiktoken'); // <-- ADDED for token counting

const app = express();
const PORT = process.env.PORT || 3000;

// --- NEW --- Latency thresholds in milliseconds
const LATENCY_THRESHOLDS = {
  contextRetrieval: 5000,  // 5 seconds
  llmGeneration: 20000,    // 20 seconds
  totalProcessing: 25000   // 25 seconds
};

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

// Function to count tokens
const tokenizer = encoding_for_model('gpt-3.5-turbo');
function countTokens(text) {
  if (!text) return 0;
  return tokenizer.encode(text).length;
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
  const tTotal = process.hrtime();

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
    const { context: retrievedContextString, embedding: queryEmbedding, key } = await queryKnowledgeBase(userMessage);
    const contextMs = hrtimeMs(tContext);

    if (contextMs > LATENCY_THRESHOLDS.contextRetrieval) {
      logWarn(`Context retrieval took ${contextMs} ms (Threshold: ${LATENCY_THRESHOLDS.contextRetrieval} ms)`);
    } else {
      logInfo(`Context retrieval took ${contextMs} ms`);
    }

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
    const llmMs = hrtimeMs(tLLM);

    if (llmMs > LATENCY_THRESHOLDS.llmGeneration) {
      logWarn(`LLM response generation took ${llmMs} ms (Threshold: ${LATENCY_THRESHOLDS.llmGeneration} ms)`);
    } else {
      logInfo(`LLM response generation took ${llmMs} ms`);
    }

    const assistantResponse = response.choices[0].message.content;

    // ** MODIFIED ** - Caching Logic is now consolidated here
    const apologyPatterns = [
      "i apologize", "i'm sorry", "sorry", "i do not have", "i don't have",
      "don't have enough information", "not enough information", "i'm unable to find", "unable to",
      "cannot answer", "no relevant information", "no information available",
      "please contact the organization directly"
    ];

    const hasApology = apologyPatterns.some(pat => assistantResponse.toLowerCase().includes(pat));

    if (!hasApology) {
      pruneSize(); // Check for LRU pruning
      cache.set(key, { value: assistantResponse, timestamp: now(), embedding: queryEmbedding });
      markUsed(key); // Mark the new key as most recently used
      logSuccess('✅ Cache set for key:', JSON.stringify(key), 'Cache size:', cache.size);
    } else {
      logWarn('⛔ Not caching apology/fallback message for key:', JSON.stringify(key));
    }
    // ** END MODIFIED **

    logSuccess('Chat processed successfully');
    res.json({ response: assistantResponse });

  } catch (error) {
    logError('Critical failure during chat processing', error);
    res.status(500).json({ error: 'An internal error occurred. Please try again later.' });
  } finally {
    const totalMs = hrtimeMs(tTotal);
    logInfo(`Total Chat Request Processing: ${totalMs} ms`);
  }
});

// ---------- Start Server ----------
app.listen(PORT, () => {
  logHeader(`Server running on http://localhost:${PORT}`);
});