import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComponentType } from 'discord.js';
import { db, setSetting, recordSnapshot } from '../src/db.js';
import { config } from '../src/config.js';
import { storeClanObservation, setBattleGoal } from '../src/clan-store.js';
import { buildProfilePayload, buildRankingPayload, buildGoalsPayload, buildHistoryPayload, buildSeasonPayload, buildStaffPayload, buildDiagnosticsPayload } from '../src/clan-views.js';
import { buildTicketMessagePayload, ticketApplicationModal } from '../src/ticket-system.js';
import { buildLinkChallengePayload, accountLinkModal } from '../src/account-links.js';
import { observeDiamondContributions, buildDonationsPayload, buildDonationLogPayload } from '../src/donations.js';
import { card, text, button as uiButton, row, v2, form } from '../src/ui.js';
import { buildLeaderboardPayload, buildBattleDetailsPayload } from '../src/monitor.js';
import { buildTicketPanelPayload } from '../src/tickets.js';
import { buildGiveawayPayload } from '../src/giveaways.js';
import { buildFarmPointsEmbed } from '../src/farm-points.js';
import { buildRulesEmbed } from '../src/rules.js';
import { buildGuessPetComponents } from '../src/commands.js';
import { normalizePsxPage, comparePsxNeighbours } from '../src/psx-classic.js';
import { buildPsxLeaderboardPayload, buildPsxPointsPayload } from '../src/psx-views.js';
import { renderPsxLeaderboard, renderPsxPoints } from '../src/psx-canvas.js';
import { psxFindModal } from '../src/psx-commands.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const localImage = file => path.relative(path.join(root, 'preview'), file).split(path.sep).join('/');
function relativeTime(seconds) {
  const delta = Number(seconds) * 1000 - Date.now(), absolute = Math.abs(delta);
  const [unit, amount] = absolute < 60000 ? ['second', Math.max(1, Math.round(absolute / 1000))] : absolute < 3600000 ? ['minute', Math.round(absolute / 60000)] : absolute < 86400000 ? ['hour', Math.round(absolute / 3600000)] : ['day', Math.round(absolute / 86400000)];
  const label = `${amount} ${unit}${amount === 1 ? '' : 's'}`;
  return absolute < 5000 ? 'a moment ago' : delta > 0 ? `in ${label}` : `${label} ago`;
}
function markdown(value) {
  return html(value)
    .replace(/&lt;t:(\d+):([RFf])&gt;/g, (_, seconds, mode) => mode === 'R' ? relativeTime(seconds) : new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(Number(seconds) * 1000)))
    .replace(/&lt;@&amp;\d+&gt;/g, '<span class="mention">@Clan Member</span>')
    .replace(/&lt;@\d+&gt;/g, '<span class="mention">@SampleMember</span>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .split('\n').map(line => {
      if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`;
      if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
      if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`;
      if (line.startsWith('-# ')) return `<small>${line.slice(3)}</small>`;
      return `${line}<br>`;
    }).join('').replace(/\\_/g, '_');
}
function attachmentMap(files = []) {
  return Object.fromEntries(files.map(file => [file.name, typeof file.attachment === 'string' ? localImage(file.attachment) : `data:image/png;base64,${Buffer.from(file.attachment).toString('base64')}`]));
}
function media(url, files) { return url?.startsWith('attachment://') ? files[url.slice(13)] : null; }
function button(node) {
  return `<button type="button" data-custom-id="${html(node.custom_id || '')}" class="button style-${node.style}" ${node.disabled ? 'disabled' : ''}>${html(node.emoji?.name || '')}${node.emoji ? ' ' : ''}${html(node.label)}</button>`;
}
function component(node, files) {
  switch (node.type) {
    case ComponentType.Container: return `<article class="container" style="--accent:#${node.accent_color.toString(16).padStart(6, '0')}">${node.components.map(child => component(child, files)).join('')}</article>`;
    case ComponentType.TextDisplay: return `<div class="text">${markdown(node.content)}</div>`;
    case ComponentType.Separator: return '<hr>';
    case ComponentType.Section: return `<div class="section"><div>${node.components.map(child => component(child, files)).join('')}</div>${node.accessory?.type === ComponentType.Button ? button(node.accessory) : node.accessory?.type === ComponentType.Thumbnail ? `<img class="thumbnail" alt="Original R3V0 logo" src="${media(node.accessory.media.url, files) || ''}">` : ''}</div>`;
    case ComponentType.MediaGallery: return node.items.map(item => `<img class="banner" alt="${html(item.description)}" src="${media(item.media.url, files) || ''}">`).join('');
    case ComponentType.ActionRow: return `<div class="buttons">${node.components.map(child => component(child, files)).join('')}</div>`;
    case ComponentType.Button: return button(node);
    case ComponentType.StringSelect: return `<select data-custom-id="${html(node.custom_id)}" aria-label="${html(node.placeholder)}">${node.options.map(option=>`<option value="${html(option.value)}" ${option.default?'selected':''}>${html(option.label)}</option>`).join('')}</select>`;
    case ComponentType.File: return `<div class="file">📄 Saved transcript attachment</div>`;
    default: return '';
  }
}
function embed(node, files) {
  return `<article class="container embed" style="--accent:#${(node.color || 0x9858f5).toString(16).padStart(6, '0')}">
    ${node.author ? `<div class="author">${html(node.author.name)}</div>` : ''}
    <h2>${html(node.title)}</h2><div class="text">${markdown(node.description || '')}</div>
    <div class="fields">${(node.fields || []).map(field => `<div class="field ${field.inline ? 'inline' : ''}"><strong>${html(field.name)}</strong><div>${markdown(field.value)}</div></div>`).join('')}</div>
    ${node.image ? `<img class="banner" alt="Clan artwork" src="${media(node.image.url, files) || ''}">` : ''}
    ${node.footer ? `<small class="footer">${html(node.footer.text)}</small>` : ''}
  </article>`;
}
function payloadContent(payload) {
  const files = attachmentMap(payload.files);
  return (payload.embeds || []).map(builder => embed(builder.toJSON(), files)).join('') + (payload.components || []).map(builder => component(builder.toJSON(), files)).join('');
}
export async function createInterfacePreview() {
  const now = Date.now(), user = '1569000000000000888';
  const points = [93475,90025,60450,42300,40150,34500,34225,28550,25975,9450,6000,4500,3300,2500,1500,1025];
  const names = ['walczakulus1111','B3STTIEE','crystianoronaldo555','klapec2','Mekz26','kakaloakahuq','QUBIX1002','lkpit67380','MrMat1ks','manday3016'];
  const members = points.map((score,i)=>({userId:String(1000+i),username:names[i]||`ExampleMember_${i+1}`,points:score,pointsKnown:true,isOwner:i===1}));
  const clan = {name:'R3V0',activeBattleId:'FantasyBattle2026',activeBattle:'FantasyBattle2026',members,totalBattlePoints:477925,memberCapacity:50,battleRankAvailable:false,updatedAt:now,battleFinishTime:Math.floor(now/1000)+86400};
  storeClanObservation(clan);
  db.prepare('INSERT INTO account_links VALUES(?,?,?,?,?)').run(config.guildId,user,'1001','B3STTIEE',now-86400000);
  for(let i=0;i<=24;i++) recordSnapshot({battleId:clan.activeBattleId,capturedAt:now-(24-i)*3600000,userId:'1001',username:'B3STTIEE',points:45000+Math.floor(i/24*45025)});
  setBattleGoal({battleId:clan.activeBattleId,target:600000,actorId:'staff',clan});
  setBattleGoal({battleId:clan.activeBattleId,userId:'1001',target:110000,actorId:'staff',clan});
  const gems = amount=>({Name:'R3V0',Created:123,DepositedDiamonds:901175000,DiamondContributions:{AllTime:{Sum:1508000000+amount,Data:[{UserID:1001,Diamonds:1508000000},{UserID:1000,Diamonds:amount}]}}});
  observeDiamondContributions(gems(5000000),members,now-60000);observeDiamondContributions(gems(5025000),members,now);
  const ticket = {channelId:'1569000000000000123',guildId:config.guildId,openerId:user,type:'clan',status:'open',decision:'review',claimedBy:null,createdAt:now-120000,applicationJson:JSON.stringify({roblox:'B3STTIEE',rank:'40',huges:'48',passes:'Magic Eggs, Super Drops, Huge Hunter',activity:'Evenings and weekends. Screenshots attached for staff review.'})};
  const challenge = {username:'ExamplePlayer',robloxId:'1001',code:'R3V0-DEMO-ONLY',expiresAt:now+1200000};
  const giveaway = {id:42,prize:'Huge Cat',description:'A reward for our clan community.',status:'active',winnersCount:1,endsAt:now+86400000,createdAt:now,minMessages:10,minAccountAgeDays:7,minServerAgeDays:2};
  fs.mkdirSync(path.join(root,'preview'),{recursive:true});
  const psxRaw = JSON.parse(fs.readFileSync(path.join(root,'test/fixtures/psx-classic-live.json'),'utf8')).data;
  const psxBoard = {...normalizePsxPage(psxRaw,1),receivedAt:now,cacheFallback:false,preview:true};
  const nearbyScores = [54600,54100,53700,53129,52800,52480];
  const psxRows = nearbyScores.map((points,i)=>({rank:589+i,userId:i===3?'1308591016':String(9000+i),username:i===3?'B3sttiee':`ExamplePlayer_${589+i}`,points}));
  const psxResult = {found:true,userId:'1308591016',entry:psxRows[3],source:'live',board:{...psxBoard,updatedAt:Math.floor(now/1000)},receivedAt:now,cacheFallback:false,...comparePsxNeighbours(psxRows[3],psxRows)};
  fs.writeFileSync(path.join(root,'preview/psx-leaderboard.png'),await renderPsxLeaderboard(psxBoard));
  fs.writeFileSync(path.join(root,'preview/psx-points.png'),await renderPsxPoints(psxResult));
  const sections = [
    ['battle','01 / Clan Battle',(await buildLeaderboardPayload(clan)).payload],
    ['recruitment','02 / Recruitment',buildTicketPanelPayload()],
    ['ticket','03 / Open application',buildTicketMessagePayload(ticket)],
    ['profile','04 / Verified profile',buildProfilePayload(config.guildId,user,clan)],
    ['treasury','05 / Clan treasury',buildDonationsPayload()],
    ['staff','06 / Staff control',buildStaffPayload()],
    ['giveaway','07 / Clan rewards',buildGiveawayPayload(giveaway,27)],
    ['donation','08 / Detected contribution',buildDonationLogPayload(db.prepare('SELECT * FROM donation_ledger LIMIT 1').get())],
    ['verification','09 / Profile verification',buildLinkChallengePayload(challenge)],
    ['farm','10 / Battle field guide',{embeds:[buildFarmPointsEmbed()]}],
    ['rules','11 / Clan code',{embeds:[buildRulesEmbed()],files:[{name:'r3v0-rules.png',attachment:path.join(root,'assets/r3v0-banner.png')}]}],
    ['arcade','12 / Guess Pet',buildGuessPetComponents({expiresAt:now+75000,imageUrl:null,hint:'H___ C__',nextHintAt:now+12000})],
    ['psx-ranking','13 / PSX Classic · public leaderboard',{...buildPsxLeaderboardPayload(psxBoard,{imageUrl:'attachment://psx-leaderboard.png'}),files:[{name:'psx-leaderboard.png',attachment:path.join(root,'preview/psx-leaderboard.png')}]}],
    ['psx-points','14 / PSX Classic · points and next player',{...buildPsxPointsPayload(psxResult,{}, {imageUrl:'attachment://psx-points.png'}),files:[{name:'psx-points.png',attachment:path.join(root,'preview/psx-points.png')}]}],
  ];
  const templates = Object.fromEntries(sections.map(([id,,payload])=>[id,payloadContent(payload)]));
  for(let p=0;p<2;p++) {templates[`ranking-total-${p}`]=payloadContent(buildRankingPayload(clan,'total',p));templates[`ranking-growth-${p}`]=payloadContent(buildRankingPayload(clan,'growth',p));}
  templates.goals=payloadContent(buildGoalsPayload(clan));templates.history=payloadContent(buildHistoryPayload());templates['season-1-0']=payloadContent(buildSeasonPayload(1));templates.diagnostics=payloadContent(buildDiagnosticsPayload());
  templates.claimed=payloadContent(buildTicketMessagePayload({...ticket,claimedBy:'1569000000000000007'}));
  for(const decision of ['accepted','rejected','waiting']) templates[decision]=payloadContent(buildTicketMessagePayload({...ticket,claimedBy:'1569000000000000007',decision,decisionReason:'Example staff decision for this offline preview.'}));
  templates.connected=payloadContent(v2(card('✅ ROBLOX ACCOUNT CONNECTED','Preview state: the real bot verifies your public profile before showing this confirmation.').addActionRowComponents(row(uiButton('clan:profile:self','Open my profile')))));
  const modalToHtml = modal=>{const json=modal.toJSON();return `<form data-preview-form="${html(json.custom_id)}"><h2>${html(json.title)}</h2>${json.components.map(label=>`<label>${html(label.label)}${label.description?`<small>${html(label.description)}</small>`:''}${label.component.style===2?`<textarea ${label.component.required?'required':''} maxlength="${label.component.max_length}">${html(label.component.value||'')}</textarea>`:`<input ${label.component.required?'required':''} maxlength="${label.component.max_length}" value="${html(label.component.value||'')}">`}</label>`).join('')}<button class="button style-1" type="submit">Continue preview</button><small>Przykładowy formularz offline — niczego nie wysyła na Discord ani Roblox.</small></form>`;};
  templates['apply-clan']=modalToHtml(ticketApplicationModal({guildId:config.guildId,user:{id:user}},'clan'));templates['apply-psx']=modalToHtml(ticketApplicationModal({guildId:config.guildId,user:{id:user}},'psx'));templates['link-form']=modalToHtml(accountLinkModal());
  templates['decision-form']=modalToHtml(form('preview:decision','Recruitment decision',[{id:'reason',label:'Reason / message for applicant',long:true,max:800}]));
  templates['psx-find']=modalToHtml(psxFindModal());
  const style = `*{box-sizing:border-box}body{margin:0;background:#111015;color:#f3f0f7;font:14px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}header{background:radial-gradient(ellipse at 80% 0,#321e4b,transparent 70%);border-bottom:1px solid #382a46;padding:30px max(22px,4vw)}.brand{display:flex;align-items:center;gap:18px}.brand img{width:78px;height:78px;object-fit:contain}.eyebrow{color:#c2a0ec;font-size:11px;font-weight:750;letter-spacing:2px}header h1{font-size:32px;margin:2px 0 5px}header p{color:#b9adc7;max-width:820px;margin:10px 0}nav{display:flex;flex-wrap:wrap;gap:7px;margin-top:20px}nav a{color:#e0c9fb;border:1px solid #59436d;border-radius:6px;padding:7px 11px;text-decoration:none;font-size:12px}.notice{display:inline-block;color:#e3c687;font-size:12px;margin:6px 0}.grid{max-width:1700px;margin:0 auto;padding:30px 3vw;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px;align-items:start}.sample{min-width:0;scroll-margin-top:20px}.sample-label{color:#c5aedc;letter-spacing:1.4px;text-transform:uppercase;font-size:10px;font-weight:700;margin:0 0 12px}.container{background:#2b2d31;border:1px solid #424148;border-left:4px solid var(--accent,#9858f5);border-radius:9px;padding:13px;color:#eeeef0;overflow:hidden;margin-bottom:12px}.container:last-child{margin-bottom:0}.banner{display:block;width:100%;height:auto;object-fit:contain;border-radius:6px;margin:10px 0 15px}.container>.banner:first-child{margin-top:0}.text{overflow-wrap:anywhere}.text+.text{margin-top:12px}h1,h2,h3{line-height:1.25;overflow-wrap:anywhere}h1{font-size:27px;margin:8px 0 13px}h2{font-size:20px;margin:0 0 10px}h3{font-size:17px;margin:7px 0 10px}.text br:last-child{display:none}.text small{display:block;color:#b5b0bf;font-size:11px;line-height:1.5}small{color:#b5b0bf;font-size:11px}.section{display:flex;gap:14px;justify-content:space-between;align-items:flex-start;margin:14px 0}.section>div{min-width:0;flex:1}.section>.button{max-width:126px;flex-shrink:0;white-space:normal}.thumbnail{width:68px;height:68px;object-fit:contain}.buttons{display:flex;gap:7px;flex-wrap:wrap;margin-top:13px}.button{font:600 12px system-ui;border:0;border-radius:4px;min-height:34px;padding:8px 11px;background:#4e5058;color:#fff;cursor:pointer;max-width:100%;overflow-wrap:anywhere}.style-1{background:#5865f2}.style-3{background:#248046}.style-4{background:#b43c49}.button:disabled{opacity:.45;cursor:default}hr{border:0;border-top:1px solid #48464f;margin:15px 0}code{background:#1e1f22;padding:2px 4px;border-radius:3px;font:12px ui-monospace,monospace;overflow-wrap:anywhere}.mention{color:#d1d6ff;background:#414675;padding:1px 3px;border-radius:3px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}.field{grid-column:1/-1}.field.inline{grid-column:auto}.field>strong{display:block}.author,.footer{font-size:10px;color:#bcafcb}.file{padding:12px;border:1px solid #555;border-radius:4px}select{width:100%;background:#202126;color:#eee;border:1px solid #555260;border-radius:4px;padding:10px}dialog{padding:18px;background:#17141d;color:#eee;border:1px solid #62447e;border-radius:12px;width:min(700px,calc(100% - 24px));max-height:90vh;overflow:auto}dialog::backdrop{background:#06040cda}.dialog-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:15px}.dialog-head h2{font-size:16px;margin:0}.dialog-head .button{min-height:30px}form label{display:block;font-weight:650;margin:15px 0}form label small{display:block;font-weight:400}input,textarea{display:block;width:100%;background:#24212c;color:#eee;border:1px solid #645171;border-radius:5px;margin-top:7px;padding:11px;font:14px system-ui}textarea{min-height:90px;resize:vertical}form>small{display:block;margin-top:12px}.image-section{max-width:1300px;margin:10px auto 30px;padding:0 3vw}.image-section img{width:100%;height:auto;border:1px solid #43314f;border-radius:8px}footer{max-width:1700px;margin:auto;padding:0 3vw 35px;color:#ad9bbc;font-size:12px}.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);max-width:calc(100% - 30px);background:#38254e;border:1px solid #9b71ca;padding:12px 18px;border-radius:8px;z-index:9;display:none}.focus .grid{max-width:780px;grid-template-columns:1fr}.focus-tickets .grid{max-width:1200px;grid-template-columns:repeat(2,minmax(0,1fr))}@media(max-width:1150px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.grid,.focus-tickets .grid{grid-template-columns:1fr;padding:22px 13px;gap:24px}header{padding:22px 18px}header h1{font-size:25px}.brand img{width:62px;height:62px}.brand{gap:13px}.container{padding:11px}.section>.button{max-width:106px}.text{font-size:13px}h1{font-size:24px}h2{font-size:18px}h3{font-size:16px}.button{padding:8px 10px;font-size:11px}.text small{font-size:10px}}`;
  const data = JSON.stringify(templates).replace(/</g,'\\u003c');
  const script = `const templates=${data};const dialog=document.getElementById('preview-dialog'),content=document.getElementById('dialog-content');let decision='accepted';function open(key){content.innerHTML=templates[key]||templates.staff;if(!dialog.open)dialog.showModal();}function notify(message){const toast=document.getElementById('toast');toast.textContent=message;toast.style.display='block';clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>toast.style.display='none',4500);}document.addEventListener('click',event=>{const node=event.target.closest('button[data-custom-id]');if(!node||node.disabled)return;const id=node.dataset.customId,parts=id.split(':');if(id.startsWith('ticket:open:'))open('apply-'+parts[2]);else if(id.startsWith('ticket:claim:'))open('claimed');else if(id.startsWith('ticket:decision:')){decision=parts[3];open('decision-form');}else if(id.startsWith('ticket:close-'))notify('Bot zapisze transkrypt, wyśle archiwum i dopiero potem usunie kanał.');else if(id==='psx:find')open('psx-find');else if(id==='psx:mine'||id.startsWith('psx:refresh-player:'))open('psx-points');else if(id.startsWith('psx:')){open('psx-ranking');notify('Podgląd offline — przykładowy ranking PSX Classic.');}else if(id==='account:start')open('link-form');else if(id==='account:verify')open('connected');else if(id==='account:cancel'){dialog.close();notify('Przykładowa weryfikacja anulowana.');}else if(id.startsWith('clan:profile:'))open('profile');else if(id.startsWith('clan:ranking:'))open('ranking-'+parts[2]+'-'+parts[3]);else if(id.startsWith('clan:goals:'))open('goals');else if(id.startsWith('clan:history:'))open('history');else if(id.startsWith('clan:season:'))open('season-'+parts[2]+'-'+parts[3]);else if(id.startsWith('clan:donations:'))open('treasury');else if(id==='staff:diagnostics')open('diagnostics');else if(id.startsWith('staff:')){if(id==='staff:home')open('staff');else notify('Podgląd offline. W bocie ta akcja wymaga odpowiedniej roli staffu.');}else if(id.startsWith('giveaway:'))notify('Podgląd offline. Działający bot sprawdza wymagania i zapisuje uczestnictwo w bazie.');else notify('Podgląd offline — żadne konto ani dane serwera nie są zmieniane.');});document.addEventListener('change',event=>{if(event.target.dataset.customId==='clan:rank-sort')open('ranking-'+event.target.value+'-0');});document.addEventListener('submit',event=>{if(!event.target.matches('[data-preview-form]'))return;event.preventDefault();const id=event.target.dataset.previewForm;if(id.startsWith('ticket:apply-submit:'))open('ticket');else if(id==='account:link-submit')open('verification');else if(id==='preview:decision')open(decision);else if(id==='psx:find-submit')open('psx-points');notify('Pokazano przykładowy wynik formularza. To podgląd offline.');});document.getElementById('close-dialog').onclick=()=>dialog.close();dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});`;
  const render = (selected, className='')=>`<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>R3V0 2.1 · Clan system preview</title><style>${style}</style><body class="${className}"><header><div class="brand"><img src="../assets/r3v0-logo.png" alt="Original R3V0 logo"><div><div class="eyebrow">R3V0 CLAN SYSTEM / 2.1</div><h1>One clan. One legacy.</h1></div></div><p>Natywne karty Discord Components V2. Twoje oryginalne logo i banner. Wypróbuj ranking, formularz rekrutacji oraz łączenie konta przez kod na profilu.</p><span class="notice">PRZYKŁADOWE DANE · PODGLĄD OFFLINE · Żadne działanie nie zmienia Discorda ani Robloxa.</span><nav><a href="index.html">Wszystkie panele</a><a href="clan-battle.html">Clan Battle</a><a href="tickets.html">Tickety</a><a href="profile.html">Profil</a><a href="verification.html">Łączenie kont</a><a href="psx-classic.html">PSX Classic</a></nav></header><main class="grid">${selected.map(([id,label,payload])=>`<section class="sample" id="${id}"><p class="sample-label">${label}</p>${payloadContent(payload)}</section>`).join('')}</main>${!className?`<section class="image-section"><p class="sample-label">Welcome · existing welcome card</p><img src="welcome.png" alt="Welcome card"></section>`:''}<footer>Karty powstały z rzeczywistych builderów bota. Discord ustala ostateczne odstępy, tło i kolory przycisków. Łączenie kont w działającym bocie wymaga poprawnego kodu na prawdziwym profilu Roblox.</footer><dialog id="preview-dialog"><div class="dialog-head"><h2>Podgląd interakcji</h2><button id="close-dialog" class="button" type="button">Close</button></div><div id="dialog-content"></div></dialog><div class="toast" id="toast" role="status"></div><script>${script}</script></body></html>`;
  fs.mkdirSync(path.join(root,'preview'),{recursive:true});
  fs.writeFileSync(path.join(root,'preview/index.html'),render(sections));
  fs.writeFileSync(path.join(root,'preview/clan-battle.html'),render(sections.filter(([id])=>id==='battle'),'focus'));
  fs.writeFileSync(path.join(root,'preview/tickets.html'),render(sections.filter(([id])=>['recruitment','ticket'].includes(id)),'focus-tickets'));
  fs.writeFileSync(path.join(root,'preview/profile.html'),render(sections.filter(([id])=>id==='profile'),'focus'));
  fs.writeFileSync(path.join(root,'preview/verification.html'),render(sections.filter(([id])=>id==='verification'),'focus'));
  fs.writeFileSync(path.join(root,'preview/psx-classic.html'),render(sections.filter(([id])=>id.startsWith('psx-')),'focus-tickets'));
  fs.writeFileSync(path.join(root,'preview/README.txt'),'Otwórz index.html. Tickety: tickets.html. Clan Battle: clan-battle.html. Profil: profile.html. PSX Classic: psx-classic.html.\nPodglądy są offline i używają przykładowych danych. Interakcje produkcyjne wykonuje bot Discord.\n');
}
