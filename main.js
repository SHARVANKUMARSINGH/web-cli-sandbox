import { WebContainer } from '@webcontainer/api';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import JSZip from 'jszip';

// DOM Elements
const screenLanding = document.getElementById('screen-landing');
const screenSetup = document.getElementById('screen-setup');
const workspace = document.getElementById('workspace');
const terminalEl = document.getElementById('terminal-container');
const chatHistory = document.getElementById('chat-history');
const vfsTree = document.getElementById('vfs-tree');

let webcontainerInstance;
let apiKey = '';
let projectFolder = '';

// Terminal Setup (Fixed font gaps)
const term = new Terminal({ 
  convertEol: true, 
  fontFamily: '"Fira Code", monospace, "Courier New"', 
  fontSize: 14,
  letterSpacing: 0,
  lineHeight: 1.2,
  cursorBlink: true,
  theme: { background: '#000000' } 
});
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

// UI Navigation
document.getElementById('start-btn').addEventListener('click', () => {
  screenLanding.classList.remove('active');
  screenSetup.classList.add('active');
});

document.getElementById('init-btn').addEventListener('click', async () => {
  apiKey = document.getElementById('api-key').value;
  projectFolder = document.getElementById('vfs-folder').value || 'my-app';
  if (!apiKey.startsWith('sk-or')) return alert('Please enter a valid OpenRouter key');

  screenSetup.classList.remove('active');
  workspace.style.display = 'flex';
  document.getElementById('workspace-title').innerText = `/${projectFolder}`;
  
  term.open(terminalEl);
  fitAddon.fit();
  
  await bootEnvironment();
});

// Boot Container & VFS Update
async function bootEnvironment() {
  term.write('Booting isolated Virtual File System...\r\n');
  webcontainerInstance = await WebContainer.boot();
  await webcontainerInstance.fs.mkdir(projectFolder);
  term.write('\x1b[32mEnvironment ready!\x1b[0m\r\n');
  updateVFS();
}

async function updateVFS() {
  vfsTree.innerHTML = '';
  const entries = await webcontainerInstance.fs.readdir(`/${projectFolder}`, { withFileTypes: true });
  for (const entry of entries) {
    const div = document.createElement('div');
    div.className = 'vfs-node';
    if (entry.isDirectory()) {
      div.innerHTML = `<i class="codicon codicon-folder" style="color:#eab308"></i> ${entry.name}`;
    } else {
      div.innerHTML = `<i class="codicon codicon-file"></i> ${entry.name}`;
    }
    vfsTree.appendChild(div);
  }
}

// Braille Spinner Logic
const brailleFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerInterval;

function setThinking(active) {
  if (active) {
    let idx = 0;
    const div = document.createElement('div');
    div.className = 'msg thinking';
    div.id = 'spinner-id';
    chatHistory.appendChild(div);
    
    spinnerInterval = setInterval(() => {
      div.innerText = `Thinking ${brailleFrames[idx]}`;
      idx = (idx + 1) % brailleFrames.length;
    }, 100);
  } else {
    clearInterval(spinnerInterval);
    document.getElementById('spinner-id')?.remove();
  }
}

// AI Integration & Action Parsing
async function callOpenRouter(prompt) {
  const isAutoFix = prompt.includes('failed with exit code');
  if (!isAutoFix) addChatMessage(prompt, 'user');
  
  document.getElementById('prompt-input').value = '';
  setThinking(true);
  
  const systemPrompt = `You are an AI coding assistant inside a WebContainer browser IDE.
The current project folder is /${projectFolder}.
To CREATE or EDIT a file, you MUST use exactly this format:
\`\`\`file:filename.ext
(code here)
\`\`\`
To RUN a COMMAND, you MUST use exactly this format:
\`\`\`command
(command here)
\`\`\`
Provide a brief conversational response before using the action blocks.`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "meta-llama/llama-3.1-8b-instruct",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }]
      })
    });

    const data = await response.json();
    setThinking(false);
    await processAIResponse(data.choices[0].message.content);
    
  } catch (error) {
    setThinking(false);
    addChatMessage(`Error calling AI: ${error.message}`, 'ai');
  }
}

