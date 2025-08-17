// user-tracking.js

document.addEventListener('DOMContentLoaded', () => {
    // This part generates the IDs
    let userId = localStorage.getItem('chatbot_user_id');
    if (!userId) {
        userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        localStorage.setItem('chatbot_user_id', userId);
    }
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Log them to the console so you can see them
    console.log("User ID (from user-tracking.js):", userId);
    console.log("Session ID (from user-tracking.js):", sessionId);

    // This part intercepts the fetch request to add the new data
    const originalFetch = window.fetch;
    window.fetch = function (url, options) {
        if (url === 'http://localhost:3000/api/chat' && options && options.method === 'POST') {
            try {
                const body = JSON.parse(options.body);
                // Add the new IDs to the message body
                body.user_id = userId;
                body.session_id = sessionId;
                // Update the options with the modified body
                options.body = JSON.stringify(body);
            } catch (e) {
                console.error("Could not modify fetch request:", e);
            }
        }
        // Proceed with the original fetch call, ensuring 'this' and 'arguments' are correct
        return originalFetch.apply(this, arguments);
    };
});
