const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
app.use(express.json());

// Simple HTML interface
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Gemini API Test</title>
            <style>
                body { font-family: Arial; padding: 20px; background: #f0f0f0; }
                .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; }
                button { background: #4CAF50; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; }
                button:hover { background: #45a049; }
                #result { margin-top: 20px; padding: 20px; background: #f9f9f9; border-radius: 5px; }
                .error { color: red; }
                .success { color: green; }
                pre { background: #333; color: #fff; padding: 10px; border-radius: 5px; overflow-x: auto; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Gemini API Test</h1>
                <p>API Key Status: ${process.env.GEMINI_API_KEY ? '✅ Configured' : '❌ Missing'}</p>
                
                <h2>Test Options:</h2>
                <button onclick="testSimple()">Test Simple Generation</button>
                <button onclick="testModels()">Test All Models</button>
                <button onclick="testREST()">Test REST API</button>
                <button onclick="testReadme()">Test README Generation</button>
                
                <div id="result"></div>
            </div>
            
            <script>
                async function makeRequest(endpoint) {
                    const resultDiv = document.getElementById('result');
                    resultDiv.innerHTML = '<p>Loading...</p>';
                    
                    try {
                        const response = await fetch(endpoint);
                        const data = await response.json();
                        
                        if (data.success) {
                            resultDiv.innerHTML = '<h3 class="success">✅ Success!</h3><pre>' + JSON.stringify(data, null, 2) + '</pre>';
                        } else {
                            resultDiv.innerHTML = '<h3 class="error">❌ Failed!</h3><pre>' + JSON.stringify(data, null, 2) + '</pre>';
                        }
                    } catch (error) {
                        resultDiv.innerHTML = '<h3 class="error">❌ Error!</h3><p>' + error.message + '</p>';
                    }
                }
                
                function testSimple() { makeRequest('/test/simple'); }
                function testModels() { makeRequest('/test/models'); }
                function testREST() { makeRequest('/test/rest'); }
                function testReadme() { makeRequest('/test/readme'); }
            </script>
        </body>
        </html>
    `);
});

// Test endpoints
app.get('/test/simple', async (req, res) => {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        const result = await model.generateContent("Say hello in 5 words or less");
        const text = result.response.text();
        
        res.json({ 
            success: true, 
            response: text,
            model: 'gemini-2.0-flash',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.json({ 
            success: false, 
            error: error.message,
            details: error.response?.data || 'No additional details'
        });
    }
});

app.get('/test/models', async (req, res) => {
    const models = ['gemini-pro', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash'];
    const results = {};
    
    for (const modelName of models) {
        try {
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: modelName });
            await model.generateContent("Hi");
            results[modelName] = '✅ Working';
        } catch (error) {
            results[modelName] = `❌ ${error.message}`;
        }
    }
    
    res.json({ success: true, models: results });
});

app.get('/test/rest', async (req, res) => {
    const axios = require('axios');
    
    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: [{
                    parts: [{ text: "Hello" }]
                }]
            }
        );
        
        res.json({ 
            success: true, 
            method: 'REST API',
            response: response.data.candidates[0].content.parts[0].text 
        });
    } catch (error) {
        res.json({ 
            success: false, 
            error: error.response?.data || error.message 
        });
    }
});

app.get('/test/readme', async (req, res) => {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        const prompt = `Create a very simple README with:
        # Title
        ## Description
        ## Installation
        
        Make it about a "Hello World" project. Keep it under 100 words.`;
        
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        
        res.json({ 
            success: true, 
            readme: text,
            length: text.length 
        });
    } catch (error) {
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`\n🧪 Test server running on http://localhost:${PORT}`);
    console.log(`📝 API Key configured: ${process.env.GEMINI_API_KEY ? 'Yes' : 'No'}\n`);
});