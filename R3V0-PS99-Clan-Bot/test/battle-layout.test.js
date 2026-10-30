import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBattleDashboardModel, buildBattlePageDescription } from '../src/battle-layout.js';

function roster(count = 23) {
  return Array.from({length:count}, (_,i) => ({userId:String(i+1),username:`Member_${i+1}`,points:10000-i*100,pointsKnown:true,isOwner:i===1}));
}
test('podium and rows contain each page member exactly once and all pages cover the roster', () => {
  const clan={members:roster(),totalBattlePoints:900000};
  const first=buildBattleDashboardModel(clan,0);
  assert.deepEqual(first.podium.map(m=>m.clanRank),[1,2,3]);
  assert.deepEqual(first.rows.map(m=>m.clanRank),[4,5,6,7,8,9,10]);
  const all=[];
  for(let page=0;page<first.pages;page++){
    const model=buildBattleDashboardModel(clan,page);
    const shown=[...model.podium,...model.rows];
    assert.equal(new Set(shown.map(m=>m.userId)).size,shown.length);
    all.push(...shown.map(m=>m.userId));
  }
  assert.equal(all.length,23);
  assert.equal(new Set(all).size,23);
  assert.equal(buildBattleDashboardModel(clan,999).page,2);
});
test('unknown scores stay unknown, zero-point members remain visible and ties have stable order', () => {
  const clan={members:[
    {userId:'a',username:'Unknown',points:0,pointsKnown:false},
    {userId:'b',username:'Zero',points:0,pointsKnown:true},
    {userId:'c',username:'FirstTie',points:100},
    {userId:'d',username:'SecondTie',points:100},
    {userId:'e',username:'Missing'},
  ]};
  const model=buildBattleDashboardModel(clan);
  assert.deepEqual(model.members.map(m=>m.userId),['c','d','b','a','e']);
  assert.equal(model.members[2].points,0);
  assert.equal(model.members[3].points,null);
  assert.equal(model.members[3].rosterShare,null);
  assert.equal(model.reportedMembers,3);
  assert.equal(model.scoringMembers,2);
  assert.equal(model.totalPoints,null,'a missing official total is never replaced with an invented total');
  assert.equal(model.clanRank,null);
});
test('roster shares use current known member scores rather than a possibly different official clan total', () => {
  const model=buildBattleDashboardModel({members:[{username:'A',points:300},{username:'B',points:100},{username:'C',pointsKnown:false}],totalBattlePoints:1000});
  assert.equal(model.totalPoints,1000);
  assert.equal(model.reportedMemberTotal,400);
  assert.equal(model.members[0].rosterShare,.75);
  assert.equal(model.members[1].rosterShare,.25);
  assert.equal(model.members[2].rosterShare,null);
});
test('empty and entirely unreported rosters never receive a fake podium or percentages', () => {
  const empty=buildBattleDashboardModel({members:[]});
  assert.equal(empty.pages,1);
  assert.equal(empty.podium.length,0);
  const unknown=buildBattleDashboardModel({members:roster(12).map(m=>({...m,pointsKnown:false}))});
  assert.equal(unknown.podium.length,0);
  assert.equal(unknown.rows.length,10);
  assert.ok(unknown.rows.every(m=>m.rosterShare===null));
});
test('details preserve exact values, underscores, leader labels and unknown-score wording', () => {
  const clan={members:[{username:'Member_1',points:120000,isOwner:true},{username:'Unknown_2',pointsKnown:false}]};
  const text=buildBattlePageDescription(clan).description;
  assert.match(text,/120,000/);
  assert.match(text,/Leader/);
  assert.match(text,/Member\\_1/);
  assert.match(text,/Not reported/);
});
