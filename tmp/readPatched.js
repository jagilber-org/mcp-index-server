require('../src/tests/setupDistReady.ts');
const fs=require('fs');
const p=require('path').join(process.cwd(),'src','tests','createReadSmoke.spec.ts');
const data=fs.readFileSync(p,'utf8');
console.log(data.includes('synthetic meta-scan marker')?'HAS_MARKER':'NO_MARKER');
