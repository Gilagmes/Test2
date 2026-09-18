-- Initial PostgreSQL schema for Shonen Rift: Telegram Arena

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "telegramId" TEXT NOT NULL,
  "username" TEXT NOT NULL DEFAULT '',
  "firstName" TEXT NOT NULL DEFAULT 'Player',
  "avatarUrl" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "matches" INTEGER NOT NULL DEFAULT 0,
  "wins" INTEGER NOT NULL DEFAULT 0,
  "losses" INTEGER NOT NULL DEFAULT 0,
  "kills" INTEGER NOT NULL DEFAULT 0,
  "deaths" INTEGER NOT NULL DEFAULT 0,
  "gold" INTEGER NOT NULL DEFAULT 0,
  "bestTimeSec" INTEGER,
  "rating" INTEGER NOT NULL DEFAULT 1000,
  "soft" INTEGER NOT NULL DEFAULT 200,
  "dailyLastClaimKey" TEXT,
  "dailyStreak" INTEGER NOT NULL DEFAULT 0,
  "tutorialCompleted" BOOLEAN NOT NULL DEFAULT false,
  "tutorialCompletedAt" TIMESTAMP(3),
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
  "token" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "telegramId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("token")
);

CREATE TABLE "Match" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "telegramId" TEXT NOT NULL,
  "heroId" TEXT NOT NULL,
  "seed" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'started',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAtMs" BIGINT NOT NULL,
  CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchResult" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "telegramId" TEXT NOT NULL,
  "username" TEXT NOT NULL DEFAULT '',
  "firstName" TEXT NOT NULL DEFAULT 'Player',
  "matchId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "victory" BOOLEAN NOT NULL,
  "winner" TEXT NOT NULL,
  "durationSec" INTEGER NOT NULL,
  "heroName" TEXT NOT NULL,
  "heroId" TEXT NOT NULL,
  "kills" INTEGER NOT NULL,
  "deaths" INTEGER NOT NULL,
  "gold" INTEGER NOT NULL,
  "level" INTEGER NOT NULL,
  CONSTRAINT "MatchResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SkinOwnership" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "skinId" TEXT NOT NULL,
  "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SkinOwnership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SkinEquip" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "heroId" TEXT NOT NULL,
  "skinId" TEXT NOT NULL,
  "equippedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkinEquip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
CREATE INDEX "User_rating_idx" ON "User"("rating");

CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

CREATE INDEX "Match_userId_idx" ON "Match"("userId");
CREATE INDEX "Match_status_idx" ON "Match"("status");
CREATE INDEX "Match_startedAt_idx" ON "Match"("startedAt");

CREATE UNIQUE INDEX "MatchResult_matchId_key" ON "MatchResult"("matchId");
CREATE INDEX "MatchResult_userId_idx" ON "MatchResult"("userId");
CREATE INDEX "MatchResult_createdAt_idx" ON "MatchResult"("createdAt");
CREATE INDEX "MatchResult_victory_idx" ON "MatchResult"("victory");

CREATE UNIQUE INDEX "SkinOwnership_userId_skinId_key" ON "SkinOwnership"("userId", "skinId");
CREATE INDEX "SkinOwnership_skinId_idx" ON "SkinOwnership"("skinId");

CREATE UNIQUE INDEX "SkinEquip_userId_heroId_key" ON "SkinEquip"("userId", "heroId");
CREATE INDEX "SkinEquip_skinId_idx" ON "SkinEquip"("skinId");

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Match" ADD CONSTRAINT "Match_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SkinOwnership" ADD CONSTRAINT "SkinOwnership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SkinEquip" ADD CONSTRAINT "SkinEquip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
