import { createHmac } from "crypto";

export const INVITE_SECRET = process.env.INVITE_SECRET || "default-secret";

export const roleMap = {
  presenter: "PRESENTER",
  guest: "GUEST",
  committee: "COMMITTEE",
  organizer: "ORGANIZER",
} as const;

export const normalizeEventName = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ");

export function signInvite(eventId: string, userId: string, role: keyof typeof roleMap) {
  const payload = `${eventId}|${userId}|${role}`;
  const sig = createHmac("sha256", INVITE_SECRET).update(payload).digest("hex");
  return sig;
}

export function verifyInvite(eventId: string, userId: string, role: keyof typeof roleMap, sig: string) {
  const expected = signInvite(eventId, userId, role);
  return expected === sig;
}

export type RankingTeamInput = {
  id: string;
  teamName: string;
  imageCover: string | null;
  createdAt: Date;
  rewards: { reward: number; createdAt: Date }[];
  categoryRewards: { amount: number; createdAt: Date }[];
};

export type RankedTeamScore = {
  id: string;
  name: string;
  imageCover: string | null;
  totalReward: number;
  scoreReachedAt: Date;
  teamCreatedAt: Date;
  rank?: number;
};

export const getScoreReachedAt = (team: RankingTeamInput, totalReward: number): Date => {
  if (totalReward <= 0) return team.createdAt;

  const timeline = [
    ...team.rewards
      .filter((r) => r.reward > 0)
      .map((r) => ({ amount: r.reward, at: r.createdAt })),
    ...team.categoryRewards
      .filter((r) => r.amount > 0)
      .map((r) => ({ amount: r.amount, at: r.createdAt })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  let cumulative = 0;
  for (const item of timeline) {
    cumulative += item.amount;
    if (cumulative >= totalReward) return item.at;
  }

  return team.createdAt;
};

export const buildTeamScores = (teams: RankingTeamInput[]): RankedTeamScore[] =>
  teams.map((team) => {
    const totalReward =
      team.rewards.reduce((sum, r) => sum + r.reward, 0) +
      team.categoryRewards.reduce((sum, r) => sum + r.amount, 0);

    return {
      id: team.id,
      name: team.teamName,
      imageCover: team.imageCover,
      totalReward,
      scoreReachedAt: getScoreReachedAt(team, totalReward),
      teamCreatedAt: team.createdAt,
    };
  });

export const sortTeamScores = (scores: RankedTeamScore[]) =>
  scores.sort((a, b) => {
    if (b.totalReward !== a.totalReward) return b.totalReward - a.totalReward;
    const reachedDiff = a.scoreReachedAt.getTime() - b.scoreReachedAt.getTime();
    if (reachedDiff !== 0) return reachedDiff;
    const createdDiff = a.teamCreatedAt.getTime() - b.teamCreatedAt.getTime();
    if (createdDiff !== 0) return createdDiff;
    return a.name.localeCompare(b.name, "th");
  });

export const withCompetitionRank = (scores: RankedTeamScore[]) => {
  let currentRank = 1;
  return scores.map((team, index) => {
    if (index > 0 && team.totalReward < scores[index - 1].totalReward) {
      currentRank = index + 1;
    }
    return { ...team, rank: currentRank };
  });
};
