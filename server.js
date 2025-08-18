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

// --- NEW: Function to log chat interactions to the database ---
const logToDb = async (logData) => {
  const query = `
        INSERT INTO chat_history(user_id, session_id, user_message, assistant_response, retrieved_context, final_prompt, latency_ms, status, error_message)
        VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
  // Ensure all values are defined to prevent database errors
  const values = [
    logData.userId || 'N/A',
    logData.sessionId || 'N/A',
    logData.userMessage || 'N/A',
    logData.assistantResponse,
    logData.retrievedContext,
    logData.finalPrompt,
    logData.latency,
    logData.status,
    logData.errorMessage
  ];
  try {
    await pool.query(query, values);
    console.log('✅ Chat interaction successfully logged to database.');
  } catch (dbError) {
    console.error('❌ Failed to log chat interaction to database:', dbError);
  }
};


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

  // --- MODIFIED: Extract IDs and prepare variables ---
  const { messages, user_id, session_id } = req.body;
  const userMessage = messages && messages.length > 0 ? messages[messages.length - 1].content : null;

  // Define variables here to be accessible in the 'catch' block
  let retrievedContextString = null;
  let systemContent = null;
  let totalMs = 0;
  let queryEmbedding = null;
  let key = null;

  try {
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      logWarn('No messages provided in request body');
      return res.status(400).json({ error: 'No messages provided.' });
    }
    if (!user_id || !session_id) {
      logWarn('User ID or Session ID missing from request');
      return res.status(400).json({ error: 'User and Session IDs are required.' });
    }

    logInfo(`User: ${user_id}, Session: ${session_id}`);
    logInfo(`User message: "${userMessage.slice(0, 80)}${userMessage.length > 80 ? '…' : ''}"`);

    // Context Retrieval
    const tContext = process.hrtime();
    const contextResult = await queryKnowledgeBase(userMessage);
    retrievedContextString = contextResult.context;
    queryEmbedding = contextResult.embedding;
    key = contextResult.key;
    const contextMs = hrtimeMs(tContext);

    if (contextMs > LATENCY_THRESHOLDS.contextRetrieval) {
      logWarn(`Context retrieval took ${contextMs} ms (Threshold: ${LATENCY_THRESHOLDS.contextRetrieval} ms)`);
    } else {
      logInfo(`Context retrieval took ${contextMs} ms`);
    }

    // Build system prompt
    systemContent = `
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
      model: 'openai/gpt-oss-20b:free',
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

    // Your existing caching logic
    const apologyPatterns = [
      "i apologize", "i'm sorry", "sorry", "i do not have", "i don't have",
      "don't have enough information", "not enough information", "i'm unable to find", "unable to",
      "cannot answer", "no relevant information", "no information available",
      "please contact the organization directly",
      "Sorry, an error occurred with the server. Please try again."
    ];
    const hasApology = apologyPatterns.some(pat => assistantResponse.toLowerCase().includes(pat));
    if (!hasApology) {
      pruneSize();
      cache.set(key, { value: assistantResponse, timestamp: now(), embedding: queryEmbedding });
      markUsed(key);
      logSuccess('✅ Cache set for key:', JSON.stringify(key), 'Cache size:', cache.size);
    } else {
      logWarn('⛔ Not caching apology/fallback message for key:', JSON.stringify(key));
    }

    logSuccess('Chat processed successfully');

    // --- NEW: Log successful interaction to DB ---
    totalMs = hrtimeMs(tTotal);
    await logToDb({
      userId: user_id,
      sessionId: session_id,
      userMessage: userMessage,
      assistantResponse: assistantResponse,
      retrievedContext: retrievedContextString,
      finalPrompt: systemContent,
      latency: totalMs,
      status: 'success',
      errorMessage: null
    });

    res.json({ response: assistantResponse });

  } catch (error) {
    logError('Critical failure during chat processing', error);

    // --- NEW: Log failed interaction to DB ---
    totalMs = hrtimeMs(tTotal);
    await logToDb({
      userId: user_id,
      sessionId: session_id,
      userMessage: userMessage,
      assistantResponse: null,
      retrievedContext: retrievedContextString,
      finalPrompt: systemContent,
      latency: totalMs,
      status: 'error',
      errorMessage: error.message
    });

    res.status(500).json({ error: 'An internal error occurred. Please try again later.' });
  } finally {
    // The finally block remains the same, calculating total time.
    // The logging now happens within the try/catch blocks to ensure accuracy.
    totalMs = hrtimeMs(tTotal);
    logInfo(`Total Chat Request Processing: ${totalMs} ms`);
  }
});


// ---------- Start Server ----------
app.listen(PORT, () => {
  logHeader(`Server running on http://localhost:${PORT}`);
});