#!/usr/bin/env python3
"""
Simplified Voice Agent for Campus Guide
Uses Azure Speech Services with the existing campus guide backend
"""

import os
import json
import asyncio
import azure.cognitiveservices.speech as speechsdk
from datetime import datetime
import requests
import sys
import re
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Global conversation history
conversation_history = []

def log_message(message):
    """Log messages with timestamp"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] {message}")
    sys.stdout.flush()

def add_to_history(role, content):
    """Add message to conversation history"""
    global conversation_history
    conversation_history.append({"role": role, "content": content})
    # Keep only last 10 messages to manage context length
    if len(conversation_history) > 10:
        conversation_history = conversation_history[-10:]

def setup_speech_config():
    """Setup Azure Speech configuration with standard voice quality"""
    # Debug: Check if environment variables are loaded
    speech_key = os.getenv('AZURE_SPEECH_KEY')
    speech_region = os.getenv('AZURE_SPEECH_REGION')
    
    log_message(f"Azure Speech Key loaded: {'Yes' if speech_key else 'No'}")
    log_message(f"Azure Speech Region: {speech_region}")
    
    if not speech_key or not speech_region:
        raise ValueError("Azure Speech credentials not found in environment variables")
    
    speech_config = speechsdk.SpeechConfig(
        subscription=speech_key,
        region=speech_region
    )
    
    # Using standard voice instead of enhanced neural voice - using a voice that we know is supported
    speech_config.speech_synthesis_voice_name = "en-US-Guy24kRUS"
    
    # Use a basic audio format for better compatibility
    speech_config.set_speech_synthesis_output_format(speechsdk.SpeechSynthesisOutputFormat.Riff16Khz16BitMonoPcm)
    
    log_message(f"🎵 Speech config: Using standard voice {speech_config.speech_synthesis_voice_name}")
    
    return speech_config

def setup_audio_config():
    """Setup audio configuration for speech synthesis with better compatibility"""
    try:
        # Use default speaker output
        audio_config = speechsdk.audio.AudioOutputConfig(use_default_speaker=True)
        log_message("✅ Audio config: Using default speaker")
        return audio_config
    except Exception as e:
        log_message(f"❌ Default speaker setup failed: {e}")
        try:
            # Try without audio config (uses system default)
            log_message("🔧 Falling back to system default audio")
            return None
        except Exception as e2:
            log_message(f"❌ Audio config setup completely failed: {e2}")
            return None

# This original test_audio_output function has been replaced with the new version

def query_campus_guide(user_message):
    """Query the campus guide backend with conversation history"""
    try:
        log_message(f"Querying campus guide with: '{user_message}'")
        
        # Add current user message to history
        add_to_history("user", user_message)
        
        # Query the local campus guide server with conversation history and voice mode
        response = requests.post(
            "http://localhost:3000/api/chat",
            json={
                "messages": conversation_history.copy(),  # Send full conversation history
                "voiceMode": True  # Enable optimized voice mode with real database
            },
            timeout=30  # Increased timeout to 30 seconds
        )
        
        log_message(f"Response status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            reply = data.get("response", "I'm sorry, I couldn't find an answer to your question.")
            log_message(f"Campus guide reply: {reply[:100]}...")
            
            # Add assistant response to history
            add_to_history("assistant", reply)
            
            # Make the response more conversational for voice
            conversational_reply = make_conversational(reply)
            return conversational_reply
        else:
            log_message(f"Error response: {response.text}")
            return get_fallback_response(user_message)
            
    except requests.exceptions.Timeout:
        log_message("Request timed out - the campus guide is taking too long to respond")
        return get_fallback_response(user_message)
    except Exception as e:
        log_message(f"Error querying campus guide: {e}")
        return get_fallback_response(user_message)

def get_fallback_response(user_message):
    """Provide a helpful fallback response when the main system is unavailable"""
    user_lower = user_message.lower()
    
    if any(word in user_lower for word in ['admission', 'apply', 'application', 'entry']):
        return """I'd be happy to help with admissions information! While I'm having trouble accessing our detailed database right now, I can tell you that International School welcomes applications throughout the year. 

