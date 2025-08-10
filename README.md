# Campus AI Assistant - RAG Architecture

> **Branch:** `RAG_architecture`  
> **Implementation:** Retrieval-Augmented Generation (RAG) system for campus information queries

## 🚀 Overview

This branch implements a complete RAG (Retrieval-Augmented Generation) architecture for the Campus AI Digital Human Project. The system combines web scraping, vector embeddings, and intelligent query processing to provide accurate, context-aware responses about school information.

## 🏗️ RAG Architecture Components

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Data Source   │───▶│   Web Scraping   │───▶│  Data Storage   │
│  (Website)      │    │  (Selenium +     │    │ (PostgreSQL +   │
│                 │    │   BeautifulSoup) │    │   pgvector)     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   AI Response   │◀───│ Context Retrieval │◀───│   Embeddings    │
│   Generation    │    │   (Vector Search) │    │   (BGE-Large)   │
│  (DeepSeek R1)  │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 📁 Project Structure

```
RAG_architecture/
├── 📋 Campus-AI-Digital-Human-Project.pdf    # Project documentation
├── 🗄️ AI_CB_schema.sql                       # PostgreSQL schema with vector extension
├── 🔧 embed_data.js                          # Embedding generation script
├── 📦 package.json                           # Dependencies and scripts
├── 🧠 query_knowledge_base.js                # RAG query processing engine
├── 📊 scraped_data_with_tags.json            # Sample scraped data
├── 🖥️ server.js                              # Main API server with RAG integration
├── 🕷️ webscraper_code.py                     # Advanced web scraping script
├── 🌐 index.html                             # Frontend interface
└── ⚡ script.js                              # Frontend JavaScript
```

## 🛠️ Quick Start

### Prerequisites

1. **Node.js** (v18+)
2. **Python** (3.8+) 
3. **PostgreSQL** with pgvector extension
4. **Ollama** for embeddings
5. **Chrome/Chromium** for web scraping

### Installation Steps

1. **Clone and Setup**
   ```bash
   git clone https://github.com/Tomiris6/campus-ai-deepseek.git
   cd campus-ai-deepseek
   git checkout RAG_architecture
   npm install
   pip install -r requirements.txt  # For Python dependencies
   ```

2. **Environment Configuration**
   ```bash
   # Create .env file with the following variables:
   echo "# API Configuration
   API_KEY=your_openrouter_api_key_here

   # Database Configuration  
   DB_HOST=localhost
   DB_NAME=AI_Chatbot
   DB_USER=your_postgres_username
   DB_PASSWORD=your_postgres_password
   DB_PORT=5432

   # Scraping Configuration
   START_URL=https://www.ktmc.edu.hk/
   MAX_DEPTH=2
   MIN_DELAY_BETWEEN_PAGES=0.5
   MAX_DELAY_BETWEEN_PAGES=1.5
   ENABLE_JAVASCRIPT=true
   PAGE_LIMIT=0

   # Ollama Configuration
   OLLAMA_API_URL=http://localhost:11434
   OLLAMA_EMBEDDING_MODEL=bge-large" > .env
   ```

3. **Database Setup**
   ```sql
   -- In PostgreSQL, create the database
   CREATE DATABASE AI_Chatbot;
   ```
   
   ```bash
   # Load the schema
   psql -U your_username -d AI_Chatbot -f AI_CB_schema.sql
   ```

4. **Ollama Setup**
   ```bash
   # Install Ollama from https://ollama.com/download
   # Start Ollama server
   ollama serve
   
   # In another terminal, pull the embedding model
   ollama pull bge-large
   ```

5. **Data Collection & Processing**
   ```bash
   # Step 1: Scrape website data
   python webscraper_code.py
   
   # Step 2: Generate embeddings
   node embed_data.js
   
   # Step 3: Start the server
   node server.js
   ```

6. **Access Application**
   Open your browser and go to: `http://localhost:3000`

## 🔧 Core Components

### 1. **Web Scraper** (`webscraper_code.py`)
- **Technology:** Selenium + BeautifulSoup + PostgreSQL
- **Features:**
  - JavaScript-enabled scraping
  - Retry logic with exponential backoff
  - Memory management and driver recycling
  - Depth-limited crawling
  - Content extraction (title, headers, meta tags)

### 2. **Embedding Engine** (`embed_data.js`)
- **Model:** BGE-Large via Ollama
- **Features:**
  - Batch processing of scraped content
  - Token counting and optimization
  - Error handling and retry logic
  - Vector storage in PostgreSQL

### 3. **RAG Query Processor** (`query_knowledge_base.js`)
- **Intelligence:** Multi-query generation
- **Features:**
  - Complex query decomposition
  - Vector similarity search
  - Context chunking with token limits
  - Caching for performance
  - Semantic retrieval ranking

### 4. **API Server** (`server.js`)
- **Integration:** DeepSeek R1 + RAG Context
- **Features:**
  - Real-time chat API
  - Context-aware responses
  - Token management
  - Error handling and logging

## 🎯 RAG Features

### **Intelligent Query Processing**
```javascript
// Multi-query generation for complex questions
"What is the mission of the school and what activities are available?"
// Automatically splits into:
// 1. "What is the mission of the school?"
// 2. "What extracurricular activities are available?"
```

### **Vector Search & Ranking**
- Cosine similarity search using pgvector
- Top-K retrieval with relevance scoring
- Context deduplication and optimization

