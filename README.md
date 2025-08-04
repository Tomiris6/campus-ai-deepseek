
# Campus AI Assistant

To start working:
1. ## Install it first: Download Node.js (v18+)
2. 
```bash
git clone https://github.com/Tomiris6/campus-ai-deepseek.git
cd campus-ai-deepseek
npm install
echo "DEEPSEEK_API_KEY=your_key_here" > .env
node server.js
```
3. ##
Open in browser: [http://localhost:3000](http://localhost:3000)

## Project Structure

| File/Folder         | Description                      |
| ------------------- | -------------------------------- |
| `public/index.html` | Main HTML interface (frontend)   |
| `public/script.js`  | Chat logic and frontend JS       |
| `server.js`         | Node.js backend API server       |
| `package.json`      | Project dependencies and scripts |

4. ## Database Setup
  Before running any scraping or application scripts, please initialize your PostgreSQL database by following these steps:
  
  1. Ensure your PostgreSQL installation is up and running.
  2. Open your PostgreSQL query tool
  3. Create the database

```SQL
CREATE DATABASE AI_Chatbot
```
  4. Modify your .env file so that the DB_NAME entry matches AI_Chatbot.

  5. Load and execute the full AI_CB_schema.sql script in the PostgreSQL Query Tool. This will set up all required tables and indexes for your project.



5. ## Ollama Setup (Required for Embeddings)

This project uses Ollama to generate vector embeddings using the bge-large model, enabling semantic search and retrieval.

Setup Steps:

### 1. Install Ollama
  Download and install Ollama for your OS:  
  https://ollama.com/download

### 2. Start Ollama
  Open a terminal or command prompt, then run:
  
  ```bash
  ollama serve
  ```

Confirm the server is running by visiting http://localhost:11434 in your web browser.

### 3. Download the Embedding Model
In a separate terminal, pull (download) the embedding model:

```bash
ollama pull bge-large
```

### 4. embed_data.js
Run the embedding script before starting your app to populate the vector database:

```bash
node embed_data.js
```

### 5. server.js
Finally, start the application server:

```bash
node server.js
```


## Notes

* Keep your `.env` file **secret** – do not share it or commit it to Git.
* Requires a valid **DeepSeek API key**. You can use [OpenRouter's free DeepSeek R1 70B model](https://openrouter.ai/).
  |_ Please name the API key as API_KEY to avoid errors when running the server.js
* Default server runs on **port 3000** – you can change this in `server.js`.

