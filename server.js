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
  let contexts = []; // Initialize as an array to store multiple context strings

  try {
    const queryEmbedding = await generateEmbedding(userQuery);

    if (!queryEmbedding) {
      console.warn('Failed to generate embedding for the user query. Falling back to basic search or no context.');
      return []; // Return empty array on failure
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
      // Push individual content_text strings into the contexts array
      res.rows.forEach((row) => {
        contexts.push(row.content_text);
      });
    }

  } catch (error) {
    console.error('Error retrieving context from database with vector search:', error.stack);
    return []; // Ensure contexts is empty on error
  }
  return contexts; // Return the array of contexts
}


/**
 * Generates multiple query variations from a single user message using an LLM.
 * @param {string} userMessage The original message from the user.
 * @returns {Promise<string[]>} A promise that resolves to an array of query strings.
 */
async function generateMultiQueries(userMessage) {
  const multiQueryPrompt = `
You are an expert query rewrite engine. Your task is to generate 3-5 alternative versions of the given user query.
These alternative queries should be slightly different in phrasing, perspective, or focus, but still aim to retrieve relevant information for the original query.
This helps in retrieving a wider range of relevant documents from a knowledge base.

Original Query: "${userMessage}"

Generate the alternative queries, each on a new line, starting with a hyphen. Do NOT include any other text or numbering.

Examples:
- What are the library's resources?
- Tell me about the books in the school library.
- Information on the school canteen's operating hours.
- What food options are available in the cafeteria?
`;

  try {
    // --- IMPORTANT CHANGE HERE: Use the existing 'openai' client ---
    const response = await openai.chat.completions.create({
      model: 'deepseek/deepseek-chat', // Using the same model as your main chat
      messages: [{ role: 'user', content: multiQueryPrompt }],
      temperature: 0.7, // A slightly higher temperature can encourage more diverse queries
      max_tokens: 200 // Limit tokens for query generation
    });

    const generatedText = response.choices[0].message.content.trim();

    // Parse the generated queries, assuming each is on a new line starting with a hyphen
    const queries = generatedText.split('\n')
      .map(line => line.replace(/^- /, '').trim())
      .filter(line => line.length > 0); // Filter out any empty strings

    // Add the original query to ensure it's always included
    // Check for lowercase to avoid duplicates due to case
    if (!queries.some(q => q.toLowerCase() === userMessage.toLowerCase())) {
      queries.unshift(userMessage); // Add original query to the beginning
    }

    console.log("Generated Multi-Queries:", queries);
    return queries;

  } catch (error) {
    console.error("Error generating multi-queries:", error);
    // Fallback: Return only the original query if something goes wrong
    return [userMessage];
  }
}


const schoolData = {
  name: "Kwun Tong Maryknoll College",
  description: "Kwun Tong Maryknoll College is the third secondary school opened in Hong Kong by the Maryknoll Fathers, a society of Catholic priests and brothers founded in the United States in 1911. At that time there were only two 'Maryknollers' - Father James A.Walsh and Father Frederick Price. They came together to start a missionary work which has since grown into a society of over a thousand priests, brothers and students dedicated to bringing the knowledge and love of God to the people of 18 countries around the world",
  established_year: "1971",
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
    const userMessage = messages[messages.length - 1].content; // Get the latest user message

    // 1. Generate multiple query variations from the user's message
    const queryVariations = await generateMultiQueries(userMessage);

    const allRetrievedContexts = new Set(); // Use a Set to store unique contexts

    // 2. Retrieve context for each query variation
    for (const query of queryVariations) {
      console.log(`Performing vector search for query variation: "${query}"`);
      // Use a slightly higher topK here to ensure broader retrieval for each variation
      // This topK is for each individual sub-query.
      const currentRetrievedContextsArray = await retrieveContext(query, 10); // topK increased to 10 for multi-query
      currentRetrievedContextsArray.forEach(context => allRetrievedContexts.add(context));
    }

    // 3. Join all unique retrieved contexts into a single string for the AI prompt
    const retrievedContextString = Array.from(allRetrievedContexts).join('\n\n');

    console.log("Combined Retrieved Context for AI:\n", retrievedContextString);

    // 4. Prepare a string version of basic schoolData to always include in the prompt
    const basicSchoolInfoString = `
School Name: ${schoolData.name}
Established Year: ${schoolData.established_year}
School Description: ${schoolData.description}
Contacts:
  Phone: ${schoolData.contacts.phone}
  Email: ${schoolData.contacts.email}
  Address: ${schoolData.contacts.address}
Programs: ${schoolData.programs.join(', ')}
`;

    // 5. Define the main system content with strict instructions
    let systemContent = `You are a helpful, friendly, and approachable AI assistant for Kwun Tong Maryknoll College.

        **Your Primary Goal:**
        To provide accurate and relevant information EXCLUSIVELY about Kwun Tong Maryknoll College.

        **Audience Context:**
        - Most users will be current students, parents of current students, or prospective parents interested in enrolling their child.
        - Occasionally, the user might be a staff member.
        - Tailor your language to be clear, respectful, and easily understood by all these groups.

        **Information Hierarchy & Strict Adherence Rules:**
        1.  **PRIORITIZE** answers from the "Relevant Information from Knowledge Base" (from RAG context) if directly available.
        2.  If not found in RAG context, then check the "Basic School Information" provided.
        3.  **STRICTLY ADHERE:** You MUST only use details explicitly stated in EITHER the "Basic School Information" or the "Relevant Information from Knowledge Base."
        4.  **Do NOT** include any information from your general knowledge base or invent, assume, or infer any details.
        5.  **Do NOT** provide contact details (like emails or phone numbers) unless they are explicitly present in the provided context.
        6.  **Do NOT** mention the source where you retrieved information from tables (e.g., "from school_info table" or current records). The user does not need to know this internal detail.

        **Handling Unanswerable or Out-of-Scope Questions:**
        - If the answer is still not found in *either* the "Relevant Information from Knowledge Base" or the "Basic School Information",
        - OR if the question is not about Kwun Tong Maryknoll College,
        - You MUST politely respond with the following **exact phrase and nothing more**:
            "I apologize, but I don't have enough information to answer that question. Please contact Kwun Tong Maryknoll College directly for more details. \n
            Let me know if you have any other questions 😊"
        - **DO NOT add any further notes, explanations, or additional sentences after this specific response. Only include notes if it is super super super important**

        **Tone and Style:**
        - Adopt a natural, friendly, and conversational tone, suitable for interacting with students, parents, and staff.
        - You may use one or two relevant and subtle emojis (like 😊, 👍, 📚, 🏫) in your responses to make them more engaging, but **do not overuse them**.

        Basic School Information:
        ${basicSchoolInfoString}
        `;

    // 6. Append the dynamically retrieved context if it exists
    if (retrievedContextString) {
      systemContent += `\n\nRelevant Information from Knowledge Base:\n${retrievedContextString}`;
    }

    // 7. Create the final systemMessage object using the constructed systemContent
    const systemMessage = {
      role: "system",
      content: systemContent,
    };

    // 8. Construct the full messages array to send to the AI
    const fullMessages = [systemMessage, ...messages]; // `messages` here is from req.body

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