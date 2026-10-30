import test,{after,beforeEach} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'r3v0-links-'));process.env.DATA_DIR=dir;
const {db,closeDb}=await import('../src/db.js');const {beginAccountLink,verifyAccountLink,getAccountLink,unlinkAccount,buildLinkChallengePayload}=await import('../src/account-links.js');
after(()=>{closeDb();fs.rmSync(dir,{recursive:true,force:true});});beforeEach(()=>db.exec('DELETE FROM account_links;DELETE FROM link_challenges;DELETE FROM outbox;'));
const resolve=async()=>({id:123,name:'Player_123',description:''});
test('a fresh profile code verifies exact Roblox ownership and is consumed once',async()=>{
 const c=await beginAccountLink('guild','discord','Player_123',{resolve});assert.match(c.code,/^R3V0-[A-F0-9]{24}$/);
 const link=await verifyAccountLink('guild','discord',{fetchProfile:async id=>({id,name:'Player_123',description:`About me\n${c.code}\nR3V0`})});assert.equal(link.robloxId,'123');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM link_challenges').get().n,0);
 await assert.rejects(()=>verifyAccountLink('guild','discord',{fetchProfile:resolve}),/expired/);assert.equal(buildLinkChallengePayload(c).embeds,undefined);
});
test('a code copied to the wrong user ID cannot verify',async()=>{
 const c=await beginAccountLink('g','d','Player_123',{resolve});await assert.rejects(()=>verifyAccountLink('g','d',{fetchProfile:async()=>({id:999,description:c.code})}),/exact code/);assert.equal(getAccountLink('g','d'),null);
});
test('missing or partial profile code fails and repeated checks are throttled',async()=>{
 const c=await beginAccountLink('g','d','Player_123',{resolve});await assert.rejects(()=>verifyAccountLink('g','d',{fetchProfile:async()=>({id:123,description:`X${c.code}X`})}),/exact code/);
 await assert.rejects(()=>verifyAccountLink('g','d',{fetchProfile:resolve}),/five seconds/);
});
test('expired challenges cannot link an account',async()=>{
 const c=await beginAccountLink('g','d','Player_123',{resolve});await assert.rejects(()=>verifyAccountLink('g','d',{now:c.expiresAt+1,fetchProfile:resolve}),/expired/);
});
test('one Roblox account cannot be linked to two Discord users',async()=>{
 const a=await beginAccountLink('g','a','Player_123',{resolve}),b=await beginAccountLink('g','b','Player_123',{resolve});
 await verifyAccountLink('g','a',{fetchProfile:async()=>({id:123,description:a.code,name:'Player_123'})});
 await assert.rejects(()=>verifyAccountLink('g','b',{fetchProfile:async()=>({id:123,description:b.code,name:'Player_123'})}),/already been connected/);
});
test('a challenge replaced during an API request cannot authorize the old code',async()=>{
 const c=await beginAccountLink('g','d','Player_123',{resolve});await assert.rejects(()=>verifyAccountLink('g','d',{fetchProfile:async()=>{await beginAccountLink('g','d','Player_123',{resolve,now:Date.now()+61000});return {id:123,description:c.code};}}),/replaced/);assert.equal(getAccountLink('g','d'),null);
});
test('stale unlink confirmations cannot disconnect a different verification',async()=>{
 const c=await beginAccountLink('g','d','Player_123',{resolve});const link=await verifyAccountLink('g','d',{fetchProfile:async()=>({id:123,name:'Player_123',description:c.code})});assert.throws(()=>unlinkAccount('g','d',link.verifiedAt-1),/no longer current/);assert.ok(getAccountLink('g','d'));unlinkAccount('g','d',link.verifiedAt);assert.equal(getAccountLink('g','d'),null);
});
