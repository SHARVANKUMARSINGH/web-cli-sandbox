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

// Terminal Setup (Monospace, no gaps)
const term = new Terminal({ 
  convertEol: true, 
  fontFamily: '"Fira Code", monospace, "Courier New"', 
  fontSize: 13,
  letterSpacing: 0,
  theme: { background: '#000000' } 
});
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

// UI Navigation & Tabs
document.getElementById('start-btn').addEventListener('click', () => {
  screenLanding.classList.remove('active');
  screenSetup.classList.add('active');
});

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    // Reset all tabs
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    
    // Activate clicked tab
    const target = btn.getAttribute('data-target');
    btn.classList.add('active');
    document.getElementById(target).classList.add('active');
    
    if (target === 'panel-terminal') fitAddon.fit();
  });
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

// Boot Container & VFS Setup
async function bootEnvironment() {
  term.write('\x1b[1;36m<System>\x1b[0m Booting isolated Virtual File System...\r\n');
  webcontainerInstance = await WebContainer.boot();
  await webcontainerInstance.fs.mkdir(projectFolder);
  term.write('\x1b[1;32m<System>\x1b[0m Environment ready!\r\n');
  updateVFS();
}

// Recursive function to build nested folder UI
async function buildTree(path, container, padding = 0) {
  const entries = await webcontainerInstance.fs.readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const div = document.createElement('div');
    div.className = 'vfs-node';
    div.style.paddingLeft = `${padding}px`;
    
    if (entry.isDirectory()) {
      div.innerHTML = `<i class="codicon codicon-folder" style="color:#eab308"></i> <b>${entry.name}</b>`;
      container.appendChild(div);
      await buildTree(`${path}/${entry.name}`, container, padding + 15);
    } else {
      div.innerHTML = `<i class="codicon codicon-file" style="color:#6b7280"></i> ${entry.name}`;
      container.appendChild(div);
    }
  }
}

async function updateVFS() {
  vfsTree.innerHTML = '';
  await buildTree(`/${projectFolder}`, vfsTree, 5);
}

// Braille Spinner
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

// OpenRouter API
async function callOpenRouter(prompt) {
  const isAutoFix = prompt.includes('failed with exit code');
  if (!isAutoFix) addChatMessage(prompt, 'user');
  
  document.getElementById('prompt-input').value = '';
  setThinking(true);
  
  const systemPrompt = `You are an AI coding assistant inside a WebContainer IDE.
The current project folder is /${projectFolder}.
You CAN create nested subfolders (e.g., src/components/App.js).
To CREATE or EDIT a file, use EXACTLY this format:
\`\`\`file:path/to/filename.ext
(code here)
\`\`\`
To RUN a COMMAND, use EXACTLY this format:
\`\`\`command
(command here)
\`\`\``;

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
    addChatMessage(`Error: ${error.message}`, 'ai');
  }
}

// Ensure subdirectories exist before writing files
async function ensureDirExists(filePath) {
  const parts = filePath.split('/');
  parts.pop(); // Remove the file name
  let currentPath = `/${projectFolder}`;
  
  for (const part of parts) {
    currentPath += `/${part}`;
    try {
      await webcontainerInstance.fs.mkdir(currentPath);
    } catch (e) {
      // Directory already exists, ignore error
    }
  }
}

// Parse Response
async function processAIResponse(text) {
  let cleanText = text.replace(/```file:[^\n]+\n[\s\S]*?```/g, '').replace(/```command\n[\s\S]*?```/g, '').trim();
  if (cleanText) addChatMessage(cleanText, 'ai');

  // 1. Process Files (with nested folders)
  const fileRegex = /```file:([^\n]+)\n([\s\S]*?)```/g;
  let fileMatch;
  while ((fileMatch = fileRegex.exec(text)) !== null) {
    const filePath = fileMatch[1].trim();
    const content = fileMatch[2];
    const fullPath = `/${projectFolder}/${filePath}`;
    
    await ensureDirExists(filePath);
    
    let isEdit = false;
    try {
      await webcontainerInstance.fs.readFile(fullPath, 'utf-8');
      isEdit = true;
    } catch (e) {}

    await webcontainerInstance.fs.writeFile(fullPath, content);
    
    const badge = document.createElement('div');
    badge.className = `action-badge ${isEdit ? 'edit' : 'create'}`;
    badge.innerHTML = `<i class="codicon codicon-${isEdit ? 'edit' : 'new-file'}"></i> <div><b>${isEdit ? 'Edited' : 'Created'}</b> ${filePath}</div>`;
    chatHistory.appendChild(badge);
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }
  updateVFS();

  // 2. Process Commands (with Colored Terminal Logging)
  const cmdRegex = /```command\n([\s\S]*?)```/g;
  let cmdMatch;
  while ((cmdMatch = cmdRegex.exec(text)) !== null) {
    const commandStr = cmdMatch[1].trim();
    
    const badge = document.createElement('div');
    badge.className = `action-badge run`;
    badge.innerHTML = `<i class="codicon codicon-terminal"></i> <div><b>Running command</b> <div class="sub-text">${commandStr}</div></div>`;
    chatHistory.appendChild(badge);
    chatHistory.scrollTop = chatHistory.scrollHeight;

    // Output beautifully colored headers to the Terminal
    term.write(`\r\n\x1b[1;35m🤖 <Ai Executing>:\x1b[0m \x1b[1;36m${commandStr}\x1b[0m\r\n`);
    term.write(`\x1b[1;33m💻 <Terminal Output>:\x1b[0m\r\n`);

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
      const errBadge = document.createElement('div');
      errBadge.className = `action-badge error`;
      errBadge.innerHTML = `<i class="codicon codicon-error"></i> <div><b>Error in command</b> <div class="sub-text">Don't worry, AI will fix it</div></div>`;
      chatHistory.appendChild(errBadge);
      
      setTimeout(() => {
        callOpenRouter(`The command "${commandStr}" failed with exit code ${exitCode}. Error output:\n${errorOutput}\n\nPlease fix the files or provide the correct command.`);
      }, 2000);
    }
  }
}

// Download Recursive ZIP
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

document.getElementById('send-btn').addEventListener('click', () => {
  const prompt = document.getElementById('prompt-input').value;
  if (prompt) callOpenRouter(prompt);
});
window.addEventListener('resize', () => fitAddon.fit());
