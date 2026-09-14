import { WebContainer } from '@webcontainer/api';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

// UI Elements
const screenLanding = document.getElementById('screen-landing');
const screenSetup = document.getElementById('screen-setup');
const workspace = document.getElementById('workspace');
const terminalEl = document.getElementById('terminal-container');
const chatHistory = document.getElementById('chat-history');

// State
let webcontainerInstance;
let currentProcess;
let apiKey = '';
let projectFolder = '';

// Terminal Setup
const term = new Terminal({ convertEol: true, theme: { background: '#000' } });
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

// 1. Navigation Flow
document.getElementById('start-btn').addEventListener('click', () => {
  screenLanding.classList.remove('active');
  screenSetup.classList.add('active');
});

document.getElementById('init-btn').addEventListener('click', async () => {
  apiKey = document.getElementById('api-key').value;
  projectFolder = document.getElementById('vfs-folder').value || 'my-app';
  
  if (!apiKey.startsWith('sk-or')) {
    alert('Please enter a valid OpenRouter API key');
    return;
  }

  screenSetup.classList.remove('active');
  workspace.style.display = 'flex';
  document.getElementById('workspace-title').innerText = `/${projectFolder}`;
  
  term.open(terminalEl);
  fitAddon.fit();
  
  await bootEnvironment();
});

// 2. Boot WebContainer & Create Virtual File System
async function bootEnvironment() {
  term.write('Booting isolated Virtual File System...\r\n');
  try {
    webcontainerInstance = await WebContainer.boot();
    term.write('\x1b[32mEnvironment ready!\x1b[0m\r\n');
    
    // Create the custom folder the user requested
    await webcontainerInstance.fs.mkdir(projectFolder);
    term.write(`Created directory: /${projectFolder}\r\n`);
    
  } catch (err) {
    term.write(`\x1b[31mError:\x1b[0m ${err.message}\r\n`);
  }
}

// 3. OpenRouter API Chat Integration
async function callOpenRouter(prompt) {
  // Add user message to UI
  addChatMessage(prompt, 'user');
  document.getElementById('prompt-input').value = '';
  
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": window.location.href, // Required by OpenRouter for browser calls
        "X-Title": "Web IDE Agent"
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.1-8b-instruct", // Fast, free fallback model. Change to Claude/Qwen if preferred.
        messages: [
          { role: "system", content: `You are an AI developer agent running inside a browser WebContainer. The user's workspace is /${projectFolder}. Provide code, or specify npm commands to run.` },
          { role: "user", content: prompt }
        ]
      })
    });

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;
    addChatMessage(aiResponse, 'ai');

  } catch (error) {
    addChatMessage(`Error calling OpenRouter: ${error.message}`, 'ai');
  }
}

// 4. UI Helpers
function addChatMessage(text, sender) {
  const div = document.createElement('div');
  div.className = `msg ${sender}`;
  // Basic formatting for code blocks in chat
  div.innerText = text; 
  chatHistory.appendChild(div);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

// Event Listeners for Chat and Terminal
document.getElementById('send-btn').addEventListener('click', () => {
  const prompt = document.getElementById('prompt-input').value;
  if (prompt) callOpenRouter(prompt);
});

document.getElementById('toggle-term-btn').addEventListener('click', () => {
  terminalEl.classList.toggle('show');
  fitAddon.fit();
});

window.addEventListener('resize', () => fitAddon.fit());
