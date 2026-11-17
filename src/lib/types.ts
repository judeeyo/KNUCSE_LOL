export interface Group {
  id: string;
  name: string;
  inviteCode: string;
  createdAt: string;
  members: Member[];
  matches: Match[];
}

export interface Member {
  id: string;
  nickname: string;
  groupId: string;
  joinedAt: string;
  tier?: string;
  preferredLanes?: Lane[]; // ordered: index 0 = 1순위
  realName?: string;
  aliases?: string[]; // 부캐 닉네임들 (통합된 아이디)
}

export type Lane = "top" | "jungle" | "mid" | "adc" | "support";

export interface Match {
  id: string;
  groupId: string;
  createdAt: string;
  gameDuration: string;
  players: PlayerStat[];
  bans?: { blue: string[]; red: string[] }; // 밴 챔피언 (드래프트 모드만, 밴 순서대로)
  source?: MatchSource;
  gameId?: string; // Riot gameId (수기·과거 기록은 없음)
  timeUnknown?: boolean; // true면 날짜만 신뢰 (시각 미상)
  missing?: MissingStats; // 이 경기에서 수집되지 않은 지표
}

export type MatchSource = "collector" | "history" | "manual" | "legacy-import" | "backup-import";

/** 경기 단위로 수집되지 않은 지표 (수기 기록에는 딜량·시야 등이 없음) */
export interface MissingStats {
  damage: boolean;
  damageTaken: boolean;
  vision: boolean;
}

export interface PlayerStat {
  id: string;
  matchId: string;
  nickname: string;
  champion: string;
  lane?: Lane;
  team: "blue" | "red";
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number;
  damageDealt: number;
  damageTaken: number;
  visionScore: number;
  wardsPlaced: number;
  wardsDestroyed: number;
  objectiveDamage: number;
  ccScore: number;
  healingDone: number;
  shieldingDone: number;
  turretDamage?: number;
  firstBlood?: boolean;
  largestMultiKill?: number;
  killParticipation: number;
  mvpScore: number;
  isMvp: boolean;
  isAce: boolean;
  // 아래 플래그는 DB에서 읽을 때 채워진다 — true면 해당 값은 0이 아니라 "미수집"
  noDamage?: boolean;
  noDamageTaken?: boolean;
  noVision?: boolean;
}

