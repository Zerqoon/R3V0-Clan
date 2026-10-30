import test,{after,beforeEach} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Collection,ChannelType} from 'discord.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'r3v0-tickets-v2-'));process.env.DATA_DIR=dir;
const {db,closeDb,getTicket}=await import('../src/db.js');const {config}=await import('../src/config.js');
const {createTicket,closeTicket,recoverTicketReservations,handleTicketComponent,buildTicketMessagePayload}=await import('../src/ticket-system.js');const {processJob}=await import('../src/outbox.js');
after(()=>{closeDb();fs.rmSync(dir,{recursive:true,force:true});});beforeEach(()=>db.exec('DELETE FROM ticket_transcripts;DELETE FROM ticket_reservations;DELETE FROM tickets;DELETE FROM outbox;'));
function fixture(){
 let next=1569000000000000000n;const state={failArchive:false,failTranscript:false,ambiguousCreate:false,forbidden:false};const all=new Collection();
 const client={user:{id:'1569000000000000999'},channels:{cache:new Map(),fetch:async id=>all.get(id)},guilds:{cache:new Map()}};
 function channel(id,name){const messages=new Collection();return {id,name,type:ChannelType.GuildText,attachments:new Map(),messages:{fetch:async arg=>{if(typeof arg==='string'){const m=messages.get(arg);if(!m)throw Object.assign(new Error('Unknown message'),{code:10008});return m;}if(state.failTranscript&&name.startsWith('ticket-'))throw new Error('Transcript page unavailable');return new Collection([...messages].reverse());}},isTextBased:()=>true,permissionOverwrites:{edit:async()=>{}},send:async payload=>{if(state.failArchive&&id===config.channels.ticketLogs)throw new Error('Archive delivery unavailable');const m={id:String(next++),author:{id:client.user.id,tag:'Bot'},createdTimestamp:Date.now(),content:payload.content||'',components:payload.components||[],embeds:[],attachments:new Map(),flags:{has:()=>true},edit:async updated=>{m.components=updated.components;return m;}};messages.set(m.id,m);return m;},delete:async()=>{all.delete(id);client.channels.cache.delete(id);}};}
 const log=channel(config.channels.ticketLogs,'ticket-archives');all.set(log.id,log);client.channels.cache.set(log.id,log);
 const category={id:config.channels.ticketCategory,type:ChannelType.GuildCategory};all.set(category.id,category);
 const guild={id:'1569000000000000002',roles:{everyone:{id:'1569000000000000002'},cache:new Map()},channels:{fetch:async id=>{if(id===undefined)return all;if(state.forbidden&&id!==category.id)throw Object.assign(new Error('Missing access'),{code:50001});return all.get(id)||null;},create:async data=>{await new Promise(resolve=>setTimeout(resolve,3));const c=channel(String(next++),data.name);c.topic=data.topic;all.set(c.id,c);client.channels.cache.set(c.id,c);if(state.ambiguousCreate)throw new Error('Create response timed out');return c;}}};client.guilds.cache.set(guild.id,guild);
 const interaction={guild,guildId:guild.id,client,user:{id:'1569000000000000888',username:'Applicant',tag:'Applicant'}};
 return {state,client,guild,interaction,all};
}
test('concurrent applications create one channel and one active database row',async()=>{
 const f=fixture();const result=await Promise.allSettled([createTicket(f.interaction,'clan',{roblox:'Applicant'}),createTicket(f.interaction,'clan',{roblox:'Applicant'})]);assert.equal(result.filter(item=>item.status==='fulfilled').length,1);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE status='open'").get().n,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ticket_reservations').get().n,0);
});
test('a missing category releases the reservation without creating a ticket',async()=>{const f=fixture();f.all.delete(config.channels.ticketCategory);await assert.rejects(()=>createTicket(f.interaction),/category/);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ticket_reservations').get().n,0);});
test('an ambiguous create is recovered by its durable topic token after restart',async()=>{
 const f=fixture();f.state.ambiguousCreate=true;await assert.rejects(()=>createTicket(f.interaction,'clan',{roblox:'Applicant'}),/timed out/);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n,0);await recoverTicketReservations(f.client,{startup:true});assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ticket_reservations').get().n,0);
});
test('failed transcript delivery keeps the source channel and closing status, then retries safely',async()=>{
 const f=fixture();const c=await createTicket(f.interaction);f.state.failArchive=true;await closeTicket(f.client,f.guild,c.id,f.interaction.user,'Finished');assert.equal(getTicket(c.id).status,'closing');assert.ok(f.all.has(c.id));assert.ok(db.prepare('SELECT body FROM ticket_transcripts WHERE channel_id=?').get(c.id));
 const job=db.prepare("SELECT id FROM outbox WHERE kind='ticket-close'").get();f.state.failArchive=false;assert.equal(await processJob(f.client,job.id,{force:true}),true);assert.equal(getTicket(c.id).status,'closed');assert.ok(f.all.has(c.id));
 const deletion=db.prepare("SELECT id FROM outbox WHERE kind='ticket-delete'").get();await processJob(f.client,deletion.id,{force:true});assert.equal(f.all.has(c.id),false);assert.equal(await processJob(f.client,job.id,{force:true}),false);
});
test('a failed transcript page is not mistaken for an empty successful archive',async()=>{
 const f=fixture();const c=await createTicket(f.interaction);f.state.failTranscript=true;await closeTicket(f.client,f.guild,c.id,f.interaction.user,'Finished');assert.equal(getTicket(c.id).status,'closing');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ticket_transcripts').get().n,0);assert.ok(f.all.has(c.id));
});
test('missing access to an existing ticket never silently marks it orphaned',async()=>{
 const f=fixture();const c=await createTicket(f.interaction);f.state.forbidden=true;await assert.rejects(()=>createTicket(f.interaction),/Missing access/);assert.equal(getTicket(c.id).status,'open');
});
test('the database rejects a second active ticket even if application guards are bypassed',async()=>{
 const f=fixture();await createTicket(f.interaction);assert.throws(()=>db.prepare('INSERT INTO tickets(channel_id,guild_id,opener_id,type,created_at) VALUES(?,?,?,?,?)').run('new',f.guild.id,f.interaction.user.id,'clan',Date.now()),/active ticket/);
});
test('non-staff cannot claim or decide a ticket',async()=>{
 const f=fixture();const c=await createTicket(f.interaction);const interaction={...f.interaction,channelId:c.id,member:{roles:{cache:new Map()},permissions:{has:()=>false}},customId:`ticket:claim:${c.id}`};await assert.rejects(()=>handleTicketComponent(interaction),/Only recruitment staff/);assert.equal(getTicket(c.id).claimedBy,null);
});
test('ticket controls are nested inside a V2 card and never offer trial states',()=>{
 const payload=buildTicketMessagePayload({guildId:'1',openerId:'2',channelId:'3',type:'clan',status:'open',decision:'review',createdAt:Date.now(),applicationJson:'{}'});const json=payload.components[0].toJSON();assert.equal(json.type,17);assert.equal(payload.embeds,undefined);const ids=json.components.flatMap(item=>item.components||[]).filter(item=>item.custom_id).map(item=>item.custom_id);assert.ok(ids.some(id=>id.includes(':accepted')));assert.ok(ids.some(id=>id.includes(':rejected')));assert.ok(ids.some(id=>id.includes(':waiting')));assert.doesNotMatch(JSON.stringify(json),/probation|trial period/i);
});
