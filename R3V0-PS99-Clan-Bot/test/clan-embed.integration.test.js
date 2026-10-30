import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'r3v0-native-battle-'));
process.env.DATA_DIR=dir;
const {buildLeaderboardPayload,buildBattleDetailsPayload}=await import('../src/monitor.js');
const {closeDb}=await import('../src/db.js');
const {ComponentType,MessageFlags}=await import('discord.js');
after(()=>{closeDb();fs.rmSync(dir,{recursive:true,force:true});});
const clan={activeBattle:'FantasyBattle2026',updatedAt:Date.now(),totalBattlePoints:850000,memberCapacity:50,battleFinishTime:Math.floor(Date.now()/1000)+86400,
  members:Array.from({length:23},(_,i)=>({userId:String(i+1),username:i===1?'B3STTIEE':`Member_${i+1}`,points:68000-i*1200,pointsKnown:true,isOwner:i===1}))};
function walk(components){
 return components.flatMap(component=>{const node=component.toJSON?.()||component;return [node,...walk(node.components||[]),...(node.accessory?walk([node.accessory]):[])];});
}
function text(payload){return walk(payload.components).filter(c=>c.type===ComponentType.TextDisplay).map(c=>c.content).join('\n');}
function buttons(payload){return walk(payload.components).filter(c=>c.type===ComponentType.Button);}

test('all Clan Battle scores and names are native Discord text, with only original art attachments',async()=>{
 const {payload,page}=await buildLeaderboardPayload(clan,0);
 assert.equal(page,0);
 assert.equal(payload.flags,MessageFlags.IsComponentsV2);
 assert.equal(payload.embeds,undefined);
 assert.equal(payload.components.length,2);
 assert.deepEqual(payload.files.map(f=>f.name),['r3v0-banner.png','r3v0-logo.png']);
 for(const file of payload.files){assert.equal(typeof file.attachment,'string');assert.ok(fs.existsSync(file.attachment));}
 assert.deepEqual(payload.allowedMentions,{parse:[]});
 const all=walk(payload.components), content=text(payload);
 assert.ok(all.length<=40,'native message stays within the Discord component budget');
 assert.match(content,/850,000 points/);
 assert.match(content,/68,000 points/);
 assert.match(content,/B3STTIEE/);
 assert.match(content,/23\/23/);
 assert.match(content,/Battle ends.*<t:\d+:R>/);
 assert.match(content,/Member\\_10/);
 assert.doesNotMatch(content,/Member\\_11/);
 assert.equal(all.filter(c=>c.type===ComponentType.MediaGallery).length,1);
 assert.equal(all.find(c=>c.type===ComponentType.MediaGallery).items[0].media.url,'attachment://r3v0-banner.png');
 assert.deepEqual(buttons(payload).map(b=>b.custom_id),['clan:profile:self','clan:ranking:total:0','clan:goals:0','clan:history:0']);
 assert.equal(buttons(payload)[1].disabled,undefined);
});
test('details contain the same page, exact scores and honest unavailable metadata',()=>{
 const payload=buildBattleDetailsPayload(clan,1),json=payload.embeds[0].toJSON();
 assert.match(json.description,/Member\\_11/);
 assert.doesNotMatch(json.description,/Member\\_1\*\*/);
 assert.match(json.footer.text,/Page 2\/3/);
 assert.equal(json.fields.find(f=>f.name==='Total points').value,'850,000');
 assert.match(json.fields.find(f=>f.name.includes('Clan rank')).value,/Not reported/);
 assert.deepEqual(payload.allowedMentions,{parse:[]});
});
test('a single-page native board has unique IDs and opens private views',async()=>{
 const {payload}=await buildLeaderboardPayload({members:[],updatedAt:Date.now()});
 const all=buttons(payload);
 assert.equal(new Set(all.map(b=>b.custom_id)).size,all.length);
 assert.equal(all[1].custom_id,'clan:ranking:total:0');
});
test('native ranking keeps reported zero scores and distinguishes unknown results in text',async()=>{
 const {payload}=await buildLeaderboardPayload({members:[{username:'KnownZero',points:0},{username:'Unknown',pointsKnown:false}],totalBattlePoints:null});
 const content=text(payload);
 assert.match(content,/KnownZero.*\*\*0\*\* pts.*0\.0%/);
 assert.match(content,/Unknown.*Not reported.*—/);
 assert.match(content,/Battle points not reported/);
});