// Parse Response & Render Badges
async function processAIResponse(text) {
  // Strip the action blocks to show the user just the clean chat text
  let cleanText = text.replace(/```file:[^\n]+\n[\s\S]*?```/g, '').replace(/```command\n[\s\S]*?```/g, '').trim();
  if (cleanText) addChatMessage(cleanText, 'ai');

  // 1. Process Files
  const fileRegex = /```file:([^\n]+)\n([\s\S]*?)```/g;
  let fileMatch;
  while ((fileMatch = fileRegex.exec(text)) !== null) {
    const fileName = fileMatch[1].trim();
    const content = fileMatch[2];
    const fullPath = `/${projectFolder}/${fileName}`;
    
    // Check if it's an edit to calculate lines
    let oldLines = 0;
    let isEdit = false;
    try {
      const existing = await webcontainerInstance.fs.readFile(fullPath, 'utf-8');
      oldLines = existing.split('\n').length;
      isEdit = true;
    } catch (e) {} // File doesn't exist yet

    // Write file to Virtual File System
    await webcontainerInstance.fs.writeFile(fullPath, content);
    
    const newLines = content.split('\n').length;
    const diff = newLines - oldLines;
    const addStr = diff >= 0 ? `+${diff}` : '0';
    const delStr = diff < 0 ? `${diff}` : '-0';

    // UI Badge
    const badge = document.createElement('div');
    badge.className = `action-badge ${isEdit ? 'edit' : 'create'}`;
    badge.innerHTML = `
      <i class="codicon codicon-${isEdit ? 'edit' : 'new-file'}"></i> 
      <div><b>${isEdit ? 'Edited' : 'Created'}</b> ${fileName}</div>
      ${isEdit ? `<div class="diff-text"><span class="diff-add">${addStr}</span> <span class="diff-del">${delStr}</span> lines</div>` : ''}
    `;
    chatHistory.appendChild(badge);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    
    updateVFS(); // Refresh sidebar
  }

  // 2. Process Commands
  const cmdRegex = /```command\n([\s\S]*?)```/g;
  let cmdMatch;
  while ((cmdMatch = cmdRegex.exec(text)) !== null) {
    const commandStr = cmdMatch[1].trim();
    
    const badge = document.createElement('div');
    badge.className = `action-badge run`;
    badge.innerHTML = `<i class="codicon codicon-terminal"></i> <div><b>Running command</b> <div class="sub-text">${commandStr}</div></div>`;
    chatHistory.appendChild(badge);
    chatHistory.scrollTop = chatHistory.scrollHeight;

    // Split args string safely
    const args = commandStr.match(/(?:[^\s"]+|"[^"]*")+/g).map(s => s.replace(/"/g, ''));
    const process = await webcontainerInstance.spawn(args[0], args.slice(1), { cwd: `/${projectFolder}` });
    
    let errorOutput = '';
    process.output.pipeTo(new WritableStream({
      write(data) { 
        term.write(data); 
        errorOutput += data; 
      }
    }));

    const exitCode = await process.exit;
    if (exitCode !== 0) {
      // Auto-Heal Trigger
      const errBadge = document.createElement('div');
      errBadge.className = `action-badge error`;
      errBadge.innerHTML = `<i class="codicon codicon-error"></i> <div><b>Error in command</b> <div class="sub-text">Don't worry, AI will fix it</div></div>`;
      chatHistory.appendChild(errBadge);
      chatHistory.scrollTop = chatHistory.scrollHeight;
      
      setTimeout(() => {
        callOpenRouter(`The command "${commandStr}" failed with exit code ${exitCode}. Error output:\n${errorOutput}\n\nPlease fix the files or provide the correct command.`);
      }, 2000);
    }
  }
}

// Download ZIP logic
document.getElementById('download-zip-btn').addEventListener('click', async () => {
  const zip = new JSZip();
  
  async function addFolder(dirPath, zipFolder) {
    const entries = await webcontainerInstance.fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = `${dirPath}/${entry.name}`;
      if (entry.isDirectory()) {
        await addFolder(fullPath, zipFolder.folder(entry.name));
      } else {
        const content = await webcontainerInstance.fs.readFile(fullPath);
        zipFolder.file(entry.name, content);
      }
    }
  }
  
  await addFolder(`/${projectFolder}`, zip);
  const blob = await zip.generateAsync({ type: "blob" });
  
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${projectFolder}.zip`;
  a.click();
});

function addChatMessage(text, sender) {
  const div = document.createElement('div');
  div.className = `msg ${sender}`;
  div.innerText = text;
  chatHistory.appendChild(div);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

// Global UI Listeners
document.getElementById('send-btn').addEventListener('click', () => {
  const prompt = document.getElementById('prompt-input').value;
  if (prompt) callOpenRouter(prompt);
});

document.getElementById('toggle-term-btn').addEventListener('click', () => {
  const t = terminalEl.style;
  t.display = t.display === 'none' ? 'block' : 'none';
  fitAddon.fit();
});

window.addEventListener('resize', () => fitAddon.fit());
