const express = require('express');
const axios = require('axios');
const cors = require('cors');
const session = require('express-session'); // <-- This MUST be required before connect-redis
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// --- NEW/FIXED REDIS IMPORTS ---
// This syntax is for connect-redis@6.0.0
const connectRedis = require("connect-redis");
const RedisStore = connectRedis(session);
const Redis = require("ioredis");
// --- END NEW/FIXED REDIS IMPORTS ---

const app = express();

// --- SMART SESSION STORAGE (NEW) ---
let sessionStore;

if (process.env.NODE_ENV === 'production') {
    // PRODUCTION (Vercel) - Use Redis
    console.log("Connecting to Redis for session storage...");
    
    // Check if KV_URL is set
    if (!process.env.KV_URL) {
        console.error("FATAL: KV_URL is not set in production environment!");
    }

    const redisClient = new Redis(process.env.KV_URL);
    redisClient.on('error', (err) => console.error('Redis Client Error:', err.message));
    redisClient.on('connect', () => console.log('Redis Client Connected.'));

    sessionStore = new RedisStore({
        client: redisClient,
        prefix: "readme-gen-session:",
    });
} else {
    // DEVELOPMENT (Local) - Use MemoryStore
    console.log("Using in-memory session storage for development.");
    sessionStore = new session.MemoryStore();
}
// --- END SMART SESSION STORAGE ---

// --- MODIFIED SESSION CONFIGURATION ---
// Session configuration for OAuth with enhanced security
app.use(session({
    store: sessionStore, // Use the smart store we just configured
    secret: process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax' // CSRF protection
    },
    name: 'sessionId' // Don't use default name
}));
// --- END MODIFIED SESSION CONFIGURATION ---

// Middleware
app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true
}));
app.use(express.json());

// Security middleware to prevent token leaks in responses
app.use((req, res, next) => {
    const originalJson = res.json;
    res.json = function(data) {
        // Deep clean any response to remove potential token leaks
        const cleaned = JSON.parse(JSON.stringify(data, (key, value) => {
            // Remove any field that might contain tokens
            if (typeof value === 'string' && 
                (value.includes('ghp_') || // GitHub Personal Access Token
                 value.includes('gho_') || // GitHub OAuth Token
                 value.includes('ghs_') || // GitHub Server Token
                 key.toLowerCase().includes('token') ||
                 key.toLowerCase().includes('secret'))) {
                return '[REDACTED]';
            }
            return value;
        }));
        originalJson.call(this, cleaned);
    };
    next();
});

app.use(express.static('public'));

// Safe logging function
const safeLog = (message, data) => {
    if (data && typeof data === 'object') {
        const safe = JSON.parse(JSON.stringify(data, (key, value) => {
            if (key.toLowerCase().includes('token') || 
                key.toLowerCase().includes('secret') ||
                (typeof value === 'string' && value.includes('ghp_'))) {
                return '[REDACTED]';
            }
            return value;
        }));
        console.log(message, safe);
    } else {
        console.log(message);
    }
};

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// GitHub OAuth configuration
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI; // This will be set in .env (local) or Vercel (prod)

// Middleware to check authentication
function requireAuth(req, res, next) {
    if (!req.session.accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

// OAuth Routes
app.get('/auth/github', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    
    // Critical check
    if (!GITHUB_REDIRECT_URI) {
        console.error("FATAL ERROR: GITHUB_REDIRECT_URI is not set. Check your .env file or Vercel environment variables.");
        return res.status(500).send("Server configuration error: Missing GITHUB_REDIRECT_URI.");
    }
    
    const authUrl = `https://github.com/login/oauth/authorize?` +
        `client_id=${GITHUB_CLIENT_ID}&` +
        `redirect_uri=${GITHUB_REDIRECT_URI}&` +
        `scope=repo&` +
        `state=${state}`;
    
    res.redirect(authUrl);
});

app.get('/auth/github/callback', async (req, res) => {
    const { code, state } = req.query;
    
    // Verify state to prevent CSRF
    if (state !== req.session.oauthState) {
        return res.redirect('/?error=invalid_state');
    }

    // Critical check
    if (!GITHUB_REDIRECT_URI) {
        console.error("FATAL ERROR: GITHUB_REDIRECT_URI is not set for callback. Check your .env file or Vercel environment variables.");
        return res.status(500).send("Server configuration error: Missing GITHUB_REDIRECT_URI.");
    }
    
    try {
        // Exchange code for access token
        const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: GITHUB_CLIENT_ID,
            client_secret: GITHUB_CLIENT_SECRET,
            code: code,
            redirect_uri: GITHUB_REDIRECT_URI
        }, {
            headers: {
                'Accept': 'application/json'
            }
        });
        
        const { access_token } = tokenResponse.data;
        
        if (!access_token) {
            throw new Error('No access token received');
        }
        
        // Store token in session (never send to client)
        req.session.accessToken = access_token;
        
        // Get user info
        const userResponse = await axios.get('https://api.github.com/user', {
            headers: {
                'Authorization': `Bearer ${access_token}`
            }
        });
        
        req.session.user = {
            login: userResponse.data.login,
            name: userResponse.data.name,
            avatar_url: userResponse.data.avatar_url
        };
        
        safeLog('User authenticated:', req.session.user);
        
        // Redirect to success page
        res.redirect('/?auth=success');
        
    } catch (error) {
        console.error('OAuth error:', error.message);
        res.redirect('/?error=auth_failed');
    }
});

