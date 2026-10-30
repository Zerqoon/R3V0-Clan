import { PermissionFlagsBits } from 'discord.js';
import { config } from './config.js';
const hasRole = (member, id) => Boolean(id && member?.roles?.cache?.has(id));
export const isOwner = member => hasRole(member, config.roles.owner) || Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator) || member?.permissions?.has(PermissionFlagsBits.ManageGuild));
export const isOfficer = member => isOwner(member) || hasRole(member, config.roles.officer);
export const isRecruiter = member => isOfficer(member) || config.ticketStaffRoleIds.some(id => hasRole(member, id));
export const isModerator = member => isOfficer(member) || config.moderatorRoleIds.some(id => hasRole(member, id)) || Boolean(member?.permissions?.has(PermissionFlagsBits.ModerateMembers));
export function requireAccess(member, permission = 'officer') {
  const allowed = ({ owner: isOwner, officer: isOfficer, recruiter: isRecruiter, moderator: isModerator })[permission];
  if (!allowed?.(member)) throw new Error(`This action requires ${permission} access.`);
}
