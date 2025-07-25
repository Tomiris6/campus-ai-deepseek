// server.js - MODIFIED FOR RAG WITH PGVECTOR

// 1. Load environment variables first
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const OpenAI = require('openai'); // For Deepseek via OpenRouter
const { Pool } = require('pg');
const fetch = require('node-fetch'); // <-- ADD THIS LINE for Ollama embedding calls

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- Ollama Configuration for Embeddings ---
const OLLAMA_EMBEDDING_MODEL = 'bge-large'; // Ensure this model is pulled in Ollama
const OLLAMA_API_BASE_URL = 'http://localhost:11434'; // Your Ollama server address

// 3. Configure OpenAI client (for Deepseek via OpenRouter)
const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  timeout: 60000,
});

// 4. Configure PostgreSQL Connection Pool
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT, 10),
  ssl: false
});

// 5. Test the database connection
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error acquiring client for database connection test', err.stack);
  }
  client.query('SELECT NOW()', (err, result) => {
    release();
    if (err) {
      return console.error('Error executing test query on database', err.stack);
    }
    console.log('Database connected successfully at:', result.rows[0].now);
  });
});

// --- NEW FUNCTION: Generate embedding for text (for user queries) ---
async function generateEmbedding(text) {
  try {
    const response = await fetch(`${OLLAMA_API_BASE_URL}/api/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OLLAMA_EMBEDDING_MODEL,
        prompt: text,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Ollama Embedding API error: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    const data = await response.json();
    return data.embedding;
  } catch (error) {
    console.error(`Error generating embedding for text: "${text.substring(0, 50)}..."`, error.message);
    return null;
  }
}

// --- MODIFIED retrieveContext function to use vector search ---
async function retrieveContext(userQuery, topK = 3) { // Added topK parameter
  console.log(`Attempting to retrieve context for query: "${userQuery}" using vector search.`);
  let context = '';

  try {
    const queryEmbedding = await generateEmbedding(userQuery);

    if (!queryEmbedding) {
      console.warn('Failed to generate embedding for the user query. Falling back to basic search or no context.');
      // Fallback: If embedding fails, you might still want to do the old ILIKE search here,
      // or simply return no context. For now, let's just return empty context.
      return '';
    }

    console.log(`Performing vector search in knowledge_base for top ${topK} similar entries.`);
    const res = await pool.query(
      `SELECT
                content_text,
                embedding <=> $1::vector AS distance
             FROM
                knowledge_base
             ORDER BY
                distance
             LIMIT $2;`,
      [JSON.stringify(queryEmbedding), topK]
    );

    console.log("Vector Search Results:", res.rows.length, "rows found.");

    if (res.rows.length > 0) {
      context += "Relevant Information from Knowledge Base:\n";
      res.rows.forEach((row, index) => {
        // You can choose how much detail from the retrieved row to include
        // For simplicity, we'll just add the content_text
        context += `
Similarity Distance: ${row.distance.toFixed(4)}
Content: ${row.content_text}
`;
      });
    }

  } catch (error) {
    console.error('Error retrieving context from database with vector search:', error.stack);
    context = ''; // Ensure context is empty on error
  }
  return context;
}

const schoolData = {
  name: "Kwun Tong Maryknoll College",
  description: "Kwun Tong Maryknoll College is the third secondary school opened in Hong Kong by the Maryknoll Fathers, a society of Catholic priests and brothers founded in the United States in 1911. At that time there were only two 'Maryknollers' - Father James A.Walsh and Father Frederick Price. They came together to start a missionary work which has since grown into a society of over a thousand priests, brothers and students dedicated to bringing the knowledge and love of God to the people of 18 countries around the world",
  contacts: {
    phone: "(852)2717 1485»",
    email: "ktmc@ktmc.edu.hk",
    address: "100 Tsui Ping Road, Kwun Tong, Kowloon, Hong Kong"
  },
  programs: ["Science", "Arts", "Languages"],
};

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/api/school-info', (req, res) => {
  res.json(schoolData);
});

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    const userMessage = messages[messages.length - 1].content;

    // Retrieve relevant context from your database using vector search
    const retrievedContext = await retrieveContext(userMessage, 3);
    console.log("Retrieved Context for AI:", retrievedContext);

    // 1. Prepare a string version of basic schoolData to always include in the prompt
    //    This makes sure the AI can read it properly.
    const basicSchoolInfoString = `
School Name: ${schoolData.name}
School Description: ${schoolData.description}
Contacts:
  Phone: ${schoolData.contacts.phone}
  Email: ${schoolData.contacts.email}
  Address: ${schoolData.contacts.address}
Programs: ${schoolData.programs.join(', ')}
`;

    // 2. Define the main system content with strict instructions
    let systemContent = `You are a helpful, friendly, and approachable assistant for Kwun Tong Maryknoll College.
        Your primary goal is to answer questions about Kwun Tong Maryknoll College ONLY.
        Strictly use the provided information to answer. If a detail is not explicitly stated in the "Basic School Information" or "Relevant Information from Knowledge Base", you MUST NOT include it in your answer. Do not add any information from your general knowledge base unless it is directly provided in the context.
        
        If the answer is directly available in the "Relevant Information from Knowledge Base" (from RAG), prioritize that.
        If not, check the "Basic School Information" provided.
        
        If the answer is still not found in *either* the "Relevant Information from Knowledge Base" or the "Basic School Information", or if the question is not about Kwun Tong Maryknoll College, you MUST politely state that the information is not available or that you can only answer questions related to the school.
        Do NOT invent, assume, or infer any information. Do NOT provide contact details (like emails or phone numbers) unless they are explicitly present in the provided context.

        Adopt a natural and friendly conversational tone. You can use one or two relevant and subtle emojis (like 😊, 👍, 📚, 🏫) in your responses to make them more engaging, but do not overuse them.

        Basic School Information:
        ${basicSchoolInfoString}
        `;

    // 3. Append the dynamically retrieved context if it exists
    if (retrievedContext) {
      systemContent += `\n\nRelevant Information from Knowledge Base:\n${retrievedContext}`;
    }

    // 4. Create the final systemMessage object using the constructed systemContent
    //    ENSURE THIS IS THE ONLY 'systemMessage' DEFINITION IN THIS BLOCK
    const systemMessage = {
      role: "system",
      content: systemContent,
    };
    // --- END OF CRITICAL SECTION ---

    const fullMessages = [systemMessage, ...messages];

    console.log("Sending messages to AI (Deepseek via OpenRouter):", fullMessages.length, "messages");
    // console.log("Full System Message to AI:", systemMessage.content); // Optional: uncomment for debugging the full prompt

    const response = await openai.chat.completions.create({
      model: 'deepseek/deepseek-chat',
      messages: fullMessages,
      temperature: 0.3,
      max_tokens: 500
    });

    const assistantResponse = response.choices[0].message.content;

    res.json({ response: assistantResponse });
  } catch (error) {
    console.error('Error in /api/chat route:', error);
    res.status(500).json({ error: "Error processing request" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});