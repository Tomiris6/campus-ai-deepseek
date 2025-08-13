# Campus AI Voice Agent

This component provides voice interaction capabilities for the Campus AI Guide system using Azure Speech Services.

## Features

- **Voice Recognition**: Converts spoken user questions into text
- **Voice Synthesis**: Generates natural-sounding speech responses
- **Integration**: Works seamlessly with the Campus AI backend
- **Error Handling**: Robust error recovery and fallbacks

## Prerequisites

- Python 3.8+
- Azure Speech Services account with subscription key
- Virtual environment (recommended)

## Setup

1. **Create Virtual Environment**:
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   ```

2. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure Azure Speech Services**:
   Create a `.env` file with:
   ```
   AZURE_SPEECH_KEY=your_azure_speech_key
   AZURE_SPEECH_REGION=your_azure_region
   ```

## Usage

The voice agent is automatically started by the main Campus AI server when needed. It should not be run independently.

When the main server starts, it will:
1. Check for Python and the virtual environment
2. Launch the voice agent as a subprocess
3. Handle communication between the web interface and the voice agent

## Configuration

The voice agent uses standard voice (en-US-Guy24kRUS) for optimal compatibility across devices.

## Troubleshooting

- **No Audio Output**: Ensure your speakers/headphones are properly connected and not muted
- **Recognition Issues**: Speak clearly and try to minimize background noise
- **Server Connection**: Ensure the main Campus AI server is running

## License

This component is part of the Campus AI Guide project, licensed under the MIT License.
