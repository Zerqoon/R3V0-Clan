import { db } from './db.js';
import { enqueueJob, registerJob } from './outbox.js';
import { card, text, v2 } from './ui.js';
export function rememberGame(messageId, channelId, kind) {
  db.prepare('INSERT OR REPLACE INTO active_game_messages(message_id,channel_id,kind,created_at) VALUES(?,?,?,?)').run(String(messageId),String(channelId),kind,Date.now());
}
export function forgetGame(messageId) { db.prepare('DELETE FROM active_game_messages WHERE message_id=?').run(String(messageId)); }
export function recoverInterruptedGames() {
  const games=db.prepare('SELECT * FROM active_game_messages').all();
  for(const game of games) enqueueJob('game-recovery',`game-recovery:${game.message_id}`,game);
  return games.length;
}
registerJob('game-recovery',async(client,game)=>{
  let channel,message;
  try {
    channel=client.channels.cache.get(game.channel_id)||await client.channels.fetch(game.channel_id);
    if(!channel)throw new Error('Game channel is unavailable');
    message=await channel.messages.fetch(game.message_id);
  } catch(error) { if([10003,10008].includes(Number(error.code))){forgetGame(game.message_id);return;}throw error; }
  await message.edit({content:null,embeds:[],attachments:[],...v2(card('🎮 ROUND CLOSED AFTER RESTART','This round was interrupted. Saved scores are preserved. Start a new round to keep playing.').addTextDisplayComponents(text(`-# ${game.kind} · R3V0 Arcade`)))});
  forgetGame(game.message_id);
});
