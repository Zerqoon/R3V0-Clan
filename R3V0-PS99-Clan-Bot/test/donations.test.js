import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawnSync} from 'node:child_process';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'r3v0-donations-v2-'));process.env.DATA_DIR=dir;
const {db,closeDb}=await import('../src/db.js');
const {extractDiamondContributions,observeDiamondContributions:observe,recordDonationReceipt:receipt,getDonationSummary}=await import('../src/donations.js');
after(()=>{closeDb();fs.rmSync(dir,{recursive:true,force:true});});
beforeEach(()=>db.exec('DELETE FROM outbox; DELETE FROM donation_receipts; DELETE FROM donation_ledger; DELETE FROM gem_counters; DELETE FROM settings;'));
const raw=(values={123:100},created=10)=>({Name:'R3V0',Created:created,DepositedDiamonds:2,DiamondContributions:{AllTime:{Sum:Object.values(values).reduce((a,b)=>a+b,0),Data:Object.entries(values).map(([UserID,Diamonds])=>({UserID,Diamonds}))}}});
test('reads the actual nested R3V0 AllTime.Data format and separates balance from lifetime donations',()=>{
 const live={Name:'R3V0',Created:1789457781,DepositedDiamonds:901175000,DiamondContributions:{AllTime:{Sum:1513000000,Data:[{UserID:1308591016,Diamonds:1508000000},{UserID:10061439495,Diamonds:5000000}]}}};
 const result=observe(live,[]);assert.equal(result.source,'DiamondContributions.AllTime.Data');assert.equal(result.baselines,2);assert.equal(result.events.length,0);
 const summary=getDonationSummary();assert.equal(summary.total,1513000000);assert.equal(summary.balance,901175000);assert.equal(summary.donors.length,2);assert.equal(summary.observedAmount,0);
});
test('an increase is recorded once across duplicate and unchanged snapshots',()=>{
 observe(raw());assert.equal(observe(raw({123:150})).events[0].amount,50);assert.equal(observe(raw({123:150})).events.length,0);
 assert.equal(getDonationSummary().observedAmount,50);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE kind='donation-log'").get().n,1);
});
test('a new donor appearing after a complete baseline is detected from zero',()=>{
 observe(raw());const result=observe(raw({123:100,456:6000}));assert.equal(result.events.length,1);assert.equal(result.events[0].userId,'456');assert.equal(result.events[0].amount,6000);
});
test('an empty complete baseline detects the first later clan donation',()=>{observe(raw({}));assert.equal(observe(raw({123:700})).events[0].amount,700);});
test('counter regression and rebound never duplicate credited gems',()=>{
 observe(raw());observe(raw({123:150}));assert.equal(observe(raw({123:90})).regressions,1);assert.equal(observe(raw({123:150})).events.length,0);observe(raw({123:170}));assert.equal(getDonationSummary().observedAmount,70);
});
test('a missing table or balance movement cannot create or reset donations',()=>{
 observe(raw());assert.equal(observe({Name:'R3V0',Created:10,DepositedDiamonds:999999}).available,false);assert.equal(observe(raw()).events.length,0);assert.equal(getDonationSummary().observedAmount,0);
});
test('a recreated clan gets its own baseline rather than crediting old history',()=>{observe(raw());const result=observe(raw({123:50000},11));assert.equal(result.events.length,0);assert.equal(result.baselines,1);});
test('rejects other clans and never treats battle Points as diamonds',()=>{
 assert.throws(()=>observe({...raw(),Name:'OTHER'}),/not the R3V0/);const parsed=extractDiamondContributions({Name:'R3V0',DiamondContributions:[{UserID:123,Points:100}]});assert.equal(parsed.rows.length,0);assert.equal(parsed.rejected,1);
});
test('unknown first-seen historical counters in an incomplete table remain baselines',()=>{
 const x=raw();delete x.DiamondContributions.AllTime.Sum;observe(x);const y=raw({123:100,456:50000});delete y.DiamondContributions.AllTime.Sum;assert.equal(observe(y).events.length,0);
});
test('receipts are idempotent, conflict-safe and excluded from confirmed totals',()=>{
 observe(raw());const data={eventId:'test-a',robloxUserId:'123',username:'Alpha',amount:50};const a=receipt(data),b=receipt(data);assert.equal(a.id,b.id);assert.equal(b.duplicate,true);assert.equal(getDonationSummary().observedAmount,0);
 assert.throws(()=>receipt({...data,amount:99}),/different receipt/);assert.throws(()=>receipt({...data,eventId:''}),/eventId/);
 observe(raw({123:150}));assert.equal(getDonationSummary().observedAmount,50);assert.equal(db.prepare('SELECT status FROM donation_receipts WHERE id=?').get(a.id).status,'covered_by_api');
});
test('ledger, high water and delivery queue roll back together on a failed insert',()=>{
 observe(raw());db.exec("CREATE TRIGGER fail_delivery BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END;");
 assert.throws(()=>observe(raw({123:150})),/simulated/);assert.equal(getDonationSummary().observedAmount,0);assert.equal(db.prepare('SELECT high_water FROM gem_counters').get().high_water,100);
 db.exec('DROP TRIGGER fail_delivery');assert.equal(observe(raw({123:150})).events.length,1);
});
test('a new process reuses stored counters and does not redetect the same deposit',()=>{
 observe(raw());observe(raw({123:150}));
 const script=`import {observeDiamondContributions} from './src/donations.js';import {closeDb} from './src/db.js';console.log('RESULT:'+JSON.stringify(observeDiamondContributions(${JSON.stringify(raw({123:150}))}).events));closeDb();`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,DATA_DIR:dir}});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/RESULT:\[\]/);assert.equal(getDonationSummary().observedAmount,50);
});