### **Token-Aware Context Management**
```javascript
const MAX_CONTEXT_TOKENS = 8000;
const RESERVED_TOKENS = 3000;
// Intelligent chunking within token limits
```

### **Caching & Performance**
- In-memory query caching
- Connection pooling
- Batch processing optimizations

## 📊 Database Schema

### **Pages Table**
```sql
CREATE TABLE pages (
    url TEXT PRIMARY KEY,
    scraped_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    title TEXT,
    content TEXT,
    h1_tags TEXT,
    h2_tags TEXT,
    h3_tags TEXT,
    meta_description TEXT,
    meta_keywords TEXT,
    page_depth INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'success'
);
```

### **Knowledge Base Table**
```sql
CREATE TABLE knowledge_base (
    id SERIAL PRIMARY KEY,
    content_text TEXT,
    source_url TEXT,
    source_table TEXT,
    source_id TEXT,
    embedding VECTOR(1536),  -- pgvector extension
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

## 🚀 Usage Examples

### **Basic Chat Query**
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "What are the school facilities?"}
    ]
  }'
```

### **Running Components Separately**

```bash
# 1. Scrape new data
python webscraper_code.py

# 2. Generate embeddings
node embed_data.js

# 3. Test query processing
node -e "
const { queryKnowledgeBase } = require('./query_knowledge_base');
queryKnowledgeBase('Tell me about the school history').then(console.log);
"

# 4. Start full server
node server.js
```

## ⚙️ Configuration Options

### **Scraping Configuration**
```env
START_URL=https://www.ktmc.edu.hk/        # Starting point
MAX_DEPTH=2                               # Crawl depth limit
MIN_DELAY_BETWEEN_PAGES=0.5              # Politeness delay (min)
MAX_DELAY_BETWEEN_PAGES=1.5              # Politeness delay (max)
ENABLE_JAVASCRIPT=true                    # Enable JS rendering
PAGE_LIMIT=0                             # 0 = unlimited
DRIVER_RESTART_INTERVAL=50               # Memory management
MAX_RETRIES=3                            # Error resilience
```

### **RAG Configuration**
```env
OLLAMA_API_URL=http://localhost:11434     # Ollama server
OLLAMA_EMBEDDING_MODEL=bge-large          # Embedding model
VERBOSE=true                             # Detailed logging
```

## 🔍 Monitoring & Debugging

### **Enable Verbose Logging**
```javascript
// In embed_data.js and query_knowledge_base.js
const VERBOSE = true;
```

### **Database Queries**
```sql
-- Check scraped pages
SELECT COUNT(*) FROM pages;

-- Check embeddings
SELECT COUNT(*) FROM knowledge_base;

-- Sample vector search
SELECT content_text, embedding <-> '[0.1, 0.2, ...]'::vector AS distance 
FROM knowledge_base 
ORDER BY distance 
LIMIT 5;
```

### **Performance Metrics**
- Query processing time: ~2-5 seconds
- Embedding generation: ~100ms per chunk
- Vector search: ~50-200ms
- Memory usage: ~500MB (with driver restarts)

## 🤖 AI Models Used

| Component | Model | Purpose |
|-----------|-------|---------|
| **Embeddings** | BGE-Large (1536d) | Semantic vector generation |
| **Query Decomposition** | DeepSeek Chat V3 | Complex query breaking |
| **Response Generation** | DeepSeek R1 Distill 70B | Final answer synthesis |

## 🔒 Security & Best Practices

- ✅ API key stored in environment variables
- ✅ SQL injection prevention with parameterized queries
- ✅ Rate limiting and error handling
- ✅ Input validation and sanitization
- ✅ Connection pooling and resource management

## 🐛 Troubleshooting

### **Common Issues**

1. **Ollama Connection Error**
   ```bash
   # Ensure Ollama is running
   ollama serve
   # Check if model exists
   ollama list
   ```

2. **Database Connection Failed**
   ```bash
   # Test PostgreSQL connection
   psql -U your_username -d AI_Chatbot -c "SELECT 1;"
   ```

3. **Scraper Chrome Driver Issues**
   ```python
   # Update ChromeDriver
   pip install --upgrade webdriver-manager
   ```

4. **Empty Vector Results**
   ```bash
   # Regenerate embeddings
   node embed_data.js
   ```

## 📈 Performance Optimization

- **Database Indexing:** GIN indexes on content fields
- **Vector Optimization:** IVFFlat index for similarity search
- **Memory Management:** Driver recycling every 50 pages
- **Query Caching:** In-memory cache for frequent queries
- **Batch Processing:** Efficient embedding generation

## 🔮 Future Enhancements

- [ ] Multi-language support
- [ ] Real-time data synchronization
- [ ] Advanced query analytics
- [ ] Voice interface integration
- [ ] Mobile app development
- [ ] Advanced security features

## 📚 Dependencies

### **Node.js**
```json
{
  "@dqbd/tiktoken": "^1.0.21",
  "axios": "^1.5.0",
  "cheerio": "^1.0.0-rc.12",
  "express": "^4.18.2",
  "openai": "^4.0.0",
  "pg": "^8.16.3",
  "node-fetch": "^2.7.0"
}
```

### **Python**
```
selenium>=4.0.0
beautifulsoup4>=4.10.0
psycopg2-binary>=2.9.0
webdriver-manager>=3.8.0
python-dotenv>=0.19.0
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

**🎓 Developed as part of the Campus AI Digital Human Project internship**  
**🚀 RAG Architecture Implementation by the Development Team**
