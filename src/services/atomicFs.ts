import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export function atomicWriteJson(filePath: string, obj: unknown){
  const dir = path.dirname(filePath);
  if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  const tmp = path.join(dir, `.${path.basename(filePath)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const data = JSON.stringify(obj,null,2);
  fs.writeFileSync(tmp, data, 'utf8');
  // fs.rename is atomic on same filesystem
  fs.renameSync(tmp, filePath);
}
