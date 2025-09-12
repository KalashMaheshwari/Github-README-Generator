// Security: Override console methods to prevent accidental token logging
(function() {
    if (window.location.hostname !== 'localhost') {
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;
        
        const sanitize = (args) => {
            return args.map(arg => {
                if (typeof arg === 'string' && 
                    (arg.includes('ghp_') || 
                     arg.includes('gho_') || 
                     arg.includes('ghs_') ||
                     arg.toLowerCase().includes('token') ||
                     arg.toLowerCase().includes('secret'))) {
                    return '[REDACTED]';
                }
                if (typeof arg === 'object' && arg !== null) {
                    return JSON.parse(JSON.stringify(arg, (key, value) => {
                        if (key.toLowerCase().includes('token') || 
                            key.toLowerCase().includes('secret') ||
                            (typeof value === 'string' && value.includes('gh'))) {
                            return '[REDACTED]';
                        }
                        return value;
                    }));
                }
                return arg;
            });
        };
        
        console.log = function(...args) { originalLog.apply(console, sanitize(args)); };
        console.error = function(...args) { originalError.apply(console, sanitize(args)); };
        console.warn = function(...args) { originalWarn.apply(console, sanitize(args)); };
    }
})();

// State management
let currentReadme = '';
let currentRepoData = null;
let startTime = null;
let isAuthenticated = false;
let currentUser = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    initializeEventListeners();
    initializeAnimations();
    checkAuthStatus();
    handleAuthCallback();
});

// Initialize theme
function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    document.body.classList.add('no-transition');
    setTimeout(() => {
        document.body.classList.remove('no-transition');
    }, 100);
}

// Toggle theme
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    const button = document.querySelector('.theme-toggle');
    button.style.transform = 'scale(0.8) rotate(180deg)';
    setTimeout(() => {
        button.style.transform = '';
    }, 300);
}

// Initialize event listeners
function initializeEventListeners() {
    document.getElementById('repoUrl').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') generateReadme();
    });
    
    const rawTextarea = document.getElementById('rawText');
    if (rawTextarea) {
        rawTextarea.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = this.scrollHeight + 'px';
        });
    }
}

// Initialize animations
function initializeAnimations() {
    document.addEventListener('mousemove', (e) => {
        const x = (e.clientX / window.innerWidth - 0.5) * 20;
        const y = (e.clientY / window.innerHeight - 0.5) * 20;
        
        document.querySelector('.orb-1').style.transform = `translate(${x}px, ${y}px)`;
        document.querySelector('.orb-2').style.transform = `translate(${-x}px, ${-y}px)`;
    });
}

// Check authentication status with enhanced error handling
async function checkAuthStatus() {
    try {
        const response = await fetch('/auth/status', {
            credentials: 'include'
        });
        
        if (response.status === 401) {
            // Session expired
            isAuthenticated = false;
            currentUser = null;
            updateUIForAuth();
            showToast('Session expired. Please login again.', 'error');
            return;
        }
        
        const data = await response.json();
        isAuthenticated = data.authenticated;
        currentUser = data.user;
        updateUIForAuth();
        
    } catch (error) {
        console.error('Error checking auth status:', error);
        isAuthenticated = false;
        currentUser = null;
        updateUIForAuth();
    }
}

