import { createInterface } from 'readline';

export function startTransport(){
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'server/ready', params: { version: '0.1.0' } }) + '\n');
  rl.on('line', line => {
    if(line.trim() === 'quit') process.exit(0);
  });
}

if(require.main === module){
  startTransport();
}
