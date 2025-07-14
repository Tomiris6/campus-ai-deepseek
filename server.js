const express = require('express');
const cors = require('cors');
const OpenAI = require('openai'); 

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const openai = new OpenAI({
  apiKey: "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",
  baseURL: 'https://api.deepseek.com/v1'
});

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

    const systemMessage = {
      role: "system",
      content: `You are the assistant at Kwun Tong Maryknoll College. Answer only questions about the school.
    
    School information:
    - Name: ${schoolData.name}
    - Description: ${schoolData.description}
    - Contacts: Phone ${schoolData.contacts.phone}, email ${schoolData.contacts.email}
    
    If the question is not about the school, respond: "I can only answer questions about Kwun Tong Maryknoll College."`
    };

    // Use the messages array directly from frontend (it already contains the full conversation history)
    const fullMessages = [systemMessage, ...messages];

    console.log("Sending messages to AI:", fullMessages.length, "messages");

    const response = await openai.chat.completions.create({
      model: 'deepseek-chat',
      messages: fullMessages, 
      temperature: 0.3,
      max_tokens: 500
    });

    const assistantResponse = response.choices[0].message.content;

    res.json({ response: assistantResponse });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: "Error processing request" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});