// Handle OAuth callback
function handleAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    
    if (urlParams.get('auth') === 'success') {
        showToast('successfully logged in with github', 'success');
        window.history.replaceState({}, document.title, window.location.pathname);
        checkAuthStatus();
    } else if (urlParams.get('error') === 'auth_failed') {
        showToast('authentication failed, please try again', 'error');
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get('error') === 'invalid_state') {
        showToast('invalid authentication state, please try again', 'error');
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

// Update UI based on auth status
function updateUIForAuth() {
    const userInfo = document.getElementById('userInfo');
    const browseBtn = document.getElementById('browseReposBtn');
    const loginBtn = document.getElementById('loginBtn');
    
    if (isAuthenticated && currentUser) {
        // Show user info, hide login button
        userInfo.classList.remove('hidden');
        document.getElementById('userAvatar').src = currentUser.avatar_url;
        document.getElementById('userName').textContent = currentUser.login;
        browseBtn.classList.remove('hidden');
        loginBtn.style.display = 'none'; // Hide login button
    } else {
        // Hide user info, show login button
        userInfo.classList.add('hidden');
        browseBtn.classList.add('hidden');
        loginBtn.style.display = 'flex'; // Show login button
    }
}

// Set example
function setExample(url) {
    const input = document.getElementById('repoUrl');
    input.value = url;
    input.focus();
    
    input.style.borderColor = 'var(--accent)';
    setTimeout(() => {
        input.style.borderColor = '';
    }, 500);
}

// Generate README with enhanced error handling
async function generateReadme() {
    const input = document.getElementById('repoUrl');
    let url = input.value.trim();
    
    if (!url) {
        showToast('please enter a repository url', 'error');
        input.focus();
        return;
    }
    
    if (!url.startsWith('http')) {
        url = `https://github.com/${url}`;
    }
    
    hideAllSections();
    showProcessing();
    updateStatus('processing');
    startTime = Date.now();
    
    try {
        const response = await fetch('/api/generate-readme', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repoUrl: url }),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            if (response.status === 401 || data.requiresAuth) {
                hideAllSections();
                updateStatus('error');
                showAuthPrompt();
                return;
            } else if (response.status === 429) {
                throw new Error('Rate limit exceeded. Please try again later.');
            }
            throw new Error(data.error || 'failed to generate readme');
        }
        
        currentReadme = data.readme;
        currentRepoData = data.repoData;
        
        showOutput(data);
        updateStatus('complete');
        
    } catch (error) {
        showError(error.message);
        updateStatus('error');
    }
}

// Show processing
function showProcessing() {
    document.getElementById('processing').classList.remove('hidden');
    
    const steps = ['step1', 'step2', 'step3'];
    steps.forEach((stepId, index) => {
        setTimeout(() => {
            const step = document.getElementById(stepId);
            step.classList.add('active');
            step.querySelector('.step-indicator').textContent = '●';
        }, index * 800);
    });
}

// Show output
function showOutput(data) {
    hideAllSections();
    
    const generationTime = ((Date.now() - startTime) / 1000).toFixed(1);
    
    const repoNameElement = document.getElementById('repoName');
    repoNameElement.innerHTML = data.repoData.name;
    
    if (data.repoData.private) {
        repoNameElement.innerHTML += '<span class="private-indicator"><i class="fas fa-lock"></i> Private</span>';
    }
    
    document.getElementById('generationTime').textContent = `${generationTime}s`;
    document.getElementById('repoStars').textContent = formatNumber(data.repoData.stars);
    document.getElementById('repoLanguage').textContent = data.repoData.language || 'multiple';
    
    displayReadme(data.readme);
    calculateQuality(data.readme);
    
    document.getElementById('output').classList.remove('hidden');
    
    setTimeout(() => {
        document.getElementById('output').scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
        });
    }, 100);
}

// Display README
function displayReadme(readme) {
    document.getElementById('renderedView').innerHTML = marked.parse(readme);
    
    const markdownCode = document.getElementById('markdownCode');
    markdownCode.textContent = readme;
    if (typeof hljs !== 'undefined') {
        hljs.highlightElement(markdownCode);
    }
    
    const rawText = document.getElementById('rawText');
    rawText.value = readme;
    rawText.style.height = 'auto';
    rawText.style.height = rawText.scrollHeight + 'px';
}

