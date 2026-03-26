require('dotenv').config();

async function listModels() {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('No API key found in .env');
            return;
        }

        const fetch = (await import('node-fetch')).default || require('node-fetch'); // or native fetch in Node >= 18
        
        let response;
        if (typeof fetch !== 'undefined') {
            response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        } else {
            const { default: fetch } = await import('node-fetch');
            response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        }

        const data = await response.json();
        if (data.models) {
            console.log("AVAILABLE MODELS:");
            data.models.forEach(m => console.log(m.name));
        } else {
            console.error(data);
        }
    } catch (e) {
        // Fallback for native fetch in Node 20
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        const data = await response.json();
        console.log("AVAILABLE MODELS (Node 20 fetch):");
        data.models.forEach(m => console.log(m.name));
    }
}

listModels();
