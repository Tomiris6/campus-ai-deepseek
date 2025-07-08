
# Campus AI Assistant

To start working:

```bash
cd campus-ai-deepseek
npm install
echo "DEEPSEEK_API_KEY=your_key_here" > .env
node server.js
```

Open in browser: [http://localhost:3000](http://localhost:3000)

## Project Structure

| File/Folder         | Description                      |
| ------------------- | -------------------------------- |
| `public/index.html` | Main HTML interface (frontend)   |
| `public/script.js`  | Chat logic and frontend JS       |
| `server.js`         | Node.js backend API server       |
| `package.json`      | Project dependencies and scripts |

## Notes

* Keep your `.env` file **secret** – do not share it or commit it to Git.
* Requires a valid **DeepSeek API key**. You can use [OpenRouter's free DeepSeek R1 70B model](https://openrouter.ai/).
* Default server runs on **port 3000** – you can change this in `server.js`.
