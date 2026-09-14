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
const modelSelector = document.getElementById('model-selector');
const promptInput = document.getElementById('prompt-input');

let webcontainerInstance;
let apiKey = '';
let projectFolder = '';
let selectedAiModel = 'meta-llama/llama-3.1-8b-instruct:free';

// Load Free Models from OpenRouter API
async function loadFreeModels() {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    const data = await res.json();
    const freeModels = data.data.filter(m => m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0);
    
    modelSelector.innerHTML = freeModels.map(m => 
      `<option value="${m.id}">${m.name} (Free)</option>`
    ).join('');
    
    const gemini = freeModels.find(m => m.id.includes('gemini-2.5-flash'));
    if (gemini) modelSelector.value = gemini.id;
  } catch (error) {
    modelSelector.innerHTML = '<option value="meta-llama/llama-3.1-8b-instruct:free">Llama 3.1 8B (Fallback)</option>';
  }
}
window.addEventListener('load', loadFreeModels);

// Terminal Setup
const term = new Terminal({ 
  convertEol: true, 
  fontFamily: '"Fira Code", monospace, "Courier New"', 
  fontSize: 13,
  letterSpacing: 0,
  theme: { background: '#000000' } 
});
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

// UI Navigation
document.getElementById('start-btn').addEventListener('click', () => {
  screenLanding.classList.remove('active');
  screenSetup.classList.add('active');
});

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    
    const target = btn.getAttribute('data-target');
    btn.classList.add('active');
    document.getElementById(target).classList.add('active');
    
    if (target === 'panel-terminal') fitAddon.fit();
  });
});

document.getElementById('init-btn').addEventListener('click', async () => {
  apiKey = document.getElementById('api-key').value.trim();
  projectFolder = document.getElementById('vfs-folder').value.trim() || 'my-app';
  selectedAiModel = modelSelector.value || 'meta-llama/llama-3.1-8b-instruct:free';
  
  if (!apiKey.startsWith('sk-or')) return alert('Please enter a valid OpenRouter key starting with sk-or');

  screenSetup.classList.remove('active');
  workspace.style.display = 'flex';
  document.getElementById('workspace-title').innerText = `/${projectFolder}`;
  
  term.open(terminalEl);
  fitAddon.fit();
  await bootEnvironment();
});

async function bootEnvironment() {
  term.write('\x1b[1;36m<System>\x1b[0m Booting Virtual File System...\r\n');
  webcontainerInstance = await WebContainer.boot();
  await webcontainerInstance.fs.mkdir(projectFolder);
  term.write('\x1b[1;32m<System>\x1b[0m Environment ready!\r\n');
  updateVFS();
}

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

const brailleFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerInterval;

function setThinking(active) {
  if (active) {
    // Prevent multiple spinners if you click Send twice
    if (document.getElementById('spinner-id')) return;
    let idx = 0;
    const div = document.createElement('div');
    div.className = 'msg thinking';
    div.id = 'spinner-id';
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    
    spinnerInterval = setInterval(() => {
      div.innerText = `Thinking ${brailleFrames[idx]}`;
      idx = (idx + 1) % brailleFrames.length;
    }, 100);
  } else {
    clearInterval(spinnerInterval);
    const spinner = document.getElementById('spinner-id');
    if (spinner) spinner.remove();
  }
}

