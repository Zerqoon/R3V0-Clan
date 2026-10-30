import fs from 'node:fs';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
// Offline tool: stop the bot first. A running process can keep writing its WAL.
const args=process.argv.slice(2),source=args.find(value=>!value.startsWith('--'));
if(!source||!args.includes('--bot-stopped')){console.error('Usage: npm run restore -- /absolute/backup.sqlite --bot-stopped\nStop the bot before restoring.');process.exit(1);}
const directory=path.resolve(process.env.DATA_DIR||'/app/data'),input=path.resolve(source),target=path.join(directory,'r3v0-clan-bot.sqlite');
if(input===target)throw new Error('Choose a separate backup file, not the live database.');
const original=new DatabaseSync(input,{readOnly:true});
const check=original.prepare('PRAGMA integrity_check').get();if(check.integrity_check!=='ok')throw new Error('The backup failed its integrity check.');
if(!original.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get())throw new Error('This is not an R3V0 backup.');
fs.mkdirSync(directory,{recursive:true});const temporary=path.join(directory,`restore-${Date.now()}.sqlite`);
original.exec(`VACUUM INTO '${temporary.replace(/'/g,"''")}'`);original.close();
const copy=new DatabaseSync(temporary,{readOnly:true});if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Restored copy failed validation.');copy.close();
const recovery=path.join(directory,`before-restore-${Date.now()}`);fs.mkdirSync(recovery);
for(const suffix of ['','-wal','-shm'])if(fs.existsSync(target+suffix))fs.renameSync(target+suffix,path.join(recovery,path.basename(target+suffix)));
fs.renameSync(temporary,target);console.log(`Backup restored. Previous database files retained in ${recovery}. Restart the bot.`);
