# Campus AI Project

A comprehensive interactive campus guide system with both text and voice interaction capabilities.

## System Components

This project consists of two main components:

1. **Campus AI RAG Architecture** - The core backend system with web interface
2. **Voice Agent** - The voice interaction component using Azure Speech Services

## Quick Start

1. **Start the Complete System**:
   ```bash
   cd campus-ai-deepseek-RAG_architecture
   node server.js
   ```

2. **Access the Web Interface**:
   Open [http://localhost:3000](http://localhost:3000) in your browser

## Project Structure

- `campus-ai-deepseek-RAG_architecture/` - Main backend system
  - Node.js Express server
  - Web interface
  - RAG knowledge base architecture
  - API endpoints

- `live-agent/` - Voice interaction system
  - Python-based voice agent
  - Azure Speech Services integration
  - Speech recognition and synthesis

## Setup Instructions

Each component has its own README file with detailed setup instructions:

- [Campus AI RAG Architecture Setup](./campus-ai-deepseek-RAG_architecture/README.md)
- [Voice Agent Setup](./live-agent/README.md)

## Technologies

- **Backend**: Node.js, Express, PostgreSQL
- **Frontend**: HTML, CSS, JavaScript
- **AI**: RAG architecture, OpenAI/DeepSeek API
- **Voice**: Azure Cognitive Services Speech SDK, Python

## License

This project is licensed under the MIT License.
