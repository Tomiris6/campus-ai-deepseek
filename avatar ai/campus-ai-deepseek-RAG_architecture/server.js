// server.js

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { queryKnowledgeBase, countTokens } = require('./query_knowledge_base_local');
const { Pool } = require('pg');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 5000;

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
    const { messages, voiceMode } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'No messages provided.' });
    }
    const userMessage = messages[messages.length - 1].content;

    // For voice mode, use optimized database processing
    if (voiceMode) {
      console.time('Voice Mode Processing');
      
      // Use faster, targeted database query for voice
      console.time('Voice Context Retrieval');
      const retrievedContextString = await queryKnowledgeBase(userMessage, true); // Add voice mode flag
      console.timeEnd('Voice Context Retrieval');
      
      // Enhanced system prompt for voice responses with full capabilities
      let voiceSystemContent = `
You are a helpful, warm, and engaging AI assistant, speaking as the virtual campus guide for Kwun Tong Maryknoll College. 
You will have your answers read aloud by a digital avatar, so everything you say should sound naturally spoken.

**Primary Instructions for Speech Output:**
- Speak clearly and naturally, as if having a friendly, real-time chat with a guest.
- Feel free to use gentle interjections like "Of course," or "That's a great question," to sound personable.
- Use a warm, conversational, engaging tone suited for spoken interaction.
- Keep sentences concise and easy to follow, but provide comprehensive information.
- Use natural phrasing with slight pauses or conversational connectors.
- Do NOT mention written text, visuals, or formatting.
- Instead of emojis or symbols, describe feelings or expressions, e.g., "smiling warmly" or "cheerfully".
- Avoid jargon or overly formal language.
- Provide accurate, relevant information ONLY about Kwun Tong Maryknoll College.

**Information Hierarchy & Rules:**  
1. Use information from "Relevant Information from Knowledge Base" first if available.  
2. Otherwise, use details from the "Basic School Information" below.  
3. Only share explicitly stated information — do NOT speculate or invent answers.  
4. Provide contact details (phone, email, address) only if present.

**If you do NOT know the answer or it is out of scope, reply EXACTLY:**  
"I apologize, but I don't have enough information to answer that question. Please contact Kwun Tong Maryknoll College directly for more details. Let me know if you have any other questions."

---
Basic School Information:  
${basicSchoolInfoString}

---
Relevant Information from Knowledge Base:
${retrievedContextString}
`;

      const voiceMessages = [
        { role: 'system', content: voiceSystemContent },
        ...messages  // Include full conversation history
      ];

      console.time('Voice LLM Response');
      const voiceResponse = await openai.chat.completions.create({
        model: 'deepseek/deepseek-r1-distill-llama-70b:free',
        messages: voiceMessages,
        temperature: 0.3,
        max_tokens: 800, // Increased for more comprehensive responses
        stream: false
      });
      console.timeEnd('Voice LLM Response');
      
      const responseText = voiceResponse.choices[0].message.content;
      console.timeEnd('Voice Mode Processing');
      console.timeEnd('Total Chat Request Processing');
      return res.json({ response: responseText });
    }

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
      max_tokens: 4000,
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

// Voice Agent Integration Endpoints
const { spawn } = require('child_process');
const path = require('path');

// Global voice agent state
let voiceAgentProcess = null;
let voiceAgentStatus = {
  isRunning: false,
  userSpeech: '',
  agentResponse: '',
  status: 'Not connected'
};

