const fs=require('fs');
const p='src/tests/createReadSmoke.spec.ts';
const data=fs.readFileSync(p,'utf8');
console.log(data.includes('synthetic meta-scan marker')?'HAS_MARKER':'NO_MARKER');
console.log(data.slice(-120));
