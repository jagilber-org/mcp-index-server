import { startTransport } from './transport';
import '../services/toolHandlers';

export function main(){
  startTransport();
}

if(require.main === module){
  main();
}
