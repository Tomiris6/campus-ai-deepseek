# Campus AI Guide

A comprehensive interactive campus guide with both text chat and voice interaction capabilities. The system provides information about admissions, programs, campus life, and more using a knowledge-based approach with advanced RAG (Retrieval-Augmented Generation) architecture.

![Campus AI Guide](https://img.shields.io/badge/Campus_AI-v1.0-blue)

## Features

- **Interactive Text Chat**: Web interface for text-based queries about the campus
- **Voice Interaction**: Voice agent for spoken interaction using Azure Speech Services
- **Knowledge Base Integration**: RAG architecture for accurate, knowledge-based responses
- **Multi-query Generation**: Breaks complex questions into simpler ones for better answers
- **Hybrid Retrieval**: Combines vector and keyword search for optimal information retrieval

## Getting Started

### Prerequisites

- **Node.js** (v18+)
- **Python** (v3.8+)
- Azure Speech Services Account (for voice functionality)
- OpenAI API Key or DeepSeek API Key for LLM access

### Installation

1. **Set Up Backend**:
   ```bash
   cd campus-ai-deepseek-RAG_architecture
   npm install
   ```

2. **Configure Environment**:
   Create a `.env` file in the root directory with the following content:
   ```
   OPENAI_API_KEY=your_openai_key
   # OR
   DEEPSEEK_API_KEY=your_deepseek_key
   
   # Optional Database Configuration
   PGHOST=your_pg_host
   PGDATABASE=your_pg_database
   PGUSER=your_pg_user
   PGPASSWORD=your_pg_password
   PGPORT=5432
   ```

3. **Set Up Voice Agent** (Optional):
   ```bash
   cd ../live-agent
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

4. **Configure Voice Services**:
   Create a `.env` file in the `live-agent` directory:
   ```
   AZURE_SPEECH_KEY=your_azure_speech_key
   AZURE_SPEECH_REGION=your_azure_region
   ```

### Running the Application

**Start the complete system**:
```bash
cd campus-ai-deepseek-RAG_architecture
node server.js
```

This starts both the web server and the voice agent (if configured). Access the application at [http://localhost:3000](http://localhost:3000).

## Project Structure

### Main Components

| Component | Description |
|-----------|-------------|
| **Backend Server** | Node.js Express server handling API requests and managing the voice agent |
| **Web Interface** | HTML/JS frontend for text interactions |
| **Voice Agent** | Python-based Azure Speech Services integration |
| **Knowledge Base** | PostgreSQL database with campus information |

### Key Files

| File/Folder | Description |
|-------------|-------------|
| \`server.js\` | Main server file with API endpoints and voice agent management |
| \`embed_data.js\` | Knowledge base embedding and management |
| \`public/index.html\` | Web interface |
| \`public/script.js\` | Frontend JavaScript for chat functionality |
| \`live-agent/simple_voice_agent.py\` | Voice interaction using Azure Speech Services |

## Usage

### Web Interface

1. Open [http://localhost:3000](http://localhost:3000) in your browser
2. Type questions about the campus in the chat interface
3. Receive AI-generated responses based on the knowledge base

### Voice Interaction

1. Click the microphone button in the web interface
2. Speak your question clearly
3. Listen to the AI response through your speakers/headphones

## Technologies

- **Backend**: Node.js, Express
- **Frontend**: HTML, CSS, JavaScript
- **Database**: PostgreSQL
- **AI Models**: OpenAI API / DeepSeek API
- **Speech Services**: Azure Cognitive Services Speech SDK
- **RAG Architecture**: Vector embeddings with hybrid search

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Azure Speech Services for voice capabilities
- OpenAI/DeepSeek for language model support
- PostgreSQL for database support
