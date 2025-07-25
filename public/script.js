const content = document.getElementById('content');
const chatInput = document.getElementById('chatInput');
const sendButton = document.getElementById('sendButton');

// conversation history with memory
let conversationHistory = [];
let isAnswerLoading = false;
let answerSectionId = 0;
const CONTEXT_LENGTH = 20; // Keep last 20 messages (10 pairs)

// The API_KEY and systemMessage constants are removed from here.
// API key is handled by server.js.
// System message is dynamically built by server.js with RAG context.

sendButton.addEventListener('click', () => handleSendMessage());
chatInput.addEventListener('keypress', event => {
    if (event.key === 'Enter') {
        handleSendMessage();
    }
});

function handleSendMessage() {
    const question = chatInput.value.trim();
    if (question === '' || isAnswerLoading) return;

    sendButton.classList.add('send-button-nonactive');
    addQuestionSection(question);
    chatInput.value = '';
}

function getAnswer(question) {
    console.log("Sending question:", question);

    // Your conversation history logic remains the same
    conversationHistory.push({ role: "user", content: question });
    const limitedHistory = conversationHistory.slice(-CONTEXT_LENGTH * 2);

    // We no longer send the systemMessage from the frontend.
    // The backend (server.js) will construct the full system message
    // including the retrieved context.
    // So, we just send the limited chat history (user messages and assistant replies)
    const messagesToSend = limitedHistory; // Only send the user-assistant conversation history

    console.log("Sending to Backend API:", messagesToSend.length, "messages");
    console.log("Messages being sent to Backend:", messagesToSend); // Check what's actually sent

    fetch("http://localhost:3000/api/chat", { // Correctly points to your local server!
        method: "POST",
        headers: {
            "Content-Type": "application/json"
            // "Authorization" header and "model" field are correctly removed from here.
        },
        body: JSON.stringify({
            messages: messagesToSend // Send the messages array
        })
    })
        .then(response => {
            if (!response.ok) {
                // Handle HTTP errors, e.g., 500 from your server
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            const resultData = data.response; // Your server sends 'response' field

            conversationHistory.push({ role: "assistant", content: resultData });

            console.log("Assistant response from Backend:", resultData);
            console.log("Current conversation history:", conversationHistory);

            isAnswerLoading = false;
            updateAnswerSection(resultData);
        })
        .catch(error => {
            console.error("Error communicating with backend:", error); // More specific error message
            updateAnswerSection("Sorry, an error occurred with the server. Please try again.");
            isAnswerLoading = false;
        })
        .finally(() => {
            sendButton.classList.remove('send-button-nonactive');
            scrollToBottom();
        });
}

function addQuestionSection(message) {
    isAnswerLoading = true;
    const sectionElement = document.createElement('div');
    sectionElement.className = 'question-section';
    sectionElement.textContent = message;
    content.appendChild(sectionElement);

    answerSectionId++;
    const answerElement = document.createElement('div');
    answerElement.className = 'answer-section';
    answerElement.id = 'answer-' + answerSectionId;
    answerElement.innerHTML = getLoadingSvg();
    content.appendChild(answerElement);

    getAnswer(message);
    scrollToBottom();
}

function updateAnswerSection(message) {
    const answerSectionElement = document.getElementById('answer-' + answerSectionId);
    if (answerSectionElement) {
        answerSectionElement.textContent = message;
    }
}

function getLoadingSvg() {
    return '<svg style="height: 25px;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><circle fill="#4F6BFE" stroke="#4F6BFE" stroke-width="15" r="15" cx="40" cy="65"><animate attributeName="cy" calcMode="spline" dur="2" values="65;135;65;" keySplines=".5 0 .5 1;.5 0 .5 1" repeatCount="indefinite" begin="-.4"></animate></circle><circle fill="#4F6BFE" stroke="#4F6BFE" stroke-width="15" r="15" cx="100" cy="65"><animate attributeName="cy" calcMode="spline" dur="2" values="65;135;65;" keySplines=".5 0 .5 1;.5 0 .5 1" repeatCount="indefinite" begin="-.2"></animate></circle><circle fill="#4F6BFE" stroke="#4F6BFE" stroke-width="15" r="15" cx="160" cy="65"><animate attributeName="cy" calcMode="spline" dur="2" values="65;135;65;" keySplines=".5 0 .5 1;.5 0 .5 1" repeatCount="indefinite" begin="0"></animate></circle></svg>';
}

function scrollToBottom() {
    content.scrollTo({
        top: content.scrollHeight,
        behavior: 'smooth'
    });
}

function clearChatHistory() {
    conversationHistory = [];
    content.innerHTML = '<div class="answer-section">Hello! How can I help you with Kwun Tong Maryknoll College?</div>';
    console.log("Chat history cleared");
}

window.clearChatHistory = clearChatHistory;