const API_KEY = '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'; 

const content = document.getElementById('content');
const chatInput = document.getElementById('chatInput');
const sendButton = document.getElementById('sendButton');

// conversation history with memory
let conversationHistory = [];
let isAnswerLoading = false;
let answerSectionId = 0;
const CONTEXT_LENGTH = 10; // Keep last 20 messages (10 pairs)

//for school context
const systemMessage = {
    role: "system",
    content: `You are the assistant at Kwun Tong Maryknoll College. Answer only questions about the school.
    
    School information:
    - Name: Kwun Tong Maryknoll College
    - Description: Kwun Tong Maryknoll College is the third secondary school opened in Hong Kong by the Maryknoll Fathers, a society of Catholic priests and brothers founded in the United States in 1911.
    - Contact: Phone (852)2717 1485, email ktmc@ktmc.edu.hk
    - Address: 100 Tsui Ping Road, Kwun Tong, Kowloon, Hong Kong
    - Programs: Science, Arts, Languages
    
    If the question is not about the school, respond: "I can only answer questions about Kwun Tong Maryknoll College."`
};

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
    
    conversationHistory.push({ role: "user", content: question });
    
    const limitedHistory = conversationHistory.slice(-CONTEXT_LENGTH * 2);
    
    const messages = [systemMessage, ...limitedHistory];
    
    console.log("Sending to API:", messages.length, "messages");
    console.log("Messages:", messages);
    
    fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            "model": "deepseek/deepseek-r1-distill-llama-70b:free",
            "messages": messages
        })
    })
    .then(response => response.json())
    .then(data => {
        const resultData = data.choices[0].message.content;
        
        conversationHistory.push({ role: "assistant", content: resultData });
        
        console.log("Assistant response:", resultData);
        console.log("Current conversation history:", conversationHistory);
        
        isAnswerLoading = false;
        updateAnswerSection(resultData);
    })
    .catch(error => {
        console.error("Error:", error);
        updateAnswerSection("Sorry, an error occurred. Please try again.");
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