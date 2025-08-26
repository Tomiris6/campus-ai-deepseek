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
  maxRetries: 3,
});

// ---------- Routes ----------
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.post('/api/chat', async (req, res) => {
  const tTotal = process.hrtime();
  logHeader('New /api/chat request');

  const { messages, user_id, session_id, userId, sessionId } = req.body;
  const safeUserId = user_id || userId || "anonymous_user";
  const safeSessionId = session_id || sessionId || "session_" + Date.now();
  const userMessage = messages && messages.length > 0 ? messages[messages.length - 1].content : null;

  let retrievedContextString = null;
  let systemContent = null;

  if (!userMessage) {
    logWarn('No messages provided');
    return res.status(400).json({ error: 'No messages provided.' });
  }

  try {
    // Step 1: Get either a final answer (cache hit) or context (cache miss)
    const contextResult = await queryKnowledgeBase(userMessage, safeUserId, safeSessionId);

    // Step 2: Handle the Cache Hit case
    if (contextResult.cacheHit) {
      const cachedResponse = contextResult.context; // On a hit, 'context' is the final answer

      logHeader('Final Output & Summary');
      console.log('   → Full LLM Response (from Cache):');
      console.log(cachedResponse.split('\n').map(line => `     ${line}`).join('\n'));

      const totalMs = hrtimeMs(tTotal);
      console.log('\n   → Summary:');
      logInfo(`Total Request Time: ${totalMs} ms`);
      logSuccess('   - ✅ Cache status: Response successfully served from cache.');

      await logToDb({
        userId: safeUserId, sessionId: safeSessionId, userMessage: userMessage,
        assistantResponse: cachedResponse,
        retrievedContext: "N/A (Cache Hit)",
        finalPrompt: "N/A (Cache Hit)",
        latency: totalMs,
        status: 'success_cache_hit',
        errorMessage: null
      });

      // Exit early, sending the cached response directly
      return res.json({ response: cachedResponse });
    }

    // Step 3: Handle the Cache Miss case (full RAG pipeline)
    retrievedContextString = contextResult.context; // On a miss, 'context' is the raw context for the LLM

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
- Don't provide output in the form of tables,charts or any figures


**Audience & Tone:**
- Match tone and terminology to the website's domain.
- Respectful, clear language.


**Content Rules:**
- Use only "Relevant Information from Knowledge Base".
- Do not speculate or invent answers.
- Include source URLs directly after relevant answers only if the USER ASKS FOR IT in the next response.


If you do NOT know the answer, reply EXACTLY:
"I apologize, but I don't have enough information to answer that question.
Please contact the organization directly for more details or check their official website.  
Let me know if you have any other questions."


---
Relevant Information from Knowledge Base:
${retrievedContextString}
`;

    const systemMessage = { role: 'system', content: systemContent };
    const fullMessages = [systemMessage, ...messages];

    logHeader('LLM Final Response Generation');
    logInfo(`Sending prompt to LLM...`);

    const response = await openai.chat.completions.create({
      model: 'openai/gpt-oss-20b:free',
      messages: fullMessages,
      temperature: 0.6,
      max_tokens: 600,
    });

    // Validate the API response structure before trying to access it
    if (!response || !response.choices || response.choices.length === 0) {
      throw new Error('Invalid response structure from LLM API.');
    }

    const assistantResponse = response.choices[0].message.content;

    logHeader('Final Output & Summary');

    // Validate the content of the response
    if (!assistantResponse || assistantResponse.trim() === '') {
      throw new Error('LLM returned an empty response.');
    }

    console.log('   → Full LLM Response:');
    console.log(assistantResponse.split('\n').map(line => `     ${line}`).join('\n'));

    const totalMs = hrtimeMs(tTotal);
    console.log('\n   → Summary:');
    logInfo(`Total Request Time: ${totalMs} ms`);

    // Step 4: Cache the final, validated answer
    const isApology = assistantResponse.toLowerCase().includes("i apologize");
    if (!isApology) {
      pruneSize();
      cache.set(contextResult.key, {
        value: assistantResponse, // Cache the final answer
        timestamp: now(),
        embedding: contextResult.embedding
      });
      markUsed(contextResult.key);
      logSuccess('   - ✅ Cache status: Response successfully stored in cache.');
    } else {
      logInfo('   - ⛔ Cache status: Response not cached (it was a fallback).');
    }

    await logToDb({
      userId: safeUserId, sessionId: safeSessionId, userMessage: userMessage,
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
    const totalMs = hrtimeMs(tTotal);
    await logToDb({
      userId: safeUserId, sessionId: safeSessionId, userMessage: userMessage,
      assistantResponse: null, retrievedContext: retrievedContextString,
      finalPrompt: systemContent, latency: totalMs, status: 'error', errorMessage: error.message
    });
    res.status(500).json({ error: 'An internal error occurred.' });
  } finally {
    console.log(divider());
  }
});






// ---------- Start Server ----------
app.listen(PORT, () => {
  logHeader(`Server running on http://localhost:${PORT}`);
});