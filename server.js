// server.js

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { queryKnowledgeBase, countTokens } = require('./query_knowledge_base');
const { Pool } = require('pg');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT, 10),
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('Error acquiring client for database connection test', err.stack);
    return;
  }
  client.query('SELECT NOW()', (err, result) => {
    release();
    if (err) {
      console.error('Error executing test query on database', err.stack);
      return;
    }
    console.log('Database connected successfully at:', result.rows[0].now);
  });
});

const schoolData = {
  name: "Kwun Tong Maryknoll College",
  description:
    "Kwun Tong Maryknoll College is the third secondary school opened in Hong Kong by the Maryknoll Fathers, a society of Catholic priests and brothers founded in 1911. At that time there were only two 'Maryknollers' - Father James A.Walsh and Father Frederick Price. They came together to start a missionary work which has since grown into a society of over a thousand priests, brothers and students dedicated to bringing the knowledge and love of God to the people of 18 countries around the world.",
  established_year: "1971",
  contacts: {
    phone: "(852)2717 1485",
    email: "ktmc@ktmc.edu.hk",
    address: "100 Tsui Ping Road, Kwun Tong, Kowloon, Hong Kong",
  },
  programs: ["Science", "Arts", "Languages"],
};

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

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  timeout: 60000,
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/api/school-info', (req, res) => {
  res.json(schoolData);
});

app.post('/api/chat', async (req, res) => {
  console.time('Total Chat Request Processing');

  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'No messages provided.' });
    }
    const userMessage = messages[messages.length - 1].content;

    console.time('Context Retrieval');
    const retrievedContextString = await queryKnowledgeBase(userMessage);
    console.timeEnd('Context Retrieval');

    let systemContent = `
You are a helpful, warm, and engaging AI assistant, speaking as the virtual campus guide for Kwun Tong Maryknoll College. 
You will soon have your answers read aloud by a digital avatar, so everything you say should sound naturally spoken.

**Primary Instructions for Speech Output:**

- Speak clearly and naturally, as if having a friendly, real-time chat with a guest.
- Feel free to use gentle interjections like "Of course," or "That's a great question," to sound personable.
- Use a warm, conversational, engaging tone suited for spoken interaction.
- Keep sentences concise and easy to follow.
- Use natural phrasing with slight pauses or conversational connectors.
- Do NOT mention written text, visuals, or formatting.
- Instead of emojis or symbols, describe feelings or expressions, e.g., "smiling warmly" or "cheerfully".
- Avoid jargon or overly formal language.
- Provide accurate, relevant information ONLY about Kwun Tong Maryknoll College.

**Audience Context:**

- Most users are students, parents, prospective students, or staff.
- Use clear, respectful language familiar to these groups.

**Information Hierarchy & Rules:**  
1. Use information from "Relevant Information from Knowledge Base" first if available.  
2. Otherwise, use details from the "Basic School Information" below.  
3. Only share explicitly stated information — do NOT speculate or invent answers.  
4. Provide contact details (phone, email, address) only if present.

**If you do NOT know the answer or it is out of scope, reply EXACTLY:**  
"I apologize, but I don't have enough information to answer that question. Please contact Kwun Tong Maryknoll College directly for more details.  
Let me know if you have any other questions."

---
Basic School Information:  
${basicSchoolInfoString}
`;

    if (retrievedContextString && retrievedContextString.trim().length > 0) {
      systemContent += `\n---\nRelevant Information from Knowledge Base:\n${retrievedContextString}\n`;
    }

    const systemMessage = {
      role: 'system',
      content: systemContent,
    };
    const fullMessages = [systemMessage, ...messages];

    console.log(`Sending ${fullMessages.length} messages to LLM.`);

    const promptTokenCount = countTokens(systemContent);
    console.log(`Approximate prompt tokens: ${promptTokenCount}`);

    console.time('LLM Response Generation');
    const response = await openai.chat.completions.create({
      model: 'deepseek/deepseek-r1-distill-llama-70b:free',
      messages: fullMessages,
      temperature: 0.3,
      max_tokens: 1000,
    });
    console.timeEnd('LLM Response Generation');

    const assistantResponse = response.choices[0].message.content;
    res.json({ response: assistantResponse });
  } catch (error) {
    console.error('Error in /api/chat route:', error.stack || error);
    res.status(500).json({ error: 'Error processing request' });
  } finally {
    console.timeEnd('Total Chat Request Processing');
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on http://localhost:${process.env.PORT || 3000}`);
});
