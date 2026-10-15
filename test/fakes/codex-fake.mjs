// Imita `codex exec - --json --output-schema f -o saida.json ...` para os testes.
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const saida = args[args.indexOf('-o') + 1];
let entrada = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (entrada += c));
process.stdin.on('end', () => {
  const prompt = entrada.trim();
  if (prompt === 'RATE_LIMIT') {
    process.stdout.write(JSON.stringify({ type: 'error', message: "You've hit your usage limit. Try again at 15:00." }) + '\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 't1' }) + '\n');
  writeFileSync(saida, JSON.stringify({ resposta: `ECO: ${prompt}` }));
  process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: {} }) + '\n');
});
