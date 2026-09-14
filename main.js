import { WebContainer } from '@webcontainer/api';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

const terminalEl = document.getElementById('terminal');
const term = new Terminal({ convertEol: true });
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(terminalEl);
fitAddon.fit();

let webcontainerInstance;
let currentProcess;
let inputWriter;

async function boot() {
  term.write('Booting WebContainer...\r\n');
  try {
    webcontainerInstance = await WebContainer.boot();
    term.write('\x1b[32mReady!\x1b[0m Select a tool and tap Run.\r\n');
  } catch (err) {
    term.write(`\x1b[31mError:\x1b[0m ${err.message}\r\n`);
  }
}

async function runCli(command) {
  if (!webcontainerInstance) return;
  if (currentProcess) currentProcess.kill();
  
  term.write(`\r\n\x1b[33m$ npx ${command}\x1b[0m\r\n`);
  
  const parts = command.split(' ');
  currentProcess = await webcontainerInstance.spawn('npx', ['-y', ...parts]);
  
  currentProcess.output.pipeTo(new WritableStream({
    write(data) { term.write(data); }
  }));

  inputWriter = currentProcess.input.getWriter();
}

term.onData((data) => {
  if (inputWriter) inputWriter.write(data);
});

window.addEventListener('load', boot);
window.addEventListener('resize', () => fitAddon.fit());
document.getElementById('run-btn').addEventListener('click', () => {
  runCli(document.getElementById('cli-selector').value);
});
