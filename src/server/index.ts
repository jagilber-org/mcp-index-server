import { startTransport } from './transport';

export function main(){
  startTransport();
}

if(require.main === module){
  main();
}