For the most current admission requirements, deadlines, and application procedures, I recommend visiting our admissions office directly or checking our official website. Our admissions team can provide you with detailed information about entrance requirements, tuition fees, and available programs.

Would you like me to try connecting to our information system again, or do you have other questions I might be able to help with?"""
    
    elif any(word in user_lower for word in ['program', 'course', 'curriculum', 'subject']):
        return """Our school offers comprehensive academic programs designed to prepare students for success. We have strong programs in Science, Arts, Languages, and other core subjects.

I'm currently having some difficulty accessing our detailed curriculum database, but I can tell you that we focus on holistic education, combining academic excellence with character development.

Let me try to reconnect to our information system, or feel free to ask about other aspects of the school!"""
    
    elif any(word in user_lower for word in ['facility', 'campus', 'building', 'location']):
        return """Our campus features excellent facilities designed to support comprehensive education. We have modern classrooms, science laboratories, sports facilities, and other amenities to enhance student learning.

I'm having temporary difficulty accessing our detailed facility information, but I'd be happy to try again or help you with other questions about the school.

Would you like me to attempt reconnecting to our campus information system?"""
    
    else:
        return """I apologize, but I'm currently experiencing some technical difficulties connecting to our main campus information system. This might be due to high server load or temporary connectivity issues.

I'm your International School voice guide, and I'm here to help with information about admissions, programs, facilities, student life, and more. 

Would you like me to try your question again, or perhaps you could rephrase it? I'll do my best to assist you with information about our school!"""

def make_conversational(text):
    """Basic text cleanup for voice output while preserving information"""
    # Remove markdown formatting but keep the content
    import re
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)  # Remove bold, keep content
    text = re.sub(r'\*(.*?)\*', r'\1', text)      # Remove italic, keep content
    text = re.sub(r'`(.*?)`', r'\1', text)        # Remove code formatting, keep content
    text = re.sub(r'#{1,6}\s', '', text)          # Remove headers
    text = re.sub(r'\[(.*?)\]\((.*?)\)', r'\1', text)  # Remove links, keep text
    
    # Simple formatting for headers
    text = text.replace('Admissions Overview:', 'Admissions Overview:')
    text = text.replace('Selection Criteria:', 'Selection Criteria:')
    text = text.replace('Interview Process:', 'Interview Process:')
    text = text.replace('Required Documents:', 'Required Documents:')
    
    # Make lists more readable
    text = re.sub(r'^\s*\d+\.\s', 'Number. ', text, flags=re.MULTILINE)
    text = re.sub(r'^\s*[-•]\s', 'Point. ', text, flags=re.MULTILINE)
    
    return text

def create_natural_speech(text, emotion=None, style=None):
    """Create basic SSML for speech synthesis"""
    # Clean text for SSML
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    
    # Create simple SSML without enhanced features
    ssml = f"""
    <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
        <voice name="en-US-Guy24kRUS">
            <prosody rate="1.0" pitch="0%" volume="100">
                {text}
            </prosody>
        </voice>
    </speak>
    """
    return ssml.strip()

# This function has been removed as it's no longer needed

def speak_with_emotion(synthesizer, text, emotion=None, do_sound_check=False):
    """Basic function to speak text"""
    try:
        # Main speech synthesis
        log_message(f"Speaking: {text[:100]}...")
        result = synthesizer.speak_text_async(text).get()
        
        if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            log_message("✅ Speech synthesis successful")
            return True
        elif result.reason == speechsdk.ResultReason.Canceled:
            cancellation_details = result.cancellation_details
            log_message(f"❌ Speech synthesis canceled: {cancellation_details.reason}")
            if cancellation_details.error_details:
                log_message(f"Error details: {cancellation_details.error_details}")
            
            # Try saving to file as backup
            try:
                log_message("🔄 Attempting to save audio to file as backup...")
                audio_filename = f"voice_output_{datetime.now().strftime('%H%M%S')}.wav"
                audio_config_file = speechsdk.audio.AudioOutputConfig(filename=audio_filename)
                # Create a fresh speech config for file synthesis
                speech_config = setup_speech_config()
                file_synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=audio_config_file)
                file_result = file_synthesizer.speak_text_async(text).get()
                
                if file_result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
                    log_message(f"✅ Audio saved to {audio_filename} - you can play this file manually")
                    # Try to play the file using macOS
                    import subprocess
                    subprocess.run(['afplay', audio_filename], check=False)
                    return True
                    
            except Exception as file_error:
                log_message(f"❌ File backup failed: {file_error}")
            
            return False
        else:
            log_message(f"❌ Speech synthesis failed: {result.reason}")
            return False
            
    except Exception as e:
        log_message(f"❌ Speech synthesis exception: {e}")
        return False

