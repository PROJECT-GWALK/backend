import { z } from "zod";
import { FileType } from "../generated/prisma/enums.js";

// Admin Dashboard
export const adminDashboardParams = z.object({
  year: z.string().optional(),
  month: z.string().optional(),
});

// Events Action
export const giveVrSchema = z.object({
  projectId: z.string().min(1),
  amount: z.number().int().min(0),
});

export const resetVrSchema = z.object({
  projectId: z.string().min(1),
});

export const giveSpecialSchema = z.object({
  projectId: z.string().min(1),
  rewardIds: z.array(z.string()),
});

export const resetSpecialSchema = z.object({
  projectId: z.string().min(1),
});

export const giveCommentSchema = z.object({
  projectId: z.string().min(1),
  content: z.string().min(1),
});

export const rateEventSchema = z.object({
  rating: z.number().min(1).max(5),
  comment: z.string().optional(),
});

// User Management
export const updateUserRoleSchema = z.object({
  role: z.enum(["USER", "ADMIN"]),
});

export const banUserSchema = z.object({
  reason: z.string().optional(),
  expiresAt: z.string().optional(),
});

// User Info
export const updateUserProfileSchema = z.object({
  username: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  image: z.string().optional(), // 'null' string is handled in logic, but here we just allow string
});

// Events Invite
export const inviteRoleQuerySchema = z.object({
  role: z.enum(["presenter", "guest", "committee", "organizer"]),
});

export const invitePreviewSchema = z.object({
  token: z.string().optional(),
  role: z.enum(["presenter", "guest", "committee", "organizer"]).optional(),
});

export const inviteSchema = z.object({
  token: z.string().optional(),
  role: z.enum(["presenter", "guest", "committee"]).optional(),
  sig: z.string().optional(),
});

// Common params
export const idParamSchema = z.object({
  id: z.string(),
});

export const eventIdParamSchema = z.object({
  eventId: z.string(),
});

// Events Team/Participant
export const updateParticipantSchema = z.object({
  eventGroup: z.enum(["ORGANIZER", "PRESENTER", "COMMITTEE", "GUEST"]).optional(),
  isLeader: z.boolean().optional(),
  virtualReward: z.number().min(0).optional(),
  teamId: z.string().nullable().optional(),
});

export const createTeamSchema = z.object({
  teamName: z.string().min(1),
  description: z.string().optional(),
  imageCover: z.string().optional(),
});

export const updateTeamSchema = z.object({
  teamName: z.string().optional(),
  description: z.string().optional(),
  imageCover: z.string().nullable().optional(),
});

export const candidateQuerySchema = z.object({
  q: z.string().optional(),
});

export const addTeamMemberSchema = z.object({
  userId: z.string(),
});

export const addParticipantSchema = z.object({
  identifier: z.string().min(1),
  role: z.enum(["ORGANIZER", "PRESENTER", "COMMITTEE", "GUEST"]),
});

// Files
export const filesParamSchema = z.object({
  bucket: z.string(),
  object: z.string(),
});

// Upload
export const uploadFileSchema = z.object({
  file: z.any(),
});

// Compound params
export const eventAndTeamIdParamSchema = z.object({
  id: z.string(),
  teamId: z.string(),
});

export const eventAndParticipantIdParamSchema = z.object({
  id: z.string(),
  pid: z.string(),
});

// Event Settings Validation
export const eventFileTypeSchema = z.object({
  id: z.string().optional(),
  name: z.string().max(30),
  description: z.string().max(240),
  allowedFileTypes: z.array(z.nativeEnum(FileType)),
  isRequired: z.boolean(),
});

export const specialRewardSchema = z.object({
  name: z.string().max(30),
  description: z.string().max(240),
  image: z.string().nullable().optional(),
  allowGuestVote: z.boolean().optional(),
});
