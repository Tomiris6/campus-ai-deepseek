#!/bin/bash

# Color codes for better readability
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}===================================${NC}"
echo -e "${BLUE}   Campus AI Demo Startup Script   ${NC}"
echo -e "${BLUE}===================================${NC}"

# Set base directory
BASE_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BACKEND_DIR="${BASE_DIR}/campus-ai-deepseek-RAG_architecture"
VOICE_AGENT_DIR="${BASE_DIR}/live-agent"

# Check if directories exist
if [ ! -d "$BACKEND_DIR" ]; then
    echo -e "${RED}Error: Backend directory not found at ${BACKEND_DIR}${NC}"
    exit 1
fi

if [ ! -d "$VOICE_AGENT_DIR" ]; then
    echo -e "${RED}Error: Voice agent directory not found at ${VOICE_AGENT_DIR}${NC}"
    exit 1
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed. Please install Node.js and try again.${NC}"
    exit 1
fi

# Check for Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: Python 3 is not installed. Please install Python 3 and try again.${NC}"
    exit 1
fi

# Make sure env files exist
if [ ! -f "${BACKEND_DIR}/.env" ]; then
    echo -e "${YELLOW}Warning: Backend .env file not found. Some features may not work correctly.${NC}"
fi

if [ ! -f "${VOICE_AGENT_DIR}/.env" ]; then
    echo -e "${YELLOW}Warning: Voice agent .env file not found. Voice features may not work correctly.${NC}"
fi

# Start the server
echo -e "${GREEN}Starting Campus AI server...${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop the server${NC}"
cd "$BACKEND_DIR" && node server.js

# Note: The voice agent is automatically started by the server when needed