// Start Azure Voice Live Agent
app.post('/api/start-voice-agent', async (req, res) => {
  try {
    if (voiceAgentProcess && !voiceAgentProcess.killed) {
      console.log('Voice agent already running, returning existing process');
      return res.json({ success: true, message: 'Voice agent already running' });
    }
    
    // Reset any existing process
    if (voiceAgentProcess) {
      try {
        voiceAgentProcess.kill();
      } catch (e) {
        console.log('Error killing previous voice agent process:', e);
      }
      voiceAgentProcess = null;
    }

    console.log('🎤 Starting Azure Voice Live Agent...');
    
    // Path to the Python voice agent script - corrected paths
    const voiceAgentPath = path.join(__dirname, '..', 'live-agent', 'simple_voice_agent.py');
    const venvPythonPath = path.join(__dirname, '..', 'live-agent', '.venv', 'bin', 'python');
    
    // Check if files exist
    const fs = require('fs');
    if (!fs.existsSync(voiceAgentPath)) {
      console.error(`❌ Voice agent file not found at: ${voiceAgentPath}`);
      return res.status(500).json({ success: false, error: 'Voice agent script not found' });
    }

    // Check if venv exists
    if (!fs.existsSync(venvPythonPath)) {
      console.log(`⚠️ Python venv not found at ${venvPythonPath}, falling back to system python`);
      // Fall back to system python
      voiceAgentProcess = spawn('python3', [voiceAgentPath], {
        cwd: path.dirname(voiceAgentPath),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });
    } else {
      // Start the Python voice agent process with venv
      console.log(`🐍 Using Python from venv: ${venvPythonPath}`);
      voiceAgentProcess = spawn(venvPythonPath, [voiceAgentPath], {
        cwd: path.dirname(voiceAgentPath),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });
    }

    // Handle process output
    voiceAgentProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('Voice Agent Output:', output);
      
      // Parse conversation updates
      if (output.includes('User:')) {
        const userMatch = output.match(/User: (.+)/);
        if (userMatch) {
          voiceAgentStatus.userSpeech = userMatch[1].trim();
        }
      }
      
      if (output.includes('Assistant:')) {
        const assistantMatch = output.match(/Assistant: (.+)/);
        if (assistantMatch) {
          voiceAgentStatus.agentResponse = assistantMatch[1].trim();
        }
      }
      
      // Update status
      if (output.includes('✅ Voice Agent Ready!')) {
        voiceAgentStatus.status = 'Voice agent ready';
        voiceAgentStatus.isRunning = true;
      } else if (output.includes('� Listening...')) {
        voiceAgentStatus.status = 'Listening...';
      }
    });

    voiceAgentProcess.stderr.on('data', (data) => {
      console.error('Voice Agent Error:', data.toString());
    });

    voiceAgentProcess.on('close', (code) => {
      console.log(`Voice agent process exited with code ${code}`);
      voiceAgentProcess = null;
      voiceAgentStatus.isRunning = false;
      voiceAgentStatus.status = 'Disconnected';
    });

    // Give the process time to start
    setTimeout(() => {
      if (voiceAgentProcess && !voiceAgentProcess.killed) {
        res.json({ success: true, message: 'Voice agent started successfully' });
      } else {
        res.status(500).json({ success: false, error: 'Failed to start voice agent' });
      }
    }, 2000);

  } catch (error) {
    console.error('Error starting voice agent:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Voice session management
app.post('/api/voice-session', async (req, res) => {
  try {
    const { action } = req.body || {};
    const sessionAction = action || 'connect';
    console.log(`Voice session action requested: ${sessionAction}`);
    
    if (sessionAction === 'connect') {
      // Auto-start voice agent if not running
      if (!voiceAgentProcess || voiceAgentProcess.killed) {
        console.log('Voice agent not running, auto-starting...');
        
        // Path to the Python voice agent script - corrected paths
        const voiceAgentPath = path.join(__dirname, '..', 'live-agent', 'simple_voice_agent.py');
        const venvPythonPath = path.join(__dirname, '..', 'live-agent', '.venv', 'bin', 'python');
        
        // Check if files exist
        const fs = require('fs');
        if (!fs.existsSync(voiceAgentPath)) {
          console.error(`❌ Voice agent file not found at: ${voiceAgentPath}`);
          return res.status(400).json({ success: false, error: 'Voice agent script not found' });
        }

        // Start with system Python if venv not available
        if (!fs.existsSync(venvPythonPath)) {
          const systemPython = '/opt/homebrew/bin/python3';
          console.log(`⚠️ Python venv not found, using system python3 at ${systemPython}`);
          voiceAgentProcess = spawn(systemPython, [voiceAgentPath], {
            cwd: path.dirname(voiceAgentPath),
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env }
          });
        } else {
          console.log(`🐍 Using Python from venv: ${venvPythonPath}`);
          voiceAgentProcess = spawn(venvPythonPath, [voiceAgentPath], {
            cwd: path.dirname(voiceAgentPath),
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env }
          });
        }
        
        // Set up process handlers
        voiceAgentProcess.stdout.on('data', (data) => {
          const output = data.toString();
          console.log('Voice Agent Output:', output);
          
          // Parse conversation updates
          if (output.includes('User:')) {
            const userMatch = output.match(/User: (.+)/);
            if (userMatch) {
              voiceAgentStatus.userSpeech = userMatch[1].trim();
            }
          }
          
          if (output.includes('Assistant:')) {
            const assistantMatch = output.match(/Assistant: (.+)/);
            if (assistantMatch) {
              voiceAgentStatus.agentResponse = assistantMatch[1].trim();
            }
          }
          
          // Update status
          if (output.includes('✅ Voice Agent Ready!')) {
            voiceAgentStatus.status = 'Voice agent ready';
            voiceAgentStatus.isRunning = true;
          } else if (output.includes('� Listening...')) {
            voiceAgentStatus.status = 'Listening...';
          }
        });
        
        voiceAgentProcess.stderr.on('data', (data) => {
          console.error('Voice Agent Error:', data.toString());
        });
        
        voiceAgentProcess.on('close', (code) => {
          console.log(`Voice agent process exited with code ${code}`);
          voiceAgentProcess = null;
          voiceAgentStatus.isRunning = false;
          voiceAgentStatus.status = 'Disconnected';
        });
        
        // Give time for the process to start
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      if (!voiceAgentProcess || voiceAgentProcess.killed) {
        return res.status(500).json({ success: false, error: 'Failed to start voice agent' });
      }
      
      voiceAgentStatus.status = 'Connected - ready to listen';
      voiceAgentStatus.isRunning = true;
      res.json({ success: true, message: 'Voice session connected' });
      
    } else if (sessionAction === 'disconnect') {
      if (voiceAgentProcess && !voiceAgentProcess.killed) {
        try {
          console.log('Sending quit command to voice agent');
          voiceAgentProcess.stdin.write('quit\n');
        } catch (e) {
          console.error('Error sending quit command:', e);
        }
        
        setTimeout(() => {
          if (voiceAgentProcess && !voiceAgentProcess.killed) {
            console.log('Forcefully killing voice agent process');
            try {
              voiceAgentProcess.kill('SIGKILL');
            } catch (e) {
              console.error('Error killing process:', e);
            }
          }
        }, 1000);
      } else {
        console.log('No voice agent process to disconnect');
      }
      
      voiceAgentStatus.status = 'Disconnected';
      voiceAgentStatus.userSpeech = '';
      voiceAgentStatus.agentResponse = '';
      voiceAgentStatus.isRunning = false;
      res.json({ success: true, message: 'Voice session disconnected' });
      
    } else {
      res.status(400).json({ success: false, error: `Unknown action: ${sessionAction}` });
    }
    
  } catch (error) {
    console.error('Error managing voice session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get voice conversation status
app.get('/api/voice-status', (req, res) => {
  // Check if process is actually running
  if (voiceAgentProcess && voiceAgentProcess.killed === false) {
    voiceAgentStatus.isRunning = true;
  } else {
    voiceAgentStatus.isRunning = false;
    voiceAgentStatus.status = 'Voice agent not running';
  }
  
  res.json(voiceAgentStatus);
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on http://localhost:${process.env.PORT || 3000}`);
});
