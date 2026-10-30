import { CLAN_COLORS } from './theme.js';
import { formatNumber, clip, escapeMarkdown } from './utils.js';

export const PURPLE_BATTLE_COLOR = CLAN_COLORS.accent;
export const BATTLE_PAGE_SIZE = 10;

function knownScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 ? Math.floor(score) : null;
}
function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}
function rankMark(rank) {
  return ['🥇', '🥈', '🥉'][rank - 1] || `**${String(rank).padStart(2, '0')}**`;
}

/** A shared view model keeps the native ranking, details and pagination consistent. */
export function buildBattleDashboardModel(clan, page = 0, pageSize = BATTLE_PAGE_SIZE, now = Date.now()) {
  const roster = Array.isArray(clan?.members) ? clan.members : [];
  const members = roster.map((member, index) => {
    const score = member.pointsKnown === false ? null : knownScore(member.points);
    return {
      ...member, originalIndex: index,
      username: clip(member.username || `RobloxUser_${member.userId || 'unknown'}`, 64),
      points: score, pointsKnown: score !== null,
    };
  }).sort((a, b) => Number(b.pointsKnown) - Number(a.pointsKnown) || (b.points || 0) - (a.points || 0) || a.originalIndex - b.originalIndex);
  const reportedMemberTotal = members.reduce((sum, member) => sum + (member.points || 0), 0);
  members.forEach((member, index) => {
    member.clanRank = index + 1;
    member.rosterShare = member.pointsKnown && reportedMemberTotal > 0 ? member.points / reportedMemberTotal : member.pointsKnown ? 0 : null;
  });
  const size = Math.max(1, Math.min(BATTLE_PAGE_SIZE, Math.floor(Number(pageSize) || BATTLE_PAGE_SIZE)));
  const pages = Math.max(1, Math.ceil(members.length / size));
  const currentPage = Math.min(pages - 1, Math.max(0, Math.floor(Number(page) || 0)));
  const pageMembers = members.slice(currentPage * size, (currentPage + 1) * size);
  const podium = currentPage === 0 ? pageMembers.slice(0, 3).filter(member => member.pointsKnown && member.points > 0) : [];
  const podiumIndexes = new Set(podium.map(member => member.originalIndex));
  const capacity = positiveInteger(clan?.memberCapacity);
  const updatedAt = positiveInteger(clan?.updatedAt) || now;
  return {
    page: currentPage, pages, pageSize: size, members, pageMembers, podium,
    rows: pageMembers.filter(member => !podiumIndexes.has(member.originalIndex)),
    totalPoints: knownScore(clan?.totalBattlePoints), reportedMemberTotal,
    reportedMembers: members.filter(member => member.pointsKnown).length,
    scoringMembers: members.filter(member => member.pointsKnown && member.points > 0).length,
    capacity: capacity !== null && capacity >= members.length ? capacity : null,
    clanRank: clan?.battleRankAvailable ? positiveInteger(clan.battleRank) : null,
    ownerName: members.find(member => member.isOwner)?.username || clip(clan?.ownerFallbackUsername || 'B3STTIEE', 64),
    battleId: clip(clan?.activeBattle || 'Battle data unavailable', 100),
    battleName: clip(String(clan?.activeBattle || 'Battle data unavailable').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([a-zA-Z])(\d)/g, '$1 $2').replace(/[_-]+/g, ' '), 100),
    battleEndsAt: positiveInteger(clan?.battleFinishTime), updatedAt,
    snapshotIsStale: now - updatedAt > 15 * 60 * 1000,
  };
}

export function buildBattlePageDescription(clan, page = 0, pageSize = BATTLE_PAGE_SIZE) {
  const model = buildBattleDashboardModel(clan, page, pageSize);
  const description = model.pageMembers.map(member => {
    const username = escapeMarkdown(member.username, 40);
    const points = member.pointsKnown ? formatNumber(member.points) : 'Not reported';
    const leader = member.isOwner ? ' · *Leader*' : '';
    return `${rankMark(member.clanRank)} **${username}**${leader} · **${points}**`;
  }).join('\n') || 'No members were returned by the R3V0 roster endpoint.';
  return { description, page: model.page, pages: model.pages, members: model.pageMembers };
}
