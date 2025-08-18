# Campus AI Assistant - RAG Architecture
> **Branch:** `RAG_architecture`  
> **Implementation:** Retrieval-Augmented Generation (RAG) system with user tracking for campus information queries

## 🚀 Overview
This branch implements a complete RAG (Retrieval-Augmented Generation) architecture for the Campus AI Digital Human Project. The system combines web scraping, vector embeddings, and intelligent query processing to provide accurate, context-aware responses.

**New in this version:** A robust user and session tracking system has been integrated to log all chat interactions, enabling detailed debugging and user-specific issue analysis.

## 🏗️ RAG Architecture Components

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Data Source   │───▶│   Web Scraping   │───▶│  Data Storage  │
│  (Website)      │    │  (Selenium +     │    │ (PostgreSQL +   │
│                 │    │   BeautifulSoup) │    │   pgvector)     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
┌─────────────────┐    ┌───────────────────┐    ┌─────────────────┐
│   AI Response   │◀───│ Context Retrieval│◀── │   Embeddings    │
│   Generation    │    │   (Vector Search) │    │   (BGE-Large)   │
│  (DeepSeek R1)  │    │                   │    │                 │
└─────────────────┘    └───────────────────┘    └─────────────────┘
      │
      └─────────────────────────────────▶┌─────────────────┐
                                          │  Interaction    │
                                          │    Logging      │
                                          │ (chat_history)  │
                                          └─────────────────┘
```


## 📁 Project Structure
```
RAG_architecture/
├── 📋 Campus-AI-Digital-Human-Project.pdf    # Project documentation
├── 🗄️ AI_CB_schema.sql                       # Full PostgreSQL schema with all tables
├── 🔧 embed_data.js                          # Embedding generation script
├── 📦 package.json                           # Dependencies and scripts
├── 🧠 query_knowledge_base.js                # RAG query processing engine
├── 🖥️ server.js                              # Main API server with RAG and logging
├── 🕷️ webscraper_code.py                     # Advanced web scraping script
├── 🌐 index.html                             # Frontend interface for the chatbot
└── ⚡ user-tracking.js                      # NEW: Frontend script for user/session ID generation
```



## 🛠️ Quick Start
### Prerequisites
1. **Node.js** (v18+)
2. **Python** (3.8+)
3. **PostgreSQL** with `pgvector` extension
4. **Ollama** for local embeddings
5. **Chrome/Chromium** for web scraping

### Installation Steps
1.  **Clone and Setup**
    ```
    git clone https://github.com/Tomiris6/campus-ai-deepseek.git
    cd campus-ai-deepseek
    git checkout RAG_architecture
    npm install
    pip install -r requirements.txt  # For Python dependencies
    ```
2.  **Environment Configuration**
    Create a `.env` file in the root directory and populate it with your credentials:
    ```
    # API Configuration
    API_KEY=your_openrouter_api_key_here

    # Database Configuration  
    DB_HOST=localhost
    DB_NAME=AI_Chatbot
    DB_USER=your_postgres_username
    DB_PASSWORD=your_postgres_password
    DB_PORT=5432

    # Scraping Configuration
    START_URL=https://www.ktmc.edu.hk/
    # ... other scraping variables

    # Ollama Configuration
    OLLAMA_API_URL=http://localhost:11434
    OLLAMA_EMBEDDING_MODEL=bge-large
    ```
3.  **Database Setup**
    ```
    -- In your PostgreSQL client (e.g., psql)
    CREATE DATABASE AI_Chatbot;
    ```
    ```
    # Connect to your new database and run the schema file
    # This will create all three tables: pages, knowledge_base, and chat_history
    psql -U your_username -d AI_Chatbot -f AI_CB_schema.sql
    ```
4.  **Ollama Setup**
    ```
    # Install Ollama from https://ollama.com/download
    ollama serve
    # In another terminal, pull the required model
    ollama pull bge-large
    ```
5.  **Data Collection & Processing**
    ```
    # Step 1: Scrape website data into the 'pages' table
    python webscraper_code.py
    
    # Step 2: Generate embeddings and populate the 'knowledge_base' table
    node embed_data.js
    
    # Step 3: Start the server
    node server.js
    ```
6.  **Access Application**
    Open your browser and navigate to: `http://localhost:3000`

## 🔧 Core Components
### 1. **Web Scraper** (`webscraper_code.py`)
- **Technology:** Selenium + BeautifulSoup
- **Features:** Robust, JavaScript-enabled crawling with error handling and data storage in PostgreSQL.

### 2. **Embedding Engine** (`embed_data.js`)
- **Model:** BGE-Large via Ollama
- **Features:** Efficiently converts scraped text into vector embeddings for semantic search.

### 3. **RAG Query Processor** (`query_knowledge_base.js`)
- **Intelligence:** Decomposes complex user questions into sub-queries for more accurate context retrieval.
- **Features:** Semantic caching, vector similarity search, and context optimization.

### 4. **API Server** (`server.js`)
- **Integration:** DeepSeek R1 + RAG Context
- **Features:** Handles real-time chat requests, integrates retrieved context into AI prompts, and **logs every user interaction to the database for debugging**.

### 5. **User Tracking** (`user-tracking.js`)
- **Functionality:** A non-intrusive frontend script that generates a persistent `user_id` and a per-visit `session_id`.
- **Integration:** Automatically injects these IDs into all chat API requests.

## 📊 Database Schema

### **`pages` Table**
Stores the raw content scraped from each webpage.

```sql
CREATE TABLE pages (
id SERIAL PRIMARY KEY,
url TEXT NOT NULL UNIQUE,
-- ... other columns
);
```

### **`knowledge_base` Table**
Stores the smaller text chunks and their corresponding vector embeddings.

```sql
CREATE TABLE knowledge_base (
id SERIAL PRIMARY KEY,
content_text TEXT,
embedding VECTOR(1536), -- pgvector extension
-- ... other columns
);
```

### **`chat_history` Table (NEW)**
Logs every user interaction for debugging and analysis.

```sql
CREATE TABLE chat_history (
id SERIAL PRIMARY KEY,
user_id TEXT NOT NULL,
session_id TEXT NOT NULL,
user_message TEXT,
assistant_response TEXT,
retrieved_context TEXT,
final_prompt TEXT,
latency_ms INTEGER,
status TEXT, -- 'success' or 'error'
error_message TEXT,
created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

### **Browser Console**
Open the developer tools (F12) in your browser to see the `user_id` and `session_id` being logged by `user-tracking.js`.


-- Check the number of scraped pages
SELECT COUNT(*) FROM pages;
-- See how many embedding chunks were created
SELECT COUNT(*) FROM knowledge_base;
-- NEW: View the most recent chat interactions for a specific user
SELECT created_at, user_message, status, latency_ms, error_message
FROM chat_history
WHERE user_id = 'user_xxxxxxxx_xxxx'
ORDER BY created_at DESC;
WHERE user_id = 'user_xxxxxxxx_xxxx'
ORDER BY created_at DESC;