async function callOpenRouter(prompt) {
  const isAutoFix = prompt.includes('failed with exit code');
  if (!isAutoFix) addChatMessage(prompt, 'user');
  
  promptInput.value = '';
  setThinking(true);
  
  const systemPrompt = `You are an expert, autonomous AI coding assistant running inside a WebContainer environment.
WORKSPACE DIR: /${projectFolder}
CRITICAL INSTRUCTIONS - YOU MUST FOLLOW STRICT FORMATTING:
1. NEVER output naked code. YOU MUST ALWAYS USE THE EXACT FILE BLOCK FORMAT to create/edit files.
2. FILE FORMAT (To write/edit a file, output this exact structure):
\`\`\`file:src/App.js
console.log("hello");
\`\`\`
3. COMMAND FORMAT (To run a terminal command, output this exact structure):
\`\`\`command
npm install react
\`\`\`
If you do not use these exact blocks, the system will fail. Create necessary subfolders automatically.`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${apiKey}`, 
        "Content-Type": "application/json",
        // THESE TWO HEADERS ARE CRITICAL FOR OPENROUTER
        "HTTP-Referer": window.location.href,
        "X-Title": "Web IDE Sandbox"
      },
      body: JSON.stringify({
        model: selectedAiModel,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }]
      })
    });

    const data = await response.json();
    setThinking(false);

    // Explicitly catch and show API errors (like bad keys or rate limits)
    if (data.error) {
      return addChatMessage(`<b>API Error:</b> ${data.error.message}`, 'ai');
    }
    if (!data.choices || !data.choices[0]) {
      return addChatMessage(`<b>Error:</b> Unexpected API response structure.`, 'ai');
    }

    await processAIResponse(data.choices[0].message.content);
  } catch (error) {
    setThinking(false);
    addChatMessage(`<b>Network Error:</b> ${error.message} (Check your connection or API key)`, 'ai');
  }
}

async function ensureDirExists(filePath) {
  const parts = filePath.split('/');
  parts.pop();
  let currentPath = `/${projectFolder}`;
  
  for (const part of parts) {
    currentPath += `/${part}`;
    try {
      await webcontainerInstance.fs.mkdir(currentPath);
    } catch (e) {}
  }
}

async function processAIResponse(text) {
  let cleanText = text.replace(/```file:[^\n]+\n[\s\S]*?```/g, '').replace(/```command\n[\s\S]*?```/g, '').trim();
  if (cleanText) addChatMessage(cleanText, 'ai');

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

  const cmdRegex = /```command\n([\s\S]*?)```/g;
  let cmdMatch;
  while ((cmdMatch = cmdRegex.exec(text)) !== null) {
    const commandStr = cmdMatch[1].trim();
    
    const badge = document.createElement('div');
    badge.className = `action-badge run`;
    badge.innerHTML = `<i class="codicon codicon-terminal"></i> <div><b>Running command</b> <div class="sub-text">${commandStr}</div></div>`;
    chatHistory.appendChild(badge);
    chatHistory.scrollTop = chatHistory.scrollHeight;

    term.write(`\r\n\x1b[1;35m🤖 <Ai Executing>:\x1b[0m \x1b[1;36m${commandStr}\x1b[0m\r\n`);
    term.write(`\x1b[1;33m💻 <Terminal Output>:\x1b[0m\r\n`);

    const args = commandStr.match(/(?:[^\s"]+|"[^"]*")+/g).map(s => s.replace(/"/g, ''));
    const process = await webcontainerInstance.spawn(args[0], args.slice(1), { cwd: `/${projectFolder}` });
    
    const inputWriter = process.input.getWriter();
    let processOutput = '';
    let stallTimer;

    process.output.pipeTo(new WritableStream({
      write(data) { 
        term.write(data); 
        processOutput += data; 
        
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          const lowerOut = processOutput.toLowerCase();
          if (lowerOut.includes('y/n') || lowerOut.includes('ok to proceed') || lowerOut.includes('(y)')) {
            term.write('\r\n\x1b[1;33m🤖 <Ai Auto-Heal>: Detected stalled prompt. Typing "y" and proceeding...\x1b[0m\r\n');
            inputWriter.write('y\r');
          }
        }, 4000);
      }
    }));

    const exitCode = await process.exit;
    clearTimeout(stallTimer);
    inputWriter.releaseLock();
    
    if (exitCode !== 0) {
      const errBadge = document.createElement('div');
      errBadge.className = `action-badge error`;
      errBadge.innerHTML = `<i class="codicon codicon-error"></i> <div><b>Error in command</b> <div class="sub-text">Don't worry, AI will fix it</div></div>`;
      chatHistory.appendChild(errBadge);
      
      setTimeout(() => {
        callOpenRouter(`The command "${commandStr}" failed with exit code ${exitCode}. Error output:\n${processOutput}\n\nPlease fix the files or provide the correct command.`);
      }, 2000);
    }
  }
}

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
  div.innerHTML = text; 
  chatHistory.appendChild(div);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

document.getElementById('send-btn').addEventListener('click', () => {
  const prompt = promptInput.value;
  if (prompt) callOpenRouter(prompt);
});

// Added: Pressing Enter on mobile keyboards now automatically sends the message
promptInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    const prompt = promptInput.value;
    if (prompt) callOpenRouter(prompt);
  }
});

window.addEventListener('resize', () => fitAddon.fit());