// Logout route
app.post('/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.json({ success: true });
    });
});

// Check auth status
app.get('/auth/status', (req, res) => {
    res.json({
        authenticated: !!req.session.accessToken,
        user: req.session.user || null
    });
});

// Enhanced repository fetching with authentication
async function fetchRepoData(owner, repo, accessToken = null) {
    try {
        const headers = {
            'Accept': 'application/vnd.github.v3+json'
        };
        
        if (accessToken) {
            headers['Authorization'] = `Bearer ${accessToken}`;
        }
        
        const [repoData, languages, contents, commits] = await Promise.all([
            axios.get(`https://api.github.com/repos/${owner}/${repo}`, { headers }),
            axios.get(`https://api.github.com/repos/${owner}/${repo}/languages`, { headers }),
            axios.get(`https://api.github.com/repos/${owner}/${repo}/contents`, { headers }).catch(() => ({ data: [] })),
            axios.get(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`, { headers }).catch(() => ({ data: [] }))
        ]);

        return {
            name: repoData.data.name,
            description: repoData.data.description,
            private: repoData.data.private,
            stars: repoData.data.stargazers_count,
            forks: repoData.data.forks_count,
            language: repoData.data.language,
            topics: repoData.data.topics || [],
            license: repoData.data.license?.name,
            languages: Object.keys(languages.data),
            files: contents.data.map(item => item.name),
            url: repoData.data.html_url,
            createdAt: repoData.data.created_at,
            updatedAt: repoData.data.updated_at,
            openIssues: repoData.data.open_issues_count,
            watchers: repoData.data.watchers_count,
            defaultBranch: repoData.data.default_branch,
            lastCommit: commits.data[0]?.commit?.message || 'No commits yet'
        };
    } catch (error) {
        // Enhanced error handling
        if (error.response?.status === 401) {
            throw new Error('Authentication expired. Please login again to access this repository.');
        } else if (error.response?.status === 403) {
            if (error.response.data?.message?.includes('rate limit')) {
                throw new Error('GitHub API rate limit exceeded. Please try again later.');
            }
            throw new Error('You do not have permission to access this repository.');
        } else if (error.response?.status === 404) {
            throw new Error('Repository not found. If this is a private repository, please login with GitHub.');
        }
        
        throw new Error(`Failed to fetch repository: ${error.message}`);
    }
}

// Updated generate README endpoint
app.post('/api/generate-readme', async (req, res) => {
    try {
        const { repoUrl } = req.body;
        
        if (!repoUrl) {
            return res.status(400).json({ error: 'Repository URL is required' });
        }

        // Parse GitHub URL
        const parsed = parseGitHubUrl(repoUrl);
        if (!parsed) {
            return res.status(400).json({ error: 'Invalid GitHub repository URL' });
        }

        // Use access token if authenticated
        const accessToken = req.session.accessToken || null;
        
        // Fetch repo data
        const repoData = await fetchRepoData(parsed.owner, parsed.repo, accessToken);
        
        // Generate README
        const readmeContent = await generateReadme(repoData);
        
        res.json({
            success: true,
            readme: readmeContent,
            repoData: {
                name: repoData.name,
                stars: repoData.stars,
                language: repoData.language,
                description: repoData.description,
                private: repoData.private,
                forks: repoData.forks
            }
        });

    } catch (error) {
        console.error('Error:', error.message);
        const statusCode = error.message.includes('Authentication') ? 401 : 
                           error.message.includes('rate limit') ? 429 : 
                           error.message.includes('not found') ? 404 : 500;
        
        res.status(statusCode).json({ 
            error: error.message,
            requiresAuth: error.message.includes('login') || error.message.includes('Authentication')
        });
    }
});

// List user's repositories (requires auth)
app.get('/api/repositories', requireAuth, async (req, res) => {
    try {
        const { type = 'all', sort = 'updated', per_page = 30, page = 1 } = req.query;
        
        const response = await axios.get('https://api.github.com/user/repos', {
            headers: {
                'Authorization': `Bearer ${req.session.accessToken}`
            },
            params: {
                type, // all, owner, public, private, member
                sort, // created, updated, pushed, full_name
                per_page,
                page
            }
        });
        
        const repos = response.data.map(repo => ({
            name: repo.name,
            full_name: repo.full_name,
            description: repo.description,
            private: repo.private,
            url: repo.html_url,
            language: repo.language,
            stars: repo.stargazers_count,
            updated_at: repo.updated_at
        }));
        
        res.json({
            repositories: repos,
            total: repos.length,
            page: parseInt(page),
            hasMore: repos.length === parseInt(per_page)
        });
        
    } catch (error) {
        if (error.response?.status === 401) {
            return res.status(401).json({ error: 'Authentication expired. Please login again.' });
        }
        console.error('Error fetching repositories:', error.message);
        res.status(500).json({ error: 'Failed to fetch repositories' });
    }
});

// Keep existing helper functions
function parseGitHubUrl(url) {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) return null;
    return { owner: match[1], repo: match[2].replace('.git', '') };
}

// Enhanced README generation for private repos
async function generateReadme(repoData) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    // Enhanced prompt for private repositories
    const prompt = `
    Generate a professional and comprehensive README.md file for a ${repoData.private ? 'PRIVATE' : 'PUBLIC'} GitHub repository with the following information:
    
    Repository Name: ${repoData.name}
    Description: ${repoData.description || 'No description provided'}
    Private Repository: ${repoData.private ? 'Yes' : 'No'}
    Main Language: ${repoData.language || 'Not specified'}
    All Languages: ${repoData.languages.join(', ') || 'Not specified'}
    Topics/Tags: ${repoData.topics.join(', ') || 'None'}
    Files in root directory: ${repoData.files.slice(0, 10).join(', ')}
    License: ${repoData.license || 'No license'}
    Stars: ${repoData.stars}
    Forks: ${repoData.forks}
    Open Issues: ${repoData.openIssues}
    Last Commit: ${repoData.lastCommit}
    
    ${repoData.private ? 'Since this is a PRIVATE repository, ensure the README includes appropriate security notices and access instructions.' : ''}
    
    Please generate a complete, professional README with ALL of these sections:
    1. Project Title with badges (including a "Private" badge if applicable)
    2. Description (comprehensive and detailed)
    3. ${repoData.private ? 'Access & Security Notice' : ''}
    4. Key Features
    5. Tech Stack
    6. Prerequisites
    7. Installation Guide
    8. Configuration (if applicable)
    9. Usage Examples
    10. Project Structure
    11. Contributing Guidelines
    12. License Information
    13. Contact/Support
    
    Use proper markdown formatting, emojis, and shields.io badges.
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error('Gemini API error:', error);
        return generateFallbackReadme(repoData);
    }
}

// Enhanced fallback function with all mandatory sections
function generateFallbackReadme(repoData) {
    const privateNotice = repoData.private ? `
## 🔒 Private Repository

This is a private repository. Access is restricted to authorized collaborators only.

` : '';

    // Ensure ALL mandatory sections are included
    const sections = {
        title: `# ${repoData.name} ${repoData.private ? '🔒' : ''}`,
        
        badges: `${repoData.private ? '![Private](https://img.shields.io/badge/Repository-Private-red)' : ''}
![GitHub stars](https://img.shields.io/badge/stars-${repoData.stars}-yellow)
![GitHub forks](https://img.shields.io/badge/forks-${repoData.forks}-blue)
![GitHub language](https://img.shields.io/badge/language-${repoData.language || 'Multiple'}-green)
![GitHub issues](https://img.shields.io/badge/issues-${repoData.openIssues}-orange)`,
        
        description: `## 📝 Description

${repoData.description || 'A GitHub repository that needs a description.'}

${privateNotice}`,
        
        features: `## ✨ Features

- Built with ${repoData.language || 'multiple languages'}
- ${repoData.stars} stars on GitHub
- Active development with ${repoData.forks} forks
- ${repoData.openIssues} open issues
- Last updated: ${new Date(repoData.updatedAt).toLocaleDateString()}
${repoData.topics.length > 0 ? `- Topics: ${repoData.topics.map(topic => `\`${topic}\``).join(', ')}` : ''}`,
        
        techStack: `## 🛠️ Tech Stack

${repoData.languages.length > 0 ? repoData.languages.map(lang => `- ${lang}`).join('\n') : `- ${repoData.language || 'Not specified'}`}`,
        
        prerequisites: `## 📋 Prerequisites

Before you begin, ensure you have met the following requirements:
- Git installed on your machine
- ${repoData.language === 'JavaScript' || repoData.languages.includes('JavaScript') ? 'Node.js and npm installed' : ''}
- ${repoData.language === 'Python' || repoData.languages.includes('Python') ? 'Python 3.x installed' : ''}
- ${repoData.language === 'Java' || repoData.languages.includes('Java') ? 'Java JDK installed' : ''}
- ${repoData.private ? 'Access permissions to this private repository' : ''}`,
        
        installation: `## 🚀 Installation

1. Clone the repository:
\`\`\`bash
git clone ${repoData.url}
cd ${repoData.name}
\`\`\`

2. Install dependencies:
\`\`\`bash
${repoData.language === 'JavaScript' || repoData.languages.includes('JavaScript') ? 'npm install' : ''}
${repoData.language === 'Python' || repoData.languages.includes('Python') ? 'pip install -r requirements.txt' : ''}
${repoData.language === 'Java' || repoData.languages.includes('Java') ? 'mvn install' : ''}
${!repoData.language ? '# Install dependencies based on your project type' : ''}
\`\`\``,
        
        usage: `## 💻 Usage

\`\`\`bash
${repoData.language === 'JavaScript' || repoData.languages.includes('JavaScript') ? 'npm start' : ''}
${repoData.language === 'Python' || repoData.languages.includes('Python') ? 'python main.py' : ''}
${repoData.language === 'Java' || repoData.languages.includes('Java') ? 'java -jar target/app.jar' : ''}
${!repoData.language ? '# Run the project based on your setup' : ''}
\`\`\``,
        
        projectStructure: `## 📁 Project Structure

\`\`\`
${repoData.name}/
${repoData.files.slice(0, 10).map(file => `├── ${file}`).join('\n')}
${repoData.files.length > 10 ? `└── ... and ${repoData.files.length - 10} more files` : ''}
\`\`\``,
        
        contributing: `## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create your feature branch (\`git checkout -b feature/AmazingFeature\`)
3. Commit your changes (\`git commit -m 'Add some AmazingFeature'\`)
4. Push to the branch (\`git push origin feature/AmazingFeature\`)
5. Open a Pull Request`,
        
        license: `## 📄 License

${repoData.license ? `This project is licensed under the ${repoData.license}.` : 'This project is not currently licensed.'}`,
        
        contact: `## 📧 Contact

- Repository: [${repoData.name}](${repoData.url})
- ${repoData.private ? 'This is a private repository. Contact the repository owner for access.' : ''}

---

<div align="center">
Generated with ❤️ by GitHub README Generator
</div>`
    };

    // Ensure we return ALL sections even if some data is missing
    return Object.values(sections).join('\n\n');
}

// This app.listen block will run locally, but Vercel will ignore it.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 GitHub README Generator Server`);
    console.log(`📡 Server running on http://localhost:${PORT}`);
    console.log(`🔑 OAuth configured: ${GITHUB_CLIENT_ID ? 'Yes ✅' : 'No ❌'}`);
    console.log(`🔑 Gemini API configured: ${process.env.GEMINI_API_KEY ? 'Yes ✅' : 'No ❌'}`);
    console.log(`🔑 Session Mode: ${process.env.NODE_ENV === 'production' ? 'Redis (Production)' : 'In-Memory (Development)'}`);
    console.log(`\n✨ Ready to generate READMEs for public and private repos!\n`);
});