// Calculate quality
function calculateQuality(readme) {
    let score = 0;
    const items = [];
    
    if (readme.includes('##')) {
        score += 20;
        items.push({ icon: 'fa-heading', text: 'structured' });
    }
    
    if (readme.includes('```')) {
        score += 20;
        items.push({ icon: 'fa-code', text: 'code examples' });
    }
    
    if (readme.includes('![')) {
        score += 20;
        items.push({ icon: 'fa-image', text: 'badges' });
    }
    
    if (readme.toLowerCase().includes('installation')) {
        score += 20;
        items.push({ icon: 'fa-download', text: 'install guide' });
    }
    
    if (readme.length > 1500) {
        score += 20;
        items.push({ icon: 'fa-file-alt', text: 'comprehensive' });
    }
    
    document.getElementById('qualityScore').textContent = `${score}%`;
    setTimeout(() => {
        document.getElementById('qualityFill').style.width = `${score}%`;
    }, 100);
    
    const detailsHtml = items.map(item => `
        <div class="quality-item">
            <i class="fas ${item.icon}"></i>
            <span>${item.text}</span>
        </div>
    `).join('');
    
    document.getElementById('qualityDetails').innerHTML = detailsHtml;
}

// Set view
function setView(view) {
    document.querySelectorAll('.view-option').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    document.querySelectorAll('.readme-view').forEach(v => {
        v.classList.remove('active');
    });
    
    document.getElementById(`${view}View`).classList.add('active');
}

// Copy README
function copyReadme() {
    const textarea = document.createElement('textarea');
    textarea.value = currentReadme;
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    
    textarea.select();
    textarea.setSelectionRange(0, 99999);
    
    let copied = false;
    try {
        copied = document.execCommand('copy');
    } catch (err) {
        console.error('Copy failed:', err);
    }
    
    document.body.removeChild(textarea);
    
    let btn = event.target;
    if (!btn.classList.contains('action')) {
        btn = btn.closest('.action');
    }
    
    if (copied) {
        const originalContent = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i><span>copied!</span>';
        btn.style.background = 'var(--success)';
        btn.style.color = 'white';
        btn.style.borderColor = 'var(--success)';
        
        setTimeout(() => {
            btn.innerHTML = originalContent;
            btn.style.background = '';
            btn.style.color = '';
            btn.style.borderColor = '';
        }, 1500);
        
        showToast('readme copied to clipboard', 'success');
    } else {
        showToast('failed to copy - please try selecting and copying manually', 'error');
    }
}