def test_audio_output(synthesizer):
    """Quietly test if audio output is working"""
    try:
        # Silent check - only log status, don't speak test message
        result = synthesizer.speak_text_async("").get()
        
        if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            log_message("✅ Audio system initialized successfully")
            return True
        else:
            log_message(f"⚠️ Audio initialization check: {result.reason}")
            return False
                
    except Exception as e:
        log_message(f"❌ Audio initialization issue: {e}")
        return False

def main():
    """Main voice agent function"""
    log_message("🎤 Starting Campus Voice Guide...")
    log_message("Setting up Azure Speech Services...")
    
    try:
        speech_config = setup_speech_config()
        audio_config = setup_audio_config()
        
        # Create speech recognizer and synthesizer with audio configuration
        recognizer = speechsdk.SpeechRecognizer(speech_config=speech_config)
        if audio_config:
            synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=audio_config)
            log_message("🔊 Using configured audio output")
        else:
            synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config)
            log_message("🔊 Using system default audio output")
        
        log_message("✅ Voice Agent Ready!")
        
        # Initialize audio system
        test_audio_output(synthesizer)
        
        log_message("️  Say 'hello' to start or 'quit' to exit")
        
        # Simple greeting
        greeting = """Welcome to International School. I am your campus voice guide.
        I can provide information about admissions, programs, and campus life.
        How may I help you today?"""
        
        log_message(f"Assistant: {greeting}")
        add_to_history("assistant", greeting)  # Add greeting to conversation history
        speak_with_emotion(synthesizer, greeting)
        
        while True:
            log_message("🎧 Listening...")
            
            # Recognize speech
            result = recognizer.recognize_once()
            
            if result.reason == speechsdk.ResultReason.RecognizedSpeech:
                user_input = result.text.strip()
                log_message(f"User: {user_input}")
                
                # Check for quit commands
                if user_input.lower() in ['quit', 'exit', 'goodbye', 'bye']:
                    farewell = """Thank you for your interest in International School.
                    If you need more information, please contact the school office.
                    Goodbye."""
                    log_message(f"Assistant: {farewell}")
                    speak_with_emotion(synthesizer, farewell)
                    break
                
                # Handle common commands that might be mistaken for sound checks
                elif user_input.lower() in ['sound check', 'test audio', 'check sound', 'audio test', 
                                          'comprehensive audio test', 'full audio test', 'test all audio']:
                    response = query_campus_guide(user_input)
                    log_message(f"Assistant: {response}")
                    speak_with_emotion(synthesizer, response)
                    continue
                
                # Query the campus guide
                response = query_campus_guide(user_input)
                log_message(f"Assistant: {response}")
                
                # Minimal text processing for voice
                conversational_response = make_conversational(response)
                
                # Speak the response without emotion
                speak_with_emotion(synthesizer, conversational_response)
                
            elif result.reason == speechsdk.ResultReason.NoMatch:
                log_message("🔇 No speech detected, please try again")
                
            elif result.reason == speechsdk.ResultReason.Canceled:
                cancellation_details = result.cancellation_details
                log_message(f"❌ Speech recognition canceled: {cancellation_details.reason}")
                if cancellation_details.reason == speechsdk.CancellationReason.Error:
                    log_message(f"Error details: {cancellation_details.error_details}")
                break
                
    except Exception as e:
        log_message(f"❌ Error: {e}")
        return 1
    
    log_message("🛑 Voice Agent stopped")
    return 0

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
