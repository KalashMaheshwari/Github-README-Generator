const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
require('dotenv').config();

console.log('=== Gemini API Test Suite ===\n');

// Check if API key exists
if (!process.env.GEMINI_API_KEY) {
    console.error('❌ ERROR: GEMINI_API_KEY not found in .env file');
    console.log('\nPlease create a .env file with:');
    console.log('GEMINI_API_KEY=your_api_key_here\n');
    process.exit(1);
}

console.log('✅ API Key found:', process.env.GEMINI_API_KEY.substring(0, 10) + '...');
console.log('Key length:', process.env.GEMINI_API_KEY.length);

// Test 1: Basic SDK Test
async function testBasicSDK() {
    console.log('\n📝 Test 1: Basic SDK Test');
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const prompt = "Say 'Hello World' in exactly 3 words";
        console.log('Prompt:', prompt);
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        console.log('✅ Success! Response:', text);
        return true;
    } catch (error) {
        console.error('❌ Failed:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
        return false;
    }
}

// Test 2: Test Different Models
async function testDifferentModels() {
    console.log('\n📝 Test 2: Testing Different Models');
    const models = [
        'gemini-pro',
        'gemini-1.5-flash',
        'gemini-1.5-flash-latest',
        'gemini-1.5-pro',
        'gemini-1.0-pro',
        'gemini-2.0-flash',
        'gemini-2.0-flash-latest',
    ];
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    for (const modelName of models) {
        try {
            console.log(`\nTrying model: ${modelName}`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent("Return OK");
            const text = result.response.text();
            console.log(`✅ ${modelName} works!`);
        } catch (error) {
            console.log(`❌ ${modelName} failed:`, error.message);
        }
    }
}

// Test 3: REST API Test
async function testRESTAPI() {
    console.log('\n📝 Test 3: REST API Test');
    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: [{
                    parts: [{
                        text: "Say hello"
                    }]
                }]
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (response.data && response.data.candidates) {
            console.log('✅ REST API works!');
            console.log('Response:', response.data.candidates[0].content.parts[0].text);
            return true;
        }
    } catch (error) {
        console.error('❌ REST API failed:', error.response?.data || error.message);
        return false;
    }
}

// Test 4: Check Rate Limits
async function testRateLimits() {
    console.log('\n📝 Test 4: Rate Limit Information');
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        console.log('Making 5 rapid requests...');
        for (let i = 1; i <= 5; i++) {
            try {
                const start = Date.now();
                await model.generateContent(`Test ${i}`);
                const time = Date.now() - start;
                console.log(`✅ Request ${i} completed in ${time}ms`);
            } catch (error) {
                console.log(`❌ Request ${i} failed:`, error.message);
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    } catch (error) {
        console.error('Rate limit test error:', error.message);
    }
}

// Test 5: Complex Content Generation
async function testComplexGeneration() {
    console.log('\n📝 Test 5: Complex Content Generation');
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        const prompt = `Generate a simple README structure with these sections:
        1. Title
        2. Description
        3. Installation
        
        Keep it very brief, just headings.`;
        
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        
        console.log('✅ Complex generation works!');
        console.log('Response preview:', text.substring(0, 200) + '...');
        return true;
    } catch (error) {
        console.error('❌ Complex generation failed:', error.message);
        return false;
    }
}

// Test 6: Error Details
async function testErrorDetails() {
    console.log('\n📝 Test 6: Detailed Error Information');
    try {
        // Intentionally use wrong API key format
        const genAI = new GoogleGenerativeAI('invalid-key');
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        await model.generateContent("Test");
    } catch (error) {
        console.log('Expected error occurred:');
        console.log('- Error name:', error.name);
        console.log('- Error message:', error.message);
        console.log('- Error code:', error.code);
        if (error.response) {
            console.log('- Status:', error.response.status);
            console.log('- Status text:', error.response.statusText);
        }
    }
}

// Run all tests
async function runAllTests() {
    console.log('Starting Gemini API tests...\n');
    
    await testBasicSDK();
    await testDifferentModels();
    await testRESTAPI();
    await testRateLimits();
    await testComplexGeneration();
    await testErrorDetails();
    
    console.log('\n=== Test Suite Complete ===');
}

// Run tests
runAllTests().catch(console.error);