// Download README
function downloadReadme() {
    const blob = new Blob([currentReadme], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'README.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('readme downloaded as README.md', 'success');
}

// Reset UI
function resetUI() {
    hideAllSections();
    document.getElementById('repoUrl').value = '';
    document.getElementById('repoUrl').focus();
    updateStatus('ready');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Retry generation
function retryGeneration() {
    hideAllSections();
    generateReadme();
}

// Show error
function showError(message) {
    hideAllSections();
    document.getElementById('errorText').textContent = message;
    document.getElementById('error').classList.remove('hidden');
}

// Hide all sections
function hideAllSections() {
    document.getElementById('processing').classList.add('hidden');
    document.getElementById('output').classList.add('hidden');
    document.getElementById('error').classList.add('hidden');
    
    document.querySelectorAll('.step').forEach(step => {
        step.classList.remove('active');
        step.querySelector('.step-indicator').textContent = '○';
    });
}

// Update status
function updateStatus(status) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    
    switch(status) {
        case 'ready':
            statusDot.style.background = 'var(--success)';
            statusText.textContent = 'ready';
            break;
        case 'processing':
            statusDot.style.background = 'var(--accent)';
            statusText.textContent = 'processing';
            break;
        case 'complete':
            statusDot.style.background = 'var(--success)';
            statusText.textContent = 'complete';
            break;
        case 'error':
            statusDot.style.background = 'var(--error)';
            statusText.textContent = 'error';
            break;
    }
}

// Show toast
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'fa-check-circle' : 
                 type === 'error' ? 'fa-exclamation-circle' : 
                 'fa-info-circle';
    
    toast.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>${message}</span>
    `;
    
    document.getElementById('toastContainer').appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slide-out 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Format number
function formatNumber(num) {
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
}

// Show about
function showAbout() {
    showToast('Made with ❤️ for developers', 'info');
}

// OAuth Functions
function loginWithGitHub() {
    window.location.href = '/auth/github';
}

async function logout() {
    try {
        const response = await fetch('/auth/logout', {
            method: 'POST',
            credentials: 'include'
        });
        
        if (response.ok) {
            isAuthenticated = false;
            currentUser = null;
            updateUIForAuth();
            showToast('logged out successfully', 'success');
        }
    } catch (error) {
        console.error('Logout error:', error);
        showToast('logout failed', 'error');
    }
}

function showAuthPrompt() {
    document.getElementById('authSection').classList.remove('hidden');
}

function closeAuthModal() {
    document.getElementById('authSection').classList.add('hidden');
}

async function openRepoBrowser() {
    document.getElementById('repoBrowser').classList.remove('hidden');
    await loadRepositories();
}

function closeRepoBrowser() {
    document.getElementById('repoBrowser').classList.add('hidden');
}

async function loadRepositories() {
    const repoList = document.getElementById('repoList');
    repoList.innerHTML = '<div class="loading">Loading repositories...</div>';
    
    try {
        const response = await fetch('/api/repositories?type=all&sort=updated&per_page=50', {
            credentials: 'include'
        });
        
        if (response.status === 401) {
            repoList.innerHTML = '<div class="error">Session expired. Please login again.</div>';
            setTimeout(() => {
                closeRepoBrowser();
                logout();
            }, 2000);
            return;
        }
        
        if (!response.ok) throw new Error('Failed to load repositories');
        
        const data = await response.json();
        displayRepositories(data.repositories);
        
    } catch (error) {
        console.error('Error loading repositories:', error);
        repoList.innerHTML = '<div class="error">Failed to load repositories</div>';
    }
}

function displayRepositories(repos) {
    const repoList = document.getElementById('repoList');
    
    if (repos.length === 0) {
        repoList.innerHTML = '<div class="empty">No repositories found</div>';
        return;
    }
    
    repoList.innerHTML = repos.map(repo => `
        <div class="repo-item" onclick="selectRepository('${repo.url}')">
            <div class="repo-info">
                <div class="repo-name">
                    ${repo.name}
                    ${repo.private ? '<span class="repo-private-badge">Private</span>' : ''}
                </div>
                ${repo.description ? `<div class="repo-description">${repo.description}</div>` : ''}
                <div class="repo-meta">
                    ${repo.language ? `<span><i class="fas fa-circle" style="color: var(--accent); font-size: 8px;"></i> ${repo.language}</span>` : ''}
                    <span><i class="fas fa-star"></i> ${repo.stars}</span>
                    <span><i class="fas fa-clock"></i> ${new Date(repo.updated_at).toLocaleDateString()}</span>
                </div>
            </div>
        </div>
    `).join('');
}

function selectRepository(url) {
    document.getElementById('repoUrl').value = url;
    closeRepoBrowser();
    generateReadme();
}

function filterRepos() {
    const filter = document.getElementById('repoFilter').value;
    const items = document.querySelectorAll('.repo-item');
    
    items.forEach(item => {
        const isPrivate = item.querySelector('.repo-private-badge');
        
        if (filter === 'all') {
            item.style.display = '';
        } else if (filter === 'private' && isPrivate) {
            item.style.display = '';
        } else if (filter === 'public' && !isPrivate) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });
}

function searchRepos() {
    const search = document.getElementById('repoSearch').value.toLowerCase();
    const items = document.querySelectorAll('.repo-item');
    
    items.forEach(item => {
        const name = item.querySelector('.repo-name').textContent.toLowerCase();
        const description = item.querySelector('.repo-description')?.textContent.toLowerCase() || '';
        
        if (name.includes(search) || description.includes(search)) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });
}

// Event listeners for closing modals
document.addEventListener('click', (e) => {
    const authSection = document.getElementById('authSection');
    if (e.target === authSection) {
        authSection.classList.add('hidden');
    }
    
    const repoBrowser = document.getElementById('repoBrowser');
    if (e.target === repoBrowser) {
        repoBrowser.classList.add('hidden');
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('authSection').classList.add('hidden');
        document.getElementById('repoBrowser').classList.add('hidden');
    }
    
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('repoUrl').focus();
    }
});

// Add CSS animation for slide-out
const style = document.createElement('style');
style.textContent = `
    @keyframes slide-out {
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);