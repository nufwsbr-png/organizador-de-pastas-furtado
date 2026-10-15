// Imita `claude -p --output-format json --json-schema ...` para os testes.
let entrada = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (entrada += c));
process.stdin.on('end', () => {
  const prompt = entrada.trim();
  if (prompt === 'RATE_LIMIT') {
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: "You've hit your usage limit. Resets at 3pm" }));
    process.exit(1);
  }
  if (prompt === 'AUTH') {
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Not logged in · Please run /login' }));
    process.exit(1);
  }
  if (prompt === 'ERRO') {
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, result: 'Algo deu errado' }));
    process.exit(1);
  }
  process.stdout.write(
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'texto', structured_output: { resposta: `ECO: ${prompt}` }, session_id: 'abc' }),
  );
});
