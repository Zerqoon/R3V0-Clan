import test,{after,beforeEach} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Collection} from 'discord.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'r3v0-giveaway-v2-'));process.env.DATA_DIR=dir;
const {db,closeDb}=await import('../src/db.js');const {endGiveaway,rerollGiveawayCommand}=await import('../src/giveaways.js');const {processJob}=await import('../src/outbox.js');
after(()=>{closeDb();fs.rmSync(dir,{recursive:true,force:true});});beforeEach(()=>db.exec('DELETE FROM giveaway_entries;DELETE FROM giveaways;DELETE FROM outbox;'));
function fixture(){
 const now=Date.now();const state={failAnnouncement:false,memberFailure:false,sends:0};
 const id=Number(db.prepare("INSERT INTO giveaways(guild_id,channel_id,message_id,creator_id,prize,winners_count,ends_at,created_at) VALUES('g','c','message','staff','Huge Cat',1,?,?)").run(now-1000,now-100000).lastInsertRowid);
 for(const userId of ['a','b','c'])db.prepare('INSERT INTO giveaway_entries(giveaway_id,user_id,entered_at) VALUES(?,?,?)').run(id,userId,now);
 const members=new Map(['a','b','c'].map(id=>[id,{user:{id,bot:false,createdTimestamp:now-864000000},joinedTimestamp:now-864000000,roles:{cache:new Map()}}]));
 const all=new Collection();const message={id:'message',author:{id:'bot'},components:[],attachments:new Map(),edit:async payload=>{message.components=payload.components;return message;}};all.set(message.id,message);
 const channel={isTextBased:()=>true,messages:{fetch:async value=>typeof value==='string'?message:all},send:async payload=>{if(state.failAnnouncement)throw new Error('Announcement channel offline');state.sends++;const sent={id:`announcement-${state.sends}`,author:{id:'bot'},components:payload.components};all.set(sent.id,sent);return sent;}};
 const guild={id:'g',members:{cache:members,fetch:async id=>{if(state.memberFailure)throw new Error('Discord member API unavailable');return members.get(id);}}};const client={user:{id:'bot'},guilds:{cache:new Map([['g',guild]])},channels:{cache:new Map([['c',channel]])}};
 return {id,state,guild,client,members,interaction:{guildId:'g',guild,client,user:{id:'staff'},member:{roles:{cache:new Map()},permissions:{has:()=>true}}}};
}
test('winner delivery failure keeps a saved draw and a durable announcement job',async()=>{
 const f=fixture();f.state.failAnnouncement=true;const winners=await endGiveaway(f.client,f.id);assert.equal(winners.length,1);const saved=db.prepare('SELECT status,winners_json FROM giveaways WHERE id=?').get(f.id);assert.equal(saved.status,'ended');const job=db.prepare("SELECT * FROM outbox WHERE kind='giveaway-announcement'").get();assert.equal(job.status,'pending');f.state.failAnnouncement=false;await processJob(f.client,job.id,{force:true});assert.equal(db.prepare('SELECT winners_json FROM giveaways WHERE id=?').get(f.id).winners_json,saved.winners_json);assert.equal(f.state.sends,1);
});
test('a member lookup error aborts and retries a draw instead of excluding that player',async()=>{
 const f=fixture();f.members.delete('c');f.state.memberFailure=true;await assert.rejects(()=>endGiveaway(f.client,f.id),/unavailable/);assert.equal(db.prepare('SELECT status FROM giveaways WHERE id=?').get(f.id).status,'active');assert.equal(f.state.sends,0);
});
test('simultaneous rerolls produce one new saved winner and one announcement',async()=>{
 const f=fixture();await endGiveaway(f.client,f.id);const before=f.state.sends;const results=await Promise.all([rerollGiveawayCommand(f.interaction,String(f.id)),rerollGiveawayCommand(f.interaction,'message')]);assert.equal(results[0],results[1]);const winners=JSON.parse(db.prepare('SELECT winners_json FROM giveaways WHERE id=?').get(f.id).winners_json);assert.equal(winners.length,2);assert.equal(new Set(winners).size,2);assert.equal(f.state.sends,before+1);
});
