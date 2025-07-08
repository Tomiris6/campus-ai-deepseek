const API_KEY = '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'; // Paste your API key
const content = document.getElementById('content');
const chatInput = document.getElementById('chatInput');
const sendButton = document.getElementById('sendButton');

let isAnswerLoading = false;
let answerSectionId = 0;

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

async function getAnswer(question) {
    try {
        const response = await fetch('/api/chat', {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ message: question })
        });
        
        const data = await response.json();
        const resultData = data.response;
        isAnswerLoading = false;
        addAnswerSection(resultData);
    } catch (error) {
        console.error('Error:', error);
        isAnswerLoading = false;
        addAnswerSection("Sorry, there was an error processing your request.");
    } finally {
        scrollToBottom();
        sendButton.classList.remove('send-button-nonactive');
    }
}

function addQuestionSection(message) {
    isAnswerLoading = true;
    const sectionElement = document.createElement('section');
    sectionElement.className = 'question-section';
    sectionElement.textContent = message;

    content.appendChild(sectionElement);
    scrollToBottom();
    
    answerSectionId++;
    const answerSectionElement = document.createElement('section');
    answerSectionElement.className = 'answer-section';
    answerSectionElement.innerHTML = getLoadingSvg();
    answerSectionElement.id = answerSectionId;
    content.appendChild(answerSectionElement);
    
    getAnswer(message);
}

function addAnswerSection(message) {
    const answerSectionElement = document.getElementById(answerSectionId